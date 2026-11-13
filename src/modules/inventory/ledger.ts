// Kho: sổ kho và hàm ghi dùng chung (00-tong-quan.md mục 8.2, 01-kho.md R-KHO-5…R-KHO-37). Chữ ký do T-14a chốt; thân T-14b-A.
// Hàm nhận tx chạy trong giao dịch của người gọi, không tự mở giao dịch. Lỗi nghiệp vụ ném UserError
// để người gọi để giao dịch lùi toàn bộ (kể cả các dòng đã ghi trước đó trong cùng lời gọi).
import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import {
  inventoryItems,
  lots,
  orderEvents,
  orderItems,
  orders,
  productionOrderMaterials,
  productionOrders,
  products,
  settings,
  staffUsers,
  stockBalances,
  stockIssueLines,
  stockIssues,
  stockLots,
  stockMovements,
  stockReceiptLines,
  stockReceipts,
  stockTransferLines,
  stockTransfers,
  suppliers,
  warehouseLocations,
  warehouses,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { can, type Permission, type StaffRole } from "@/modules/auth/rules";
import { adjustDebtAmount, cancelCashTransaction, cancelDebt, findDebtBySource, openPayable, recordCashTransaction } from "@/modules/finance/ledger";
import { nextDocCode } from "@/modules/numbering/service";
import { vnToday } from "@/modules/numbering/rules";
import { cancelPendingInspectionsOfReceipt, createInspection } from "@/modules/qms/inspections";
import { ERP_SETTINGS_KEY, parseErpSettings } from "@/modules/settings/erp-schema";
import {
  addDays,
  checkMoveRule,
  classifyBalance,
  compareFefo,
  costOfQty,
  formatQty,
  isLotUsable,
  ISSUE_MOVE,
  MAX_QTY,
  moveKinds,
  moveNeedsUsableLot,
  planFefo,
  RECEIPT_MOVE,
  resolveLineDates,
  sellableStock,
  unusableLotMessage,
  canChangeQcStatus,
  type BaseUom,
  type DisplayUom,
  type FefoCandidate,
  type FefoPick,
  type IssueInput,
  type ItemStock,
  type NewStockLot,
  type ProductLotStatus,
  type ReceiptInput,
  type StockDocRef,
  type StockLotQcStatus,
  type StockMoveInput,
  type StockMoveType,
  type WarehouseKind,
} from "./rules";

export const STALE_MESSAGE = "Chứng từ vừa được người khác cập nhật, tải lại trang.";

// Mã kho mặc định cho từng loại (00 mục 11.1), ưu tiên khi tự chọn kho đích
const DEFAULT_WAREHOUSE_CODE: Record<WarehouseKind, string> = { raw: "RAW", extract: "EXT", packaging: "PKG", wip: "WIP", finished: "FG", rejected: "REJ" };

// ---------------------------------------------------------------------------------------------
// Đọc dùng chung

type LotInfo = {
  id: string;
  code: string;
  itemId: string;
  qcStatus: StockLotQcStatus | null;
  productLotId: string | null;
  productLotStatus: ProductLotStatus | null;
  expiresOn: string | null;
  manufacturedOn: string | null;
  receivedQty: number;
  receivedCost: number;
  supplierId: string | null;
  sourceDocType: string;
  sourceDocId: string;
  itemKind: string;
  itemCode: string;
  itemName: string;
  productId: string | null;
  baseUom: BaseUom;
  displayUom: string;
};

async function loadLots(db: Db | Tx, ids: string[]): Promise<Map<string, LotInfo>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: stockLots.id,
      code: stockLots.code,
      itemId: stockLots.itemId,
      qcStatus: stockLots.qcStatus,
      productLotId: stockLots.productLotId,
      productLotStatus: lots.releaseStatus,
      expiresOn: stockLots.expiresOn,
      productLotExpiresOn: lots.expiresOn,
      manufacturedOn: stockLots.manufacturedOn,
      receivedQty: stockLots.receivedQty,
      receivedCost: stockLots.receivedCost,
      supplierId: stockLots.supplierId,
      sourceDocType: stockLots.sourceDocType,
      sourceDocId: stockLots.sourceDocId,
      itemKind: inventoryItems.kind,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      productId: inventoryItems.productId,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
    })
    .from(stockLots)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
    .leftJoin(lots, eq(lots.id, stockLots.productLotId))
    .where(inArray(stockLots.id, unique));
  return new Map(rows.map((r) => [r.id, { ...r, expiresOn: r.expiresOn ?? r.productLotExpiresOn ?? null }]));
}

type LocationInfo = { id: string; code: string; warehouseId: string; warehouseCode: string; warehouseKind: WarehouseKind; warehouseActive: boolean };

async function loadLocations(db: Db | Tx, ids: string[]): Promise<Map<string, LocationInfo>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: warehouseLocations.id,
      code: warehouseLocations.code,
      warehouseId: warehouseLocations.warehouseId,
      warehouseCode: warehouses.code,
      warehouseKind: warehouses.kind,
      warehouseActive: warehouses.isActive,
    })
    .from(warehouseLocations)
    .innerJoin(warehouses, eq(warehouses.id, warehouseLocations.warehouseId))
    .where(inArray(warehouseLocations.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

async function defaultLocationId(db: Db | Tx, warehouseId: string): Promise<string> {
  const [row] = await db
    .select({ id: warehouseLocations.id })
    .from(warehouseLocations)
    .where(and(eq(warehouseLocations.warehouseId, warehouseId), eq(warehouseLocations.isDefault, true)))
    .limit(1);
  if (!row) throw new UserError("Kho chưa có vị trí mặc định");
  return row.id;
}

// Kho đang dùng đầu tiên của một loại, ưu tiên mã mặc định (REJ, FG…)
async function warehouseOfKind(db: Db | Tx, kind: WarehouseKind): Promise<{ id: string; code: string }> {
  const rows = await db
    .select({ id: warehouses.id, code: warehouses.code })
    .from(warehouses)
    .where(and(eq(warehouses.kind, kind), eq(warehouses.isActive, true)))
    .orderBy(asc(warehouses.createdAt), asc(warehouses.code));
  const pick = rows.find((r) => r.code === DEFAULT_WAREHOUSE_CODE[kind]) ?? rows[0];
  if (!pick) throw new UserError(`Chưa có kho loại ${kind} đang dùng`);
  return pick;
}

async function actorCan(db: Db | Tx, actorId: string | null, permission: Permission): Promise<boolean> {
  if (!actorId) return false;
  const [row] = await db.select({ role: staffUsers.role }).from(staffUsers).where(eq(staffUsers.id, actorId)).limit(1);
  return row ? can(row.role as StaffRole, permission) : false;
}

function fmt(qty: number, lot: { baseUom: BaseUom; displayUom: string }): string {
  return formatQty(qty, lot.baseUom, lot.displayUom as DisplayUom);
}

// ---------------------------------------------------------------------------------------------
// Ghi biến động (R-KHO-5, R-KHO-6, R-KHO-7)

export async function postMovements(tx: Tx, ref: StockDocRef, moves: StockMoveInput[]): Promise<{ movementIds: string[] }> {
  if (moves.length === 0) return { movementIds: [] };
  const lotMap = await loadLots(tx, moves.map((m) => m.stockLotId));
  const locMap = await loadLocations(tx, moves.map((m) => m.locationId));
  const reversalIds = moves.map((m) => m.reversalOf).filter((x): x is string => !!x);
  const originals = reversalIds.length
    ? new Map(
        (await tx.select().from(stockMovements).where(inArray(stockMovements.id, reversalIds))).map((r) => [r.id, r]),
      )
    : new Map<string, typeof stockMovements.$inferSelect>();
  const today = vnToday();

  // Kiểm toàn bộ trước khi ghi dòng nào
  for (const m of moves) {
    const lot = lotMap.get(m.stockLotId);
    if (!lot) throw new UserError("Không tìm thấy lô");
    const loc = locMap.get(m.locationId);
    if (!loc) throw new UserError("Không tìm thấy vị trí kho");
    if (m.type === "reversal") {
      const orig = m.reversalOf ? originals.get(m.reversalOf) : undefined;
      if (!orig) throw new UserError("Dòng đảo phải trỏ về dòng gốc");
      if (orig.type === "reversal") throw new UserError("Không đảo một dòng đảo");
      if (orig.stockLotId !== m.stockLotId || orig.locationId !== m.locationId || m.qty !== -orig.qty) throw new UserError("Dòng đảo phải cùng lô, cùng vị trí và ngược số lượng dòng gốc");
      continue;
    }
    if (m.reversalOf) throw new UserError("Chỉ dòng đảo mới trỏ về dòng gốc");
    const err = checkMoveRule(m.type, m.qty, loc.warehouseKind, lot.itemKind === "finished");
    if (err) throw new UserError(err);
    if (m.qty > 0 && !loc.warehouseActive) throw new UserError(`Kho ${loc.warehouseCode} đã ngừng dùng`);
    if (moveNeedsUsableLot(m.type) && !isLotUsable(lot, today)) throw new UserError(unusableLotMessage(lot.code, lot, today));
  }

  // Ghi theo thứ tự (vị trí, lô) để hai giao dịch không khóa chéo nhau; trả id theo thứ tự đầu vào
  const order = moves.map((m, i) => ({ m, i })).sort((a, b) => (a.m.locationId + a.m.stockLotId < b.m.locationId + b.m.stockLotId ? -1 : a.m.locationId + a.m.stockLotId > b.m.locationId + b.m.stockLotId ? 1 : a.i - b.i));
  const ids: string[] = new Array(moves.length);
  const at = ref.at ?? new Date();
  const touchedProducts = new Set<string>();

  for (const { m, i } of order) {
    const lot = lotMap.get(m.stockLotId)!;
    const loc = locMap.get(m.locationId)!;
    let balance: number;
    if (m.qty > 0) {
      const [row] = await tx
        .insert(stockBalances)
        .values({ locationId: m.locationId, stockLotId: m.stockLotId, warehouseId: loc.warehouseId, itemId: lot.itemId, qty: m.qty })
        .onConflictDoUpdate({
          target: [stockBalances.locationId, stockBalances.stockLotId],
          set: { qty: sql`"stock_balances"."qty" + excluded."qty"`, updatedAt: new Date() },
        })
        .returning({ qty: stockBalances.qty });
      balance = row!.qty;
    } else {
      // Trừ có điều kiện: câu UPDATE khóa dòng và kiểm lại điều kiện sau khi chờ, nên chạy đua cũng không âm
      const [row] = await tx
        .update(stockBalances)
        .set({ qty: sql`${stockBalances.qty} + ${m.qty}`, updatedAt: new Date() })
        .where(and(eq(stockBalances.locationId, m.locationId), eq(stockBalances.stockLotId, m.stockLotId), sql`${stockBalances.qty} + ${m.qty} >= 0`))
        .returning({ qty: stockBalances.qty });
      if (!row) {
        const [cur] = await tx
          .select({ qty: stockBalances.qty })
          .from(stockBalances)
          .where(and(eq(stockBalances.locationId, m.locationId), eq(stockBalances.stockLotId, m.stockLotId)));
        throw new UserError(`Lô ${lot.code} ở ${loc.warehouseCode}/${loc.code} chỉ còn ${fmt(cur?.qty ?? 0, lot)}, không xuất được ${fmt(-m.qty, lot)}.`);
      }
      balance = row.qty;
    }
    const [mv] = await tx
      .insert(stockMovements)
      .values({
        type: m.type,
        docType: ref.docType,
        docId: ref.docId,
        docCode: ref.docCode,
        itemId: lot.itemId,
        stockLotId: m.stockLotId,
        warehouseId: loc.warehouseId,
        locationId: m.locationId,
        qty: m.qty,
        balanceAfter: balance,
        orderItemId: m.orderItemId ?? null,
        productionOrderId: m.productionOrderId ?? null,
        extractionRunId: m.extractionRunId ?? null,
        reversalOf: m.reversalOf ?? null,
        note: m.note ?? null,
        actorId: ref.actorId,
        occurredAt: at,
        // Giờ thật lúc ghi từng dòng (now() giống nhau trong cả giao dịch): sắp theo (occurred_at, created_at) ra đúng thứ tự ghi
        createdAt: sql`clock_timestamp()`,
      })
      .returning({ id: stockMovements.id });
    ids[i] = mv!.id;
    if (lot.productId) touchedProducts.add(lot.productId);
  }

  for (const productId of [...touchedProducts].sort()) await syncSellableStock(tx, productId);
  return { movementIds: ids };
}

// Đảo các dòng chưa bị đảo (R-CHUNG-8). Dòng đã đảo thì bỏ qua; trả id các dòng đảo mới.
export async function reverseMovements(tx: Tx, ref: StockDocRef, movementIds: string[]): Promise<{ movementIds: string[] }> {
  if (movementIds.length === 0) return { movementIds: [] };
  const originals = await tx.select().from(stockMovements).where(inArray(stockMovements.id, movementIds));
  const already = new Set(
    (await tx.select({ of: stockMovements.reversalOf }).from(stockMovements).where(inArray(stockMovements.reversalOf, movementIds))).map((r) => r.of),
  );
  const moves: StockMoveInput[] = originals
    .filter((o) => o.type !== "reversal" && !already.has(o.id))
    .map((o) => ({
      type: "reversal",
      stockLotId: o.stockLotId,
      locationId: o.locationId,
      qty: -o.qty,
      reversalOf: o.id,
      orderItemId: o.orderItemId,
      productionOrderId: o.productionOrderId,
      extractionRunId: o.extractionRunId,
      note: ref.docType === o.docType && ref.docId === o.docId ? null : `Đảo ${o.docCode}`,
    }));
  return postMovements(tx, ref, moves);
}

// Tạo lô (R-KHO-29). Mã: truyền sẵn (lô thành phẩm = lots.lot_no) hoặc VT-YYMM-NNNN / EX-YYMM-NNN.
export async function createStockLot(tx: Tx, input: NewStockLot): Promise<{ id: string; code: string }> {
  if (!Number.isSafeInteger(input.receivedQty) || input.receivedQty <= 0) throw new UserError("Số lượng nhận phải lớn hơn 0");
  if (!Number.isSafeInteger(input.receivedCost) || input.receivedCost < 0) throw new UserError("Giá trị lô không hợp lệ");
  const isProductLot = !!input.productLotId;
  const code = input.code?.trim() || (isProductLot ? null : await nextDocCode(tx, input.prefix ?? "VT"));
  if (!code) throw new UserError("Lô thành phẩm phải có mã lô sản xuất");
  const [row] = await tx
    .insert(stockLots)
    .values({
      code,
      itemId: input.itemId,
      productLotId: input.productLotId ?? null,
      supplierId: input.supplierId ?? null,
      supplierLotNo: input.supplierLotNo ?? null,
      manufacturedOn: input.manufacturedOn ?? null,
      expiresOn: input.expiresOn ?? null,
      receivedQty: input.receivedQty,
      receivedCost: input.receivedCost,
      qcStatus: isProductLot ? null : (input.qcStatus ?? "pending"),
      sourceDocType: input.source.docType,
      sourceDocId: input.source.docId,
      productionOrderId: input.productionOrderId ?? null,
      extractionRunId: input.extractionRunId ?? null,
    })
    .returning({ id: stockLots.id, code: stockLots.code });
  return row!;
}

// ---------------------------------------------------------------------------------------------
// FEFO (R-KHO-10)

async function fefoCandidates(
  db: Db | Tx,
  input: { itemId: string; warehouseKinds: WarehouseKind[]; warehouseId?: string | null; stockLotId?: string | null; locationId?: string | null },
  today: string,
): Promise<FefoCandidate[]> {
  if (input.warehouseKinds.length === 0) return [];
  const rows = await db
    .select({
      stockLotId: stockBalances.stockLotId,
      locationId: stockBalances.locationId,
      warehouseId: stockBalances.warehouseId,
      qty: stockBalances.qty,
      code: stockLots.code,
      locCode: warehouseLocations.code,
      expiresOn: stockLots.expiresOn,
      productLotExpiresOn: lots.expiresOn,
      manufacturedOn: stockLots.manufacturedOn,
      qcStatus: stockLots.qcStatus,
      productLotStatus: lots.releaseStatus,
    })
    .from(stockBalances)
    .innerJoin(stockLots, eq(stockLots.id, stockBalances.stockLotId))
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .innerJoin(warehouseLocations, eq(warehouseLocations.id, stockBalances.locationId))
    .leftJoin(lots, eq(lots.id, stockLots.productLotId))
    .where(
      and(
        eq(stockBalances.itemId, input.itemId),
        gt(stockBalances.qty, 0),
        inArray(warehouses.kind, input.warehouseKinds),
        input.warehouseId ? eq(stockBalances.warehouseId, input.warehouseId) : undefined,
        input.stockLotId ? eq(stockBalances.stockLotId, input.stockLotId) : undefined,
        input.locationId ? eq(stockBalances.locationId, input.locationId) : undefined,
      ),
    )
    .orderBy(asc(warehouseLocations.code), asc(stockBalances.locationId));
  return rows.map((r) => {
    const expiresOn = r.expiresOn ?? r.productLotExpiresOn ?? null;
    return {
      stockLotId: r.stockLotId,
      locationId: r.locationId,
      warehouseId: r.warehouseId,
      qty: r.qty,
      code: r.code,
      expiresOn,
      manufacturedOn: r.manufacturedOn,
      usable: isLotUsable({ qcStatus: r.qcStatus, productLotStatus: r.productLotStatus, expiresOn }, today),
      unusableMessage: isLotUsable({ qcStatus: r.qcStatus, productLotStatus: r.productLotStatus, expiresOn }, today)
        ? null
        : unusableLotMessage(r.code, { qcStatus: r.qcStatus, productLotStatus: r.productLotStatus, expiresOn }, today),
    };
  });
}

export async function allocateFefo(
  tx: Tx,
  input: { itemId: string; qty: number; warehouseKinds: WarehouseKind[]; warehouseId?: string | null; today?: string },
): Promise<{ ok: true; picks: FefoPick[] } | { ok: false; available: number }> {
  const today = input.today ?? vnToday();
  const candidates = await fefoCandidates(tx, input, today);
  return planFefo(candidates, input.qty, today);
}

// Phân bổ cho loại xuất không cần lô khả dụng (hủy, mẫu lưu, trả NCC, khác): xét mọi lô, vẫn theo thứ tự FEFO
function planAny(candidates: FefoCandidate[], qty: number) {
  return planFefo(
    candidates.map((c) => ({ ...c, usable: true })),
    qty,
    "0000-00-00",
  );
}

// ---------------------------------------------------------------------------------------------
// Phiếu nhập (R-KHO-12…R-KHO-16, R-KHO-26, R-KHO-30)

export async function createReceiptDraft(tx: Tx, input: ReceiptInput, actorId: string | null): Promise<{ receiptId: string; code: string }> {
  if (input.lines.length === 0) throw new UserError("Phiếu nhập chưa có dòng nào");
  for (const l of input.lines) {
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0 || l.qty > MAX_QTY) throw new UserError("Số lượng nhập phải lớn hơn 0");
    if (!Number.isSafeInteger(l.lineCost) || l.lineCost < 0) throw new UserError("Thành tiền không hợp lệ");
  }
  const code = await nextDocCode(tx, "PN");
  const paymentMode = input.paymentMode ?? (input.supplierId && (input.kind === "purchase" || input.kind === "other") ? "payable" : "none");
  const items = await tx.select({ id: inventoryItems.id, requiresIqc: inventoryItems.requiresIqc }).from(inventoryItems).where(inArray(inventoryItems.id, [...new Set(input.lines.map((l) => l.itemId))]));
  const iqc = new Map(items.map((i) => [i.id, i.requiresIqc]));
  const [row] = await tx
    .insert(stockReceipts)
    .values({
      code,
      kind: input.kind,
      status: "draft",
      supplierId: input.supplierId ?? null,
      warehouseId: input.warehouseId,
      receivedOn: input.receivedOn,
      invoiceNo: input.invoiceNo ?? null,
      fileIds: input.fileIds ?? [],
      sourceType: input.source?.type ?? null,
      sourceId: input.source?.id ?? null,
      paymentMode,
      payAccountId: input.payAccountId ?? null,
      note: input.note ?? null,
      createdBy: actorId,
    })
    .returning({ id: stockReceipts.id });
  await tx.insert(stockReceiptLines).values(
    input.lines.map((l, i) => ({
      receiptId: row!.id,
      itemId: l.itemId,
      locationId: l.locationId ?? null,
      qty: l.qty,
      lineCost: l.lineCost,
      stockLotId: l.stockLotId ?? null,
      productLotId: l.productLotId ?? null,
      supplierLotNo: l.supplierLotNo ?? null,
      manufacturedOn: l.manufacturedOn ?? null,
      expiresOn: l.expiresOn ?? null,
      qcRequired: l.qcRequired ?? iqc.get(l.itemId) ?? true,
      note: l.note ?? null,
      sort: i,
    })),
  );
  return { receiptId: row!.id, code };
}

type PostReceiptOpts = { orderItemByLine?: Map<string, string>; allowAnyWarehouse?: boolean; at?: Date };

export async function postReceipt(tx: Tx, input: ReceiptInput, actorId: string | null): Promise<{ receiptId: string; code: string; lines: { lineId: string; stockLotId: string }[] }> {
  const { receiptId, code } = await createReceiptDraft(tx, input, actorId);
  const lines = await postReceiptDraft(tx, receiptId, actorId);
  return { receiptId, code, lines: lines.lines };
}

// Ghi sổ phiếu nhập nháp (R-KHO-13). Có điều kiện status = draft (R-CHUNG-9).
export async function postReceiptDraft(tx: Tx, receiptId: string, actorId: string | null, opts: PostReceiptOpts = {}): Promise<{ lines: { lineId: string; stockLotId: string }[] }> {
  const receipt = await tx.query.stockReceipts.findFirst({ where: eq(stockReceipts.id, receiptId) });
  if (!receipt) throw new UserError("Không tìm thấy phiếu nhập");
  if (receipt.status !== "draft" && receipt.status !== "pending_approval") throw new UserError(STALE_MESSAGE);
  const [claimed] = await tx
    .update(stockReceipts)
    .set({ status: "posted", postedBy: actorId, postedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(stockReceipts.id, receiptId), eq(stockReceipts.status, receipt.status)))
    .returning({ id: stockReceipts.id });
  if (!claimed) throw new UserError(STALE_MESSAGE);

  const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, receipt.warehouseId));
  if (!wh) throw new UserError("Không tìm thấy kho");
  if (!wh.isActive) throw new UserError(`Kho ${wh.code} đã ngừng dùng`);
  const supplier = receipt.supplierId ? await tx.query.suppliers.findFirst({ where: eq(suppliers.id, receipt.supplierId) }) : null;
  if (receipt.supplierId && !supplier) throw new UserError("Không tìm thấy nhà cung cấp");

  const lines = await tx.select().from(stockReceiptLines).where(eq(stockReceiptLines.receiptId, receiptId)).orderBy(asc(stockReceiptLines.sort));
  const itemRows = await tx.select().from(inventoryItems).where(inArray(inventoryItems.id, [...new Set(lines.map((l) => l.itemId))]));
  const items = new Map(itemRows.map((i) => [i.id, i]));
  const defaultLoc = await defaultLocationId(tx, wh.id);
  const locMap = await loadLocations(tx, lines.map((l) => l.locationId).filter((x): x is string => !!x));
  const kind = receipt.kind;
  const productionOrderId = receipt.sourceType === "production_order" ? receipt.sourceId : null;
  const extractionRunId = receipt.sourceType === "extraction_run" ? receipt.sourceId : null;
  const addsReceived = kind === "purchase" || kind === "opening" || kind === "other" || kind === "production" || kind === "extraction";
  const needsExistingLot = kind === "customer_return" || kind === "production_return";

  const out: { lineId: string; stockLotId: string }[] = [];
  const moves: StockMoveInput[] = [];
  const pendingLines: { lineId: string; stockLotId: string }[] = [];
  const addedByProductLot = new Map<string, number>();
  let total = 0;

  for (const line of lines) {
    const item = items.get(line.itemId);
    if (!item) throw new UserError("Không tìm thấy hàng hóa");
    if (!item.isActive && !needsExistingLot) throw new UserError(`Hàng ${item.code} đã ngừng dùng`);
    const locationId = line.locationId ?? defaultLoc;
    if (line.locationId) {
      const loc = locMap.get(line.locationId);
      if (!loc) throw new UserError("Không tìm thấy vị trí kho");
      if (loc.warehouseId !== wh.id && !opts.allowAnyWarehouse) throw new UserError("Vị trí không thuộc kho của phiếu");
    }
    total += line.lineCost;

    let stockLotId = line.stockLotId;
    let lotPending = false;

    // Thành phẩm: lô gắn lots (R-KHO-26)
    let productLot: typeof lots.$inferSelect | undefined;
    if (item.kind === "finished" && !stockLotId) {
      if (!line.productLotId) throw new UserError(`Dòng ${item.code} phải chọn lô sản xuất`);
      productLot = await tx.query.lots.findFirst({ where: eq(lots.id, line.productLotId) });
      if (!productLot || productLot.productId !== item.productId) throw new UserError("Lô sản xuất không thuộc sản phẩm này");
      const [existing] = await tx.select({ id: stockLots.id }).from(stockLots).where(eq(stockLots.productLotId, productLot.id));
      if (existing) stockLotId = existing.id;
    }
    if (needsExistingLot && !stockLotId) throw new UserError("Nhập trả phải chọn lô đã xuất");

    if (item.kind === "finished" && kind !== "customer_return") {
      const plId = productLot?.id ?? (stockLotId ? (await tx.select({ p: stockLots.productLotId }).from(stockLots).where(eq(stockLots.id, stockLotId)))[0]?.p : null);
      if (plId) {
        const pl = productLot ?? (await tx.query.lots.findFirst({ where: eq(lots.id, plId) }));
        const [doneRow] = await tx
          .select({ done: sql<string>`coalesce(sum(${stockReceiptLines.qty}), 0)::text` })
          .from(stockReceiptLines)
          .innerJoin(stockReceipts, eq(stockReceipts.id, stockReceiptLines.receiptId))
          .where(
            and(
              eq(stockReceipts.status, "posted"),
              ne(stockReceipts.kind, "customer_return"),
              ne(stockReceipts.id, receiptId),
              sql`(${stockReceiptLines.productLotId} = ${plId} or ${stockReceiptLines.stockLotId} in (select id from stock_lots where product_lot_id = ${plId}))`,
            ),
          );
        const already = Number(doneRow?.done ?? 0) + (addedByProductLot.get(plId) ?? 0);
        if (pl && already + line.qty > pl.unitsProduced) {
          throw new UserError(`Lô ${pl.lotNo} sản xuất ${pl.unitsProduced} chai, đã nhập ${already}`);
        }
        addedByProductLot.set(plId, (addedByProductLot.get(plId) ?? 0) + line.qty);
      }
    }

    if (stockLotId) {
      const lot = (await loadLots(tx, [stockLotId])).get(stockLotId);
      if (!lot || lot.itemId !== item.id) throw new UserError("Lô không thuộc hàng này");
      if (addsReceived) {
        await tx
          .update(stockLots)
          .set({ receivedQty: sql`${stockLots.receivedQty} + ${line.qty}`, receivedCost: sql`${stockLots.receivedCost} + ${line.lineCost}` })
          .where(eq(stockLots.id, stockLotId));
      }
      lotPending = lot.qcStatus === "pending";
    } else {
      // Lô mới
      let mfg = line.manufacturedOn;
      let exp = line.expiresOn;
      if (productLot) {
        mfg = productLot.manufacturedOn;
        exp = productLot.expiresOn;
      }
      const dates = resolveLineDates({ manufacturedOn: mfg, expiresOn: exp }, receipt.receivedOn, productLot ? null : item.shelfLifeDays, { newLot: true });
      if (!dates.ok) throw new UserError(`${item.code}: ${dates.message}`);
      const qcStatus: StockLotQcStatus | null = productLot ? null : line.qcRequired ? "pending" : "released";
      const created = await createStockLot(tx, {
        itemId: item.id,
        prefix: kind === "extraction" ? "EX" : "VT",
        code: productLot?.lotNo,
        productLotId: productLot?.id ?? null,
        supplierId: receipt.supplierId,
        supplierLotNo: line.supplierLotNo,
        manufacturedOn: dates.manufacturedOn,
        expiresOn: dates.expiresOn,
        receivedQty: line.qty,
        receivedCost: line.lineCost,
        qcStatus,
        source: { docType: "receipt", docId: receiptId },
        productionOrderId,
        extractionRunId,
      });
      stockLotId = created.id;
      lotPending = qcStatus === "pending";
      await tx
        .update(stockReceiptLines)
        .set({ stockLotId, manufacturedOn: dates.manufacturedOn, expiresOn: dates.expiresOn })
        .where(eq(stockReceiptLines.id, line.id));
    }
    out.push({ lineId: line.id, stockLotId });
    if (lotPending) pendingLines.push({ lineId: line.id, stockLotId });
    moves.push({
      type: RECEIPT_MOVE[kind],
      stockLotId,
      locationId,
      qty: line.qty,
      productionOrderId,
      extractionRunId,
      orderItemId: opts.orderItemByLine?.get(line.id) ?? null,
      note: line.note,
    });
  }
  if (total > 2_147_483_647) throw new UserError("Tổng giá trị phiếu quá lớn");

  await postMovements(tx, { docType: "receipt", docId: receiptId, docCode: receipt.code, actorId, at: opts.at }, moves);

  // Lô chờ kiểm → phiếu IQC (mẻ chiết: IPQC) trong cùng giao dịch (R-KHO-13 bước 4)
  for (const p of pendingLines) {
    await createInspection(
      tx,
      {
        stage: kind === "extraction" ? "ipqc" : "iqc",
        stockLotId: p.stockLotId,
        receiptId,
        receiptLineId: p.lineId,
        supplierId: receipt.supplierId,
        extractionRunId,
        productionOrderId,
      },
      actorId,
    );
  }

  // Tiền (R-KHO-15)
  if ((kind === "purchase" || kind === "other") && supplier && total > 0) {
    const allPackaging = lines.every((l) => items.get(l.itemId)?.kind === "packaging");
    const categoryCode = allPackaging ? "CHI-BAO-BI" : "CHI-NGUYEN-LIEU";
    if (receipt.paymentMode === "payable") {
      await openPayable(
        tx,
        {
          supplierId: supplier.id,
          categoryCode,
          source: { type: "stock_receipt", id: receiptId, code: receipt.code },
          amount: total,
          issuedOn: receipt.receivedOn,
          dueOn: addDays(receipt.receivedOn, supplier.paymentTermsDays),
        },
        actorId,
      );
    } else if (receipt.paymentMode === "paid_now") {
      if (!receipt.payAccountId) throw new UserError("Chọn tài khoản trả tiền");
      await recordCashTransaction(
        tx,
        {
          direction: "out",
          accountId: receipt.payAccountId,
          amount: total,
          categoryCode,
          occurredOn: receipt.receivedOn,
          counterparty: { type: "supplier", id: supplier.id, name: supplier.name },
          source: { type: "stock_receipt", id: receiptId, code: receipt.code },
          idempotencyKey: `receipt-paid:${receiptId}`,
        },
        actorId,
      );
    }
  }

  await tx.update(stockReceipts).set({ totalCost: total }).where(eq(stockReceipts.id, receiptId));
  await writeAudit(tx, {
    actorId,
    action: "stock_receipt.posted",
    entity: "stock_receipts",
    entityId: receiptId,
    before: { status: receipt.status },
    after: { status: "posted", code: receipt.code, kind, totalCost: total, lines: out.length },
  });
  return { lines: out };
}

// Hủy phiếu nhập đã ghi sổ (R-KHO-16). Quyền inventory.approve kiểm ở tầng action.
export async function cancelReceipt(tx: Tx, receiptId: string, reason: string, actorId: string | null): Promise<{ reversed: number }> {
  const why = reason.trim();
  if (!why) throw new UserError("Ghi lý do hủy phiếu");
  const receipt = await tx.query.stockReceipts.findFirst({ where: eq(stockReceipts.id, receiptId) });
  if (!receipt) throw new UserError("Không tìm thấy phiếu nhập");
  if (receipt.status === "draft") {
    const [row] = await tx
      .update(stockReceipts)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: why, updatedAt: new Date() })
      .where(and(eq(stockReceipts.id, receiptId), eq(stockReceipts.status, "draft")))
      .returning({ id: stockReceipts.id });
    if (!row) throw new UserError(STALE_MESSAGE);
    await writeAudit(tx, { actorId, action: "stock_receipt.cancelled", entity: "stock_receipts", entityId: receiptId, before: { status: "draft" }, after: { status: "cancelled", reason: why } });
    return { reversed: 0 };
  }
  if (receipt.status !== "posted") throw new UserError(STALE_MESSAGE);

  // Lô do phiếu tạo không được có biến động khác
  const createdLots = await tx
    .select({ id: stockLots.id, code: stockLots.code })
    .from(stockLots)
    .where(and(eq(stockLots.sourceDocType, "receipt"), eq(stockLots.sourceDocId, receiptId)));
  for (const lot of createdLots) {
    const [other] = await tx
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(and(eq(stockMovements.stockLotId, lot.id), sql`not (${stockMovements.docType} = 'receipt' and ${stockMovements.docId} = ${receiptId})`))
      .limit(1);
    if (other) throw new UserError(`Lô ${lot.code} đã có xuất kho, lập phiếu trả NCC thay vì hủy`);
  }

  // Tiền
  const debt = await findDebtBySource(tx, { kind: "payable", sourceType: "stock_receipt", sourceId: receiptId });
  if (debt && debt.status !== "cancelled") {
    if (debt.paidAmount > 0) throw new UserError("Phiếu đã có thanh toán, hủy thanh toán trước");
    await cancelDebt(tx, { kind: "payable", debtId: debt.id, reason: `Hủy phiếu nhập ${receipt.code}: ${why}` }, actorId);
  }
  if (receipt.paymentMode === "paid_now") {
    await cancelCashTransaction(tx, { idempotencyKey: `receipt-paid:${receiptId}` }, `Hủy phiếu nhập ${receipt.code}: ${why}`, actorId);
  }

  const [claimed] = await tx
    .update(stockReceipts)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: why, updatedAt: new Date() })
    .where(and(eq(stockReceipts.id, receiptId), eq(stockReceipts.status, "posted")))
    .returning({ id: stockReceipts.id });
  if (!claimed) throw new UserError(STALE_MESSAGE);

  const movements = await tx
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(and(eq(stockMovements.docType, "receipt"), eq(stockMovements.docId, receiptId), ne(stockMovements.type, "reversal")));
  const rev = await reverseMovements(
    tx,
    { docType: "receipt", docId: receiptId, docCode: receipt.code, actorId },
    movements.map((m) => m.id),
  );

  // Nhập vào lô có sẵn: trừ lại received_* đã cộng
  const addsReceived = ["purchase", "opening", "other", "production", "extraction"].includes(receipt.kind);
  if (addsReceived) {
    const createdIds = new Set(createdLots.map((l) => l.id));
    const lines = await tx.select().from(stockReceiptLines).where(eq(stockReceiptLines.receiptId, receiptId));
    for (const l of lines) {
      if (!l.stockLotId || createdIds.has(l.stockLotId)) continue;
      await tx
        .update(stockLots)
        .set({ receivedQty: sql`greatest(1, ${stockLots.receivedQty} - ${l.qty})`, receivedCost: sql`greatest(0, ${stockLots.receivedCost} - ${l.lineCost})` })
        .where(eq(stockLots.id, l.stockLotId));
    }
  }

  // Phiếu IQC chờ của phiếu nhập → cancelled qua hàm dùng chung của Chất lượng (ghi lý do, audit từng phiếu)
  await cancelPendingInspectionsOfReceipt(tx, receiptId, `Hủy phiếu nhập ${receipt.code}: ${why}`, actorId);

  await writeAudit(tx, {
    actorId,
    action: "stock_receipt.cancelled",
    entity: "stock_receipts",
    entityId: receiptId,
    before: { status: "posted" },
    after: { status: "cancelled", reason: why, reversed: rev.movementIds.length },
  });
  return { reversed: rev.movementIds.length };
}

// ---------------------------------------------------------------------------------------------
// Phiếu xuất tay (R-KHO-11, R-KHO-17)

export async function createIssueDraft(tx: Tx, input: IssueInput, actorId: string): Promise<{ issueId: string; code: string }> {
  if (input.lines.length === 0) throw new UserError("Phiếu xuất chưa có dòng nào");
  const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
  const itemRows = await tx.select({ id: inventoryItems.id, code: inventoryItems.code, isActive: inventoryItems.isActive }).from(inventoryItems).where(inArray(inventoryItems.id, itemIds));
  const items = new Map(itemRows.map((i) => [i.id, i]));
  const lotMap = await loadLots(tx, input.lines.map((l) => l.stockLotId).filter((x): x is string => !!x));
  for (const l of input.lines) {
    const item = items.get(l.itemId);
    if (!item) throw new UserError("Không tìm thấy hàng hóa");
    if (!item.isActive) throw new UserError(`Hàng ${item.code} đã ngừng dùng`);
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0 || l.qty > MAX_QTY) throw new UserError("Số lượng xuất phải lớn hơn 0");
    if (l.stockLotId && lotMap.get(l.stockLotId)?.itemId !== l.itemId) throw new UserError("Lô không thuộc hàng này");
  }
  if (input.warehouseId) {
    const [wh] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, input.warehouseId));
    if (!wh) throw new UserError("Không tìm thấy kho");
  }
  const code = await nextDocCode(tx, "PX");
  const [row] = await tx
    .insert(stockIssues)
    .values({
      code,
      kind: input.kind,
      status: "draft",
      warehouseId: input.warehouseId ?? null,
      productionOrderId: input.productionOrderId ?? null,
      extractionRunId: input.extractionRunId ?? null,
      purpose: input.purpose ?? null,
      note: input.note ?? null,
      fileIds: input.fileIds ?? [],
      requestedBy: actorId,
    })
    .returning({ id: stockIssues.id });
  await tx.insert(stockIssueLines).values(
    input.lines.map((l) => ({ issueId: row!.id, itemId: l.itemId, qty: l.qty, stockLotId: l.stockLotId ?? null, locationId: l.locationId ?? null, note: l.note ?? null })),
  );
  await writeAudit(tx, { actorId, action: "stock_issue.created", entity: "stock_issues", entityId: row!.id, after: { code, kind: input.kind, lines: input.lines.length } });
  return { issueId: row!.id, code };
}

// Lập và ghi sổ ngay khi được phép: kind production/extraction (Sản xuất gọi) hoặc người lập có inventory.approve.
// Người khác: phiếu vào "chờ duyệt", tồn chưa đổi.
export async function postIssue(tx: Tx, input: IssueInput, actorId: string): Promise<{ issueId: string; code: string; status: "posted" | "pending_approval"; movementIds: string[] }> {
  const { issueId, code } = await createIssueDraft(tx, input, actorId);
  const direct = input.kind === "production" || input.kind === "extraction" || (await actorCan(tx, actorId, "inventory.approve"));
  if (!direct) {
    await submitIssue(tx, issueId, actorId);
    return { issueId, code, status: "pending_approval", movementIds: [] };
  }
  const r = await postIssueDraft(tx, issueId, actorId);
  return { issueId, code, status: "posted", movementIds: r.movementIds };
}

// Nháp → chờ duyệt
export async function submitIssue(tx: Tx, issueId: string, actorId: string): Promise<void> {
  const [row] = await tx
    .update(stockIssues)
    .set({ status: "pending_approval", updatedAt: new Date() })
    .where(and(eq(stockIssues.id, issueId), eq(stockIssues.status, "draft")))
    .returning({ id: stockIssues.id });
  if (!row) throw new UserError(STALE_MESSAGE);
  await writeAudit(tx, { actorId, action: "stock_issue.submitted", entity: "stock_issues", entityId: issueId, before: { status: "draft" }, after: { status: "pending_approval" } });
}

// Từ chối (chờ duyệt → hủy) hoặc xóa nháp
export async function rejectIssue(tx: Tx, issueId: string, reason: string, actorId: string): Promise<void> {
  const issue = await tx.query.stockIssues.findFirst({ where: eq(stockIssues.id, issueId) });
  if (!issue) throw new UserError("Không tìm thấy phiếu xuất");
  if (issue.status !== "draft" && issue.status !== "pending_approval") throw new UserError(STALE_MESSAGE);
  const why = reason.trim();
  if (issue.status === "pending_approval" && !why) throw new UserError("Ghi lý do từ chối");
  const [row] = await tx
    .update(stockIssues)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: why || null, updatedAt: new Date() })
    .where(and(eq(stockIssues.id, issueId), eq(stockIssues.status, issue.status)))
    .returning({ id: stockIssues.id });
  if (!row) throw new UserError(STALE_MESSAGE);
  await writeAudit(tx, { actorId, action: "stock_issue.cancelled", entity: "stock_issues", entityId: issueId, before: { status: issue.status }, after: { status: "cancelled", reason: why } });
}

// Ghi sổ phiếu xuất nháp hoặc duyệt phiếu chờ duyệt. Kiểm tồn lúc ghi sổ; FEFO cho dòng chưa chọn lô, tách dòng khi ra nhiều lô.
// Quyền (inventory.approve với phiếu tay) kiểm ở tầng action.
export async function postIssueDraft(tx: Tx, issueId: string, actorId: string): Promise<{ movementIds: string[] }> {
  const issue = await tx.query.stockIssues.findFirst({ where: eq(stockIssues.id, issueId) });
  if (!issue) throw new UserError("Không tìm thấy phiếu xuất");
  if (issue.status !== "draft" && issue.status !== "pending_approval") throw new UserError(STALE_MESSAGE);
  const approving = issue.status === "pending_approval";
  const now = new Date();
  const [claimed] = await tx
    .update(stockIssues)
    .set({ status: "posted", postedBy: actorId, postedAt: now, updatedAt: now, ...(approving ? { approvedBy: actorId, approvedAt: now } : {}) })
    .where(and(eq(stockIssues.id, issueId), eq(stockIssues.status, issue.status)))
    .returning({ id: stockIssues.id });
  if (!claimed) throw new UserError(STALE_MESSAGE);

  const type = ISSUE_MOVE[issue.kind];
  const needsUsable = moveNeedsUsableLot(type);
  let kinds = moveKinds(type);
  if (issue.warehouseId) {
    const [wh] = await tx.select({ kind: warehouses.kind }).from(warehouses).where(eq(warehouses.id, issue.warehouseId));
    kinds = wh ? [wh.kind] : [];
  }
  const today = vnToday();
  const lines = await tx.select().from(stockIssueLines).where(eq(stockIssueLines.issueId, issueId)).orderBy(asc(stockIssueLines.createdAt), asc(stockIssueLines.id));
  const itemRows = await tx.select().from(inventoryItems).where(inArray(inventoryItems.id, [...new Set(lines.map((l) => l.itemId))]));
  const items = new Map(itemRows.map((i) => [i.id, i]));
  const ref: StockDocRef = { docType: "issue", docId: issueId, docCode: issue.code, actorId };
  const movementIds: string[] = [];
  const supplierReturnValue = new Map<string, number>(); // receiptId → giá trị xuất trả

  for (const line of lines) {
    const item = items.get(line.itemId)!;
    const fmtItem = (q: number) => formatQty(q, item.baseUom, item.displayUom as DisplayUom);
    let picks: FefoPick[];
    let note = line.note;
    if (line.stockLotId) {
      const lot = (await loadLots(tx, [line.stockLotId])).get(line.stockLotId)!;
      if (needsUsable && !isLotUsable(lot, today)) throw new UserError(unusableLotMessage(lot.code, lot, today));
      const cands = await fefoCandidates(tx, { itemId: item.id, warehouseKinds: kinds, warehouseId: issue.warehouseId, stockLotId: lot.id, locationId: line.locationId }, today);
      const plan = planAny(cands, line.qty);
      if (!plan.ok) throw new UserError(`Lô ${lot.code} chỉ còn ${fmtItem(plan.available)}, không xuất được ${fmtItem(line.qty)}.`);
      picks = plan.picks;
      // Cảnh báo chọn tay bỏ qua FEFO (R-KHO-11)
      if (needsUsable) {
        const all = (await fefoCandidates(tx, { itemId: item.id, warehouseKinds: kinds, warehouseId: issue.warehouseId }, today)).filter((c) => c.usable);
        const mine = all.find((c) => c.stockLotId === lot.id);
        if (mine && all.some((c) => c.stockLotId !== lot.id && compareFefo(c, mine) < 0)) note = note ? `${note} · Chọn tay, bỏ qua FEFO` : "Chọn tay, bỏ qua FEFO";
      }
    } else {
      const cands = await fefoCandidates(tx, { itemId: item.id, warehouseKinds: kinds, warehouseId: issue.warehouseId, locationId: line.locationId }, today);
      const plan = needsUsable ? planFefo(cands, line.qty, today) : planAny(cands, line.qty);
      if (!plan.ok) throw new UserError(`Không đủ hàng khả dụng cho ${item.code} ${item.name}: cần ${fmtItem(line.qty)}, còn ${fmtItem(plan.available)}`);
      picks = plan.picks;
    }

    // Tách dòng: dòng gốc giữ pick đầu, thêm dòng cho các pick sau
    const [first, ...rest] = picks;
    await tx.update(stockIssueLines).set({ stockLotId: first!.stockLotId, locationId: first!.locationId, qty: first!.qty, note }).where(eq(stockIssueLines.id, line.id));
    if (rest.length) {
      await tx.insert(stockIssueLines).values(rest.map((p) => ({ issueId, itemId: item.id, stockLotId: p.stockLotId, locationId: p.locationId, qty: p.qty, note })));
    }
    const r = await postMovements(
      tx,
      ref,
      picks.map((p) => ({ type, stockLotId: p.stockLotId, locationId: p.locationId, qty: -p.qty, productionOrderId: issue.productionOrderId, extractionRunId: issue.extractionRunId, note })),
    );
    movementIds.push(...r.movementIds);

    if (issue.kind === "supplier_return") {
      const lotInfo = await loadLots(tx, picks.map((p) => p.stockLotId));
      for (const p of picks) {
        const lot = lotInfo.get(p.stockLotId)!;
        if (lot.sourceDocType !== "receipt") continue;
        const value = costOfQty(p.qty, lot.receivedQty, lot.receivedCost);
        supplierReturnValue.set(lot.sourceDocId, (supplierReturnValue.get(lot.sourceDocId) ?? 0) + value);
      }
    }
  }

  // Trả NCC: giảm công nợ phiếu nhập gốc nếu còn (R-KHO-17, R-TC-12)
  for (const [receiptId, value] of supplierReturnValue) {
    if (value <= 0) continue;
    const debt = await findDebtBySource(tx, { kind: "payable", sourceType: "stock_receipt", sourceId: receiptId });
    if (!debt || debt.status === "cancelled" || debt.status === "paid") continue;
    const target = Math.max(debt.paidAmount, debt.amount - value);
    if (target === debt.amount) continue;
    if (target <= 0) await cancelDebt(tx, { kind: "payable", debtId: debt.id, reason: `Trả NCC theo ${issue.code}` }, actorId);
    else await adjustDebtAmount(tx, { kind: "payable", debtId: debt.id, newAmount: target, reason: `Trả NCC theo ${issue.code}` }, actorId);
  }

  await writeAudit(tx, {
    actorId,
    action: approving ? "stock_issue.approved" : "stock_issue.posted",
    entity: "stock_issues",
    entityId: issueId,
    before: { status: issue.status },
    after: { status: "posted", movements: movementIds.length },
  });
  return { movementIds };
}

// ---------------------------------------------------------------------------------------------
// Điều chuyển (R-KHO-18, R-KHO-35)

export type TransferInput = {
  fromWarehouseId: string;
  toWarehouseId: string;
  reason?: string;
  source?: { type: string; id: string } | null;
  lines: { stockLotId: string; qty: number; fromLocationId?: string | null; toLocationId?: string | null }[];
};

export async function createTransferDraft(tx: Tx, input: TransferInput, actorId: string | null): Promise<{ transferId: string; code: string }> {
  if (input.lines.length === 0) throw new UserError("Phiếu điều chuyển chưa có dòng nào");
  const lotMap = await loadLots(tx, input.lines.map((l) => l.stockLotId));
  const toDefault = await defaultLocationId(tx, input.toWarehouseId);
  const resolved = [];
  for (const l of input.lines) {
    const lot = lotMap.get(l.stockLotId);
    if (!lot) throw new UserError("Không tìm thấy lô");
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0) throw new UserError("Số lượng chuyển phải lớn hơn 0");
    let fromLocationId = l.fromLocationId ?? null;
    if (!fromLocationId) {
      const here = await tx
        .select({ locationId: stockBalances.locationId })
        .from(stockBalances)
        .where(and(eq(stockBalances.stockLotId, lot.id), eq(stockBalances.warehouseId, input.fromWarehouseId), gt(stockBalances.qty, 0)));
      fromLocationId = here.length === 1 ? here[0]!.locationId : await defaultLocationId(tx, input.fromWarehouseId);
    }
    resolved.push({ stockLotId: lot.id, itemId: lot.itemId, fromLocationId, toLocationId: l.toLocationId ?? toDefault, qty: l.qty });
  }
  const code = await nextDocCode(tx, "DCK");
  const [row] = await tx
    .insert(stockTransfers)
    .values({
      code,
      status: "draft",
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      reason: input.reason ?? "",
      sourceType: input.source?.type ?? null,
      sourceId: input.source?.id ?? null,
      createdBy: actorId,
    })
    .returning({ id: stockTransfers.id });
  await tx.insert(stockTransferLines).values(resolved.map((r) => ({ ...r, transferId: row!.id })));
  return { transferId: row!.id, code };
}

export async function postTransferDraft(tx: Tx, transferId: string, actorId: string | null, opts: { skipRejectedExitCheck?: boolean } = {}): Promise<{ movementIds: string[] }> {
  const tr = await tx.query.stockTransfers.findFirst({ where: eq(stockTransfers.id, transferId) });
  if (!tr) throw new UserError("Không tìm thấy phiếu điều chuyển");
  if (tr.status !== "draft") throw new UserError(STALE_MESSAGE);
  const [claimed] = await tx
    .update(stockTransfers)
    .set({ status: "posted", postedBy: actorId, postedAt: new Date() })
    .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.status, "draft")))
    .returning({ id: stockTransfers.id });
  if (!claimed) throw new UserError(STALE_MESSAGE);

  const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, transferId));
  const locMap = await loadLocations(tx, lines.flatMap((l) => [l.fromLocationId, l.toLocationId]));
  const lotMap = await loadLots(tx, lines.map((l) => l.stockLotId));
  const today = vnToday();
  const moves: StockMoveInput[] = [];
  for (const l of lines) {
    const from = locMap.get(l.fromLocationId)!;
    const to = locMap.get(l.toLocationId)!;
    const lot = lotMap.get(l.stockLotId)!;
    if (from.warehouseId !== tr.fromWarehouseId) throw new UserError("Vị trí nguồn không thuộc kho nguồn");
    if (to.warehouseId !== tr.toWarehouseId) throw new UserError("Vị trí đích không thuộc kho đích");
    if (l.fromLocationId === l.toLocationId) throw new UserError("Vị trí nguồn và đích phải khác nhau");
    if (!opts.skipRejectedExitCheck && from.warehouseKind === "rejected" && to.warehouseKind !== "rejected" && !isLotUsable(lot, today)) {
      throw new UserError("Lô không đạt, không đưa ra khỏi kho cách ly");
    }
    moves.push({ type: "transfer_out", stockLotId: l.stockLotId, locationId: l.fromLocationId, qty: -l.qty });
    moves.push({ type: "transfer_in", stockLotId: l.stockLotId, locationId: l.toLocationId, qty: l.qty });
  }
  const r = await postMovements(tx, { docType: "transfer", docId: transferId, docCode: tr.code, actorId }, moves);
  await writeAudit(tx, { actorId, action: "stock_transfer.posted", entity: "stock_transfers", entityId: transferId, before: { status: "draft" }, after: { status: "posted", lines: lines.length } });
  return r;
}

export async function postTransfer(tx: Tx, input: TransferInput, actorId: string | null): Promise<{ transferId: string; code: string; movementIds: string[] }> {
  const d = await createTransferDraft(tx, input, actorId);
  const r = await postTransferDraft(tx, d.transferId, actorId);
  return { ...d, movementIds: r.movementIds };
}

export async function transferLotBalance(
  tx: Tx,
  input: { stockLotId: string; toWarehouseKind: WarehouseKind; reason: string; source?: { type: string; id: string } | null },
  actorId: string | null,
): Promise<{ transferId: string | null; qty: number }> {
  const balances = await tx
    .select({ locationId: stockBalances.locationId, warehouseId: stockBalances.warehouseId, qty: stockBalances.qty, locCode: warehouseLocations.code })
    .from(stockBalances)
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .innerJoin(warehouseLocations, eq(warehouseLocations.id, stockBalances.locationId))
    .where(and(eq(stockBalances.stockLotId, input.stockLotId), gt(stockBalances.qty, 0), ne(warehouses.kind, input.toWarehouseKind)))
    .orderBy(asc(warehouseLocations.code));
  if (balances.length === 0) return { transferId: null, qty: 0 };
  const dest = await warehouseOfKind(tx, input.toWarehouseKind);
  const toLoc = await defaultLocationId(tx, dest.id);
  const d = await createTransferDraft(
    tx,
    {
      fromWarehouseId: balances[0]!.warehouseId,
      toWarehouseId: dest.id,
      reason: input.reason,
      source: input.source,
      lines: balances.map((b) => ({ stockLotId: input.stockLotId, qty: b.qty, fromLocationId: b.locationId, toLocationId: toLoc })),
    },
    actorId,
  );
  // Phiếu có thể gom số dư từ nhiều kho: kho nguồn trên phiếu là kho đầu tiên; mỗi dòng giữ vị trí nguồn thật.
  const tr = await tx.query.stockTransfers.findFirst({ where: eq(stockTransfers.id, d.transferId) });
  const [claimed] = await tx
    .update(stockTransfers)
    .set({ status: "posted", postedBy: actorId, postedAt: new Date() })
    .where(and(eq(stockTransfers.id, d.transferId), eq(stockTransfers.status, "draft")))
    .returning({ id: stockTransfers.id });
  if (!claimed || !tr) throw new UserError(STALE_MESSAGE);
  const moves: StockMoveInput[] = balances.flatMap((b) => [
    { type: "transfer_out" as const, stockLotId: input.stockLotId, locationId: b.locationId, qty: -b.qty },
    { type: "transfer_in" as const, stockLotId: input.stockLotId, locationId: toLoc, qty: b.qty },
  ]);
  if (input.toWarehouseKind !== "rejected") {
    const lot = (await loadLots(tx, [input.stockLotId])).get(input.stockLotId)!;
    const locMap = await loadLocations(tx, balances.map((b) => b.locationId));
    if (balances.some((b) => locMap.get(b.locationId)?.warehouseKind === "rejected") && !isLotUsable(lot, vnToday())) {
      throw new UserError("Lô không đạt, không đưa ra khỏi kho cách ly");
    }
  }
  await postMovements(tx, { docType: "transfer", docId: d.transferId, docCode: d.code, actorId }, moves);
  const qty = balances.reduce((s, b) => s + b.qty, 0);
  await writeAudit(tx, {
    actorId,
    action: "stock_transfer.posted",
    entity: "stock_transfers",
    entityId: d.transferId,
    after: { status: "posted", stockLotId: input.stockLotId, to: dest.code, qty, reason: input.reason, source: input.source ?? null },
  });
  return { transferId: d.transferId, qty };
}

// ---------------------------------------------------------------------------------------------
// Trạng thái lô vật tư (R-KHO-36)

const QC_LABEL: Record<StockLotQcStatus, string> = { pending: "pending", released: "released", rejected: "rejected", on_hold: "on_hold" };

// opts.releaseNote: ghi chú giữ lại ở hold_reason khi duyệt (IQC "Chấp nhận có điều kiện", R-CL-8); mặc định duyệt thì xóa lý do.
export async function setStockLotQcStatus(
  tx: Tx,
  stockLotId: string,
  to: StockLotQcStatus,
  reason: string | null,
  actorId: string | null,
  opts: { releaseNote?: string | null } = {},
): Promise<void> {
  const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, stockLotId));
  if (!lot) throw new UserError("Không tìm thấy lô");
  if (lot.productLotId || lot.qcStatus === null) throw new UserError("Lô thành phẩm đổi trạng thái ở Lô và kiểm nghiệm");
  const from = lot.qcStatus;
  if (from === to) return;
  if (!canChangeQcStatus(from, to)) throw new UserError(`Không chuyển lô từ ${QC_LABEL[from]} sang ${QC_LABEL[to]}`);
  const why = reason?.trim() || null;
  if ((to === "on_hold" || to === "rejected") && !why) throw new UserError("Ghi lý do khi giữ hoặc loại lô");
  const releaseNote = opts.releaseNote?.trim() || null;
  const [row] = await tx
    .update(stockLots)
    .set({ qcStatus: to, holdReason: to === "released" ? releaseNote : why })
    .where(and(eq(stockLots.id, stockLotId), eq(stockLots.qcStatus, from)))
    .returning({ id: stockLots.id });
  if (!row) throw new UserError(STALE_MESSAGE);
  await writeAudit(tx, { actorId, action: "stock_lot.qc_status", entity: "stock_lots", entityId: stockLotId, before: { qcStatus: from }, after: { qcStatus: to, reason: why, ...(to === "released" && releaseNote ? { releaseNote } : {}) } });
}

// ---------------------------------------------------------------------------------------------
// Số bán được (R-KHO-23, R-KHO-24, INV-3)

async function finishedItemOf(db: Db | Tx, productId: string): Promise<string | null> {
  const [row] = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.productId, productId)).limit(1);
  return row?.id ?? null;
}

// Đã giữ cho đơn: đơn pending/confirmed/packing chưa xuất kho
export async function reservedQty(db: Db | Tx, productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({ productId: orderItems.productId, qty: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(inArray(orderItems.productId, productIds), inArray(orders.status, ["pending", "confirmed", "packing"]), isNull(orders.stockIssuedAt)))
    .groupBy(orderItems.productId);
  return new Map(rows.map((r) => [r.productId, Number(r.qty)]));
}

async function availableFgOf(db: Db | Tx, itemId: string | null, today: string): Promise<number> {
  if (!itemId) return 0;
  const cands = await fefoCandidates(db, { itemId, warehouseKinds: ["finished"] }, today);
  return cands.filter((c) => c.usable).reduce((s, c) => s + c.qty, 0);
}

export async function syncSellableStock(tx: Tx, productId: string): Promise<{ tracked: boolean; stock: number; availableFg: number; reserved: number }> {
  const [p] = await tx.select({ id: products.id, stock: products.stock, track: products.trackInventory }).from(products).where(eq(products.id, productId)).for("update");
  if (!p) throw new UserError("Không tìm thấy sản phẩm");
  if (!p.track) return { tracked: false, stock: p.stock, availableFg: 0, reserved: 0 };
  const today = vnToday();
  const availableFg = await availableFgOf(tx, await finishedItemOf(tx, productId), today);
  const reserved = (await reservedQty(tx, [productId])).get(productId) ?? 0;
  const stock = sellableStock(availableFg, reserved);
  if (stock !== p.stock) {
    await tx.update(products).set({ stock, updatedAt: new Date() }).where(eq(products.id, productId));
    await writeAudit(tx, {
      actorId: null,
      action: "product.stock_synced",
      entity: "products",
      entityId: productId,
      before: { stock: p.stock },
      after: { stock, availableFg, reserved },
    });
  }
  return { tracked: true, stock, availableFg, reserved };
}

// Xem trước khi bật quản lý kho (R-KHO-25): "265 → 0 (khả dụng 0, đang giữ 0)"
export async function previewInventoryTracking(db: Db | Tx, productId: string): Promise<{ before: number; after: number; availableFg: number; reserved: number }> {
  const [p] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, productId));
  if (!p) throw new UserError("Không tìm thấy sản phẩm");
  const availableFg = await availableFgOf(db, await finishedItemOf(db, productId), vnToday());
  const reserved = (await reservedQty(db, [productId])).get(productId) ?? 0;
  return { before: p.stock, after: sellableStock(availableFg, reserved), availableFg, reserved };
}

// ---------------------------------------------------------------------------------------------
// Tồn theo hàng (R-KHO-9)

export async function getItemStock(db: Db | Tx, itemIds: string[], today?: string): Promise<Map<string, ItemStock>> {
  const ids = [...new Set(itemIds)];
  const result = new Map<string, ItemStock>(ids.map((id) => [id, { onHand: 0, available: 0, quarantine: 0, rejected: 0, expired: 0, reserved: 0, committed: 0 }]));
  if (ids.length === 0) return result;
  const day = today ?? vnToday();
  const rows = await db
    .select({
      itemId: stockBalances.itemId,
      qty: stockBalances.qty,
      warehouseKind: warehouses.kind,
      qcStatus: stockLots.qcStatus,
      productLotStatus: lots.releaseStatus,
      expiresOn: stockLots.expiresOn,
      productLotExpiresOn: lots.expiresOn,
    })
    .from(stockBalances)
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .innerJoin(stockLots, eq(stockLots.id, stockBalances.stockLotId))
    .leftJoin(lots, eq(lots.id, stockLots.productLotId))
    .where(and(inArray(stockBalances.itemId, ids), gt(stockBalances.qty, 0)));
  for (const r of rows) {
    const s = result.get(r.itemId)!;
    const bucket = classifyBalance({ warehouseKind: r.warehouseKind, qcStatus: r.qcStatus, productLotStatus: r.productLotStatus, expiresOn: r.expiresOn ?? r.productLotExpiresOn ?? null }, day);
    s[bucket] += r.qty;
    s.onHand += r.qty;
  }

  // Đã giữ (thành phẩm)
  const itemProducts = await db.select({ id: inventoryItems.id, productId: inventoryItems.productId }).from(inventoryItems).where(inArray(inventoryItems.id, ids));
  const productIds = itemProducts.map((i) => i.productId).filter((x): x is string => !!x);
  const reserved = await reservedQty(db, productIds);
  for (const i of itemProducts) if (i.productId) result.get(i.id)!.reserved = reserved.get(i.productId) ?? 0;

  // Đã cam kết (vật tư): max(0, kế hoạch − đã xuất ròng) theo từng lệnh approved/in_progress, Pomil cấp
  const mats = await db
    .select({ productionOrderId: productionOrderMaterials.productionOrderId, itemId: productionOrderMaterials.itemId, plannedQty: productionOrderMaterials.plannedQty })
    .from(productionOrderMaterials)
    .innerJoin(productionOrders, eq(productionOrders.id, productionOrderMaterials.productionOrderId))
    .where(and(inArray(productionOrderMaterials.itemId, ids), eq(productionOrderMaterials.suppliedBy, "pomil"), inArray(productionOrders.status, ["approved", "in_progress"])));
  if (mats.length) {
    const issued = await db
      .select({ productionOrderId: stockMovements.productionOrderId, itemId: stockMovements.itemId, net: sql<number>`coalesce(-sum(${stockMovements.qty}), 0)::bigint` })
      .from(stockMovements)
      .where(
        and(
          inArray(stockMovements.productionOrderId, [...new Set(mats.map((m) => m.productionOrderId))]),
          inArray(stockMovements.itemId, ids),
          inArray(stockMovements.type, ["production_issue", "production_return", "reversal"]),
        ),
      )
      .groupBy(stockMovements.productionOrderId, stockMovements.itemId);
    const net = new Map(issued.map((r) => [`${r.productionOrderId}:${r.itemId}`, Number(r.net)]));
    for (const m of mats) {
      result.get(m.itemId)!.committed += Math.max(0, m.plannedQty - (net.get(`${m.productionOrderId}:${m.itemId}`) ?? 0));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Lô hết hạn tự rời số bán được (R-KHO-27)

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export async function refreshExpiredStock(db: Db, now: Date = new Date()): Promise<{ productsSynced: number; skipped: boolean }> {
  // Ghi mốc trước khi chạy, trong giao dịch khóa dòng cài đặt, để hai lần mở cùng lúc không chạy đôi
  const go = await db.transaction(async (tx) => {
    const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, ERP_SETTINGS_KEY)).for("update");
    const current = parseErpSettings(row?.value);
    const last = current.lastExpiryRefreshAt ? Date.parse(current.lastExpiryRefreshAt) : NaN;
    if (Number.isFinite(last) && now.getTime() - last <= REFRESH_INTERVAL_MS) return false;
    const next = { ...current, lastExpiryRefreshAt: now.toISOString() };
    await tx
      .insert(settings)
      .values({ key: ERP_SETTINGS_KEY, value: next })
      .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
    return true;
  });
  if (!go) return { productsSynced: 0, skipped: true };
  const tracked = await db.select({ id: products.id }).from(products).where(eq(products.trackInventory, true)).orderBy(asc(products.id));
  await db.transaction(async (tx) => {
    for (const p of tracked) await syncSellableStock(tx, p.id);
  });
  return { productsSynced: tracked.length, skipped: false };
}

// ---------------------------------------------------------------------------------------------
// Xuất kho cho đơn (R-KHO-32, R-KHO-33, R-KHO-34)

export async function issueOrderStock(
  tx: Tx,
  orderId: string,
  input: { picks?: { orderItemId: string; stockLotId: string; qty: number }[] },
  actorId: string,
): Promise<{ ok: true; lines: { orderItemId: string; lotId: string; qty: number }[] } | { ok: false; message: string }> {
  const order = await tx.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return { ok: false, message: "Không tìm thấy đơn" };
  if ((order.status !== "confirmed" && order.status !== "packing") || order.stockIssuedAt) return { ok: false, message: STALE_MESSAGE };

  const lines = await tx
    .select({ item: orderItems, itemId: inventoryItems.id })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .leftJoin(inventoryItems, eq(inventoryItems.productId, orderItems.productId))
    .where(and(eq(orderItems.orderId, orderId), eq(products.trackInventory, true)))
    // Dòng gốc trước dòng tách (xuất lại sau khi đảo), rồi theo id cho ổn định
    .orderBy(sql`${orderItems.splitFromId} is not null`, asc(orderItems.id));
  if (lines.length === 0) return { ok: true, lines: [] };

  const today = vnToday();
  // Lập kế hoạch cho cả đơn trên bản sao số dư trong bộ nhớ: thiếu ở dòng nào thì chưa ghi gì
  const pool = new Map<string, FefoCandidate[]>();
  const poolOf = async (itemId: string) => {
    if (!pool.has(itemId)) pool.set(itemId, await fefoCandidates(tx, { itemId, warehouseKinds: ["finished"] }, today));
    return pool.get(itemId)!;
  };
  const plans: { line: typeof orderItems.$inferSelect; picks: FefoPick[] }[] = [];
  for (const { item: line, itemId } of lines) {
    if (!itemId) return { ok: false, message: `Chưa có hàng thành phẩm cho ${line.productName}` };
    const cands = await poolOf(itemId);
    const given = input.picks?.filter((p) => p.orderItemId === line.id) ?? [];
    let picks: FefoPick[] = [];
    if (given.length) {
      if (given.reduce((s, p) => s + p.qty, 0) !== line.quantity) return { ok: false, message: `Số chai chọn theo lô cho ${line.productName} phải bằng ${line.quantity}` };
      for (const g of given) {
        const ofLot = cands.filter((c) => c.stockLotId === g.stockLotId);
        if (ofLot.length === 0) return { ok: false, message: `Lô đã chọn không có hàng ${line.productName} trong kho thành phẩm` };
        // Câu lỗi theo nguyên nhân (R-KHO-11, AC-TICHHOP-18): hết hạn, đang giữ, không đạt, chờ kiểm
        if (!ofLot[0]!.usable) return { ok: false, message: ofLot[0]!.unusableMessage ?? `Lô ${ofLot[0]!.code} chưa xuất được` };
        const plan = planFefo(ofLot, g.qty, today);
        if (!plan.ok) return { ok: false, message: `Không đủ hàng khả dụng cho ${line.productName} ở lô ${ofLot[0]!.code}: cần ${g.qty}, còn ${plan.available}` };
        picks.push(...plan.picks);
      }
    } else {
      const plan = planFefo(cands, line.quantity, today);
      if (!plan.ok) return { ok: false, message: `Không đủ hàng khả dụng cho ${line.productName}: cần ${line.quantity}, còn ${plan.available}` };
      picks = plan.picks;
    }
    for (const p of picks) {
      const c = cands.find((x) => x.stockLotId === p.stockLotId && x.locationId === p.locationId)!;
      c.qty -= p.qty;
    }
    plans.push({ line, picks });
  }

  // Giữ chỗ có điều kiện (R-CHUNG-9) trước khi ghi kho
  const [claimed] = await tx
    .update(orders)
    .set({ stockIssuedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), isNull(orders.stockIssuedAt), inArray(orders.status, ["confirmed", "packing"])))
    .returning({ id: orders.id });
  if (!claimed) return { ok: false, message: STALE_MESSAGE };

  const lotInfo = await loadLots(tx, plans.flatMap((p) => p.picks.map((x) => x.stockLotId)));
  const out: { orderItemId: string; lotId: string; qty: number }[] = [];
  const moves: StockMoveInput[] = [];
  for (const { line, picks } of plans) {
    // Gom pick theo lô: mỗi dòng đơn một lô
    const byLot = new Map<string, FefoPick[]>();
    for (const p of picks) byLot.set(p.stockLotId, [...(byLot.get(p.stockLotId) ?? []), p]);
    const groups = [...byLot.entries()];
    const extraTotals = groups.slice(1).map(([, ps]) => line.unitPrice * ps.reduce((s, p) => s + p.qty, 0));
    let idx = 0;
    for (const [stockLotId, ps] of groups) {
      const qty = ps.reduce((s, p) => s + p.qty, 0);
      const lotId = lotInfo.get(stockLotId)!.productLotId!;
      let orderItemId = line.id;
      if (idx === 0) {
        // Dòng gốc giữ phần lô đầu; phần dư tiền (nếu line_total khác đơn giá × số) dồn vào dòng gốc để tổng không đổi
        const lineTotal = line.lineTotal - extraTotals.reduce((s, t) => s + t, 0);
        await tx.update(orderItems).set({ quantity: qty, lineTotal, lotId }).where(eq(orderItems.id, line.id));
      } else {
        const [row] = await tx
          .insert(orderItems)
          .values({ orderId, productId: line.productId, productName: line.productName, unitPrice: line.unitPrice, quantity: qty, lineTotal: extraTotals[idx - 1]!, lotId, splitFromId: line.id })
          .returning({ id: orderItems.id });
        orderItemId = row!.id;
      }
      for (const p of ps) moves.push({ type: "sale_issue", stockLotId, locationId: p.locationId, qty: -p.qty, orderItemId });
      out.push({ orderItemId, lotId, qty });
      idx++;
    }
  }
  await postMovements(tx, { docType: "order", docId: orderId, docCode: order.code, actorId }, moves);
  const lotCodes = new Map([...lotInfo.values()].map((l) => [l.productLotId, l.code]));
  await tx.insert(orderEvents).values({
    orderId,
    type: "stock_issued",
    note: `Xuất kho: ${out.map((o) => `${o.qty} chai lô ${lotCodes.get(o.lotId) ?? ""}`).join(", ")}`,
    actorId,
  });
  await writeAudit(tx, { actorId, action: "order.stock_issued", entity: "orders", entityId: orderId, after: { lines: out } });
  return { ok: true, lines: out };
}

export async function reverseOrderStock(tx: Tx, orderId: string, actorId: string): Promise<{ reversed: number }> {
  const order = await tx.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw new UserError("Không tìm thấy đơn");
  const issued = await tx
    .select({ id: stockMovements.id, orderItemId: stockMovements.orderItemId, itemId: stockMovements.itemId })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.docType, "order"),
        eq(stockMovements.docId, orderId),
        eq(stockMovements.type, "sale_issue"),
        sql`not exists (select 1 from stock_movements r where r.reversal_of = ${stockMovements.id})`,
      ),
    );
  if (issued.length) {
    await reverseMovements(
      tx,
      { docType: "order", docId: orderId, docCode: order.code, actorId },
      issued.map((m) => m.id),
    );
    const itemIds = [...new Set(issued.map((m) => m.orderItemId).filter((x): x is string => !!x))];
    if (itemIds.length) await tx.update(orderItems).set({ lotId: null }).where(inArray(orderItems.id, itemIds));
    await tx.insert(orderEvents).values({ orderId, type: "stock_reversed", note: `Đảo xuất kho ${issued.length} dòng`, actorId });
    await writeAudit(tx, { actorId, action: "order.stock_reversed", entity: "orders", entityId: orderId, after: { reversed: issued.length } });
  }
  await tx.update(orders).set({ stockIssuedAt: null, updatedAt: new Date() }).where(eq(orders.id, orderId));
  // "Đã giữ" có thể đổi khi bỏ mốc xuất kho: tính lại số bán được
  const productRows = await tx.select({ productId: orderItems.productId }).from(orderItems).where(eq(orderItems.orderId, orderId));
  for (const pid of [...new Set(productRows.map((r) => r.productId))].sort()) await syncSellableStock(tx, pid);
  return { reversed: issued.length };
}

export async function receiveOrderReturn(
  tx: Tx,
  input: {
    orderId: string;
    source: { type: "order" | "return_request" | "recall"; id: string; code: string };
    lines: { orderItemId: string; qty: number; disposition: "restock" | "quarantine" }[];
  },
  actorId: string,
): Promise<{ receiptId: string; code: string }> {
  const order = await tx.query.orders.findFirst({ where: eq(orders.id, input.orderId) });
  if (!order) throw new UserError("Không tìm thấy đơn");
  const today = vnToday();
  const rej = await warehouseOfKind(tx, "rejected");
  const rejLoc = await defaultLocationId(tx, rej.id);

  type Planned = { orderItemId: string; itemId: string; stockLotId: string; locationId: string; warehouseId: string; qty: number; lineCost: number; note: string | null };
  const planned: Planned[] = [];
  for (const l of input.lines) {
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0) throw new UserError("Số lượng trả phải lớn hơn 0");
    const [oi] = await tx
      .select({ id: orderItems.id, orderId: orderItems.orderId, productName: orderItems.productName, track: products.trackInventory })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.id, l.orderItemId));
    if (!oi || oi.orderId !== input.orderId) throw new UserError("Dòng không thuộc đơn này");
    if (!oi.track) continue; // sản phẩm chưa bật quản lý kho: người gọi xử lý kiểu cũ
    const moves = await tx
      .select({ type: stockMovements.type, qty: stockMovements.qty, stockLotId: stockMovements.stockLotId, warehouseId: stockMovements.warehouseId, itemId: stockMovements.itemId, id: stockMovements.id })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.orderItemId, l.orderItemId),
          inArray(stockMovements.type, ["sale_issue", "return_receipt"]),
          sql`not exists (select 1 from stock_movements r where r.reversal_of = ${stockMovements.id})`,
        ),
      )
      .orderBy(asc(stockMovements.occurredAt));
    const issued = moves.filter((m) => m.type === "sale_issue");
    const issuedQty = -issued.reduce((s, m) => s + m.qty, 0);
    const returnedQty = moves.filter((m) => m.type === "return_receipt").reduce((s, m) => s + m.qty, 0) + planned.filter((p) => p.orderItemId === l.orderItemId).reduce((s, p) => s + p.qty, 0);
    if (issued.length === 0) throw new UserError(`Dòng ${oi.productName} chưa xuất kho`);
    if (l.qty > issuedQty - returnedQty) throw new UserError(`Số trả vượt số đã xuất cho ${oi.productName}: đã xuất ${issuedQty}, đã nhập trả ${returnedQty}`);
    const src = issued[0]!;
    const lot = (await loadLots(tx, [src.stockLotId])).get(src.stockLotId)!;
    let locationId = rejLoc;
    let warehouseId = rej.id;
    let note: string | null = null;
    if (l.disposition === "restock") {
      if (isLotUsable(lot, today)) {
        warehouseId = src.warehouseId;
        locationId = await defaultLocationId(tx, src.warehouseId);
      } else {
        note = "Lô đang bị giữ/hết hạn, đưa vào kho cách ly";
      }
    }
    planned.push({ orderItemId: l.orderItemId, itemId: src.itemId, stockLotId: src.stockLotId, locationId, warehouseId, qty: l.qty, lineCost: costOfQty(l.qty, lot.receivedQty, lot.receivedCost), note });
  }
  if (planned.length === 0) throw new UserError("Không có dòng nào thuộc sản phẩm quản lý tồn theo kho");

  const draft = await createReceiptDraft(
    tx,
    {
      kind: "customer_return",
      warehouseId: planned[0]!.warehouseId,
      receivedOn: today,
      source: { type: input.source.type, id: input.source.id },
      paymentMode: "none",
      note: `Hàng trả ${input.source.code}`,
      lines: planned.map((p) => ({ itemId: p.itemId, qty: p.qty, lineCost: p.lineCost, locationId: p.locationId, stockLotId: p.stockLotId, qcRequired: false, note: p.note })),
    },
    actorId,
  );
  const lineRows = await tx.select({ id: stockReceiptLines.id, sort: stockReceiptLines.sort }).from(stockReceiptLines).where(eq(stockReceiptLines.receiptId, draft.receiptId));
  const orderItemByLine = new Map(lineRows.map((r) => [r.id, planned[r.sort]!.orderItemId]));
  await postReceiptDraft(tx, draft.receiptId, actorId, { orderItemByLine, allowAnyWarehouse: true });
  return { receiptId: draft.receiptId, code: draft.code };
}

// ---------------------------------------------------------------------------------------------
// Bật/tắt quản lý kho cho sản phẩm (R-KHO-25)

export async function enableInventoryTracking(productId: string, on: boolean, actorId: string): Promise<{ before: number; after: number }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(products).where(eq(products.id, productId)).for("update");
    if (!p) throw new UserError("Không tìm thấy sản phẩm");
    if (p.trackInventory === on) return { before: p.stock, after: p.stock };
    if (on) await ensureFinishedItem(tx, { id: p.id, code: p.code, name: p.name });
    await tx.update(products).set({ trackInventory: on, updatedAt: new Date() }).where(eq(products.id, productId));
    const after = on ? (await syncSellableStock(tx, productId)).stock : p.stock;
    await writeAudit(tx, {
      actorId,
      action: "product.inventory_tracking",
      entity: "products",
      entityId: productId,
      before: { trackInventory: p.trackInventory, stock: p.stock },
      after: { trackInventory: on, stock: after },
    });
    return { before: p.stock, after };
  });
}

// Hàng thành phẩm của sản phẩm (R-KHO-3): mã = mã sản phẩm, pcs/chai, không IQC, kho mặc định FG. Có rồi thì trả id.
export async function ensureFinishedItem(tx: Tx, product: { id: string; code: string; name: string }): Promise<string> {
  const existing = await finishedItemOf(tx, product.id);
  if (existing) return existing;
  const fg = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.code, "FG")).limit(1);
  const [row] = await tx
    .insert(inventoryItems)
    .values({
      code: product.code,
      name: product.name,
      kind: "finished",
      baseUom: "pcs",
      displayUom: "chai",
      purchaseUom: "chai",
      requiresIqc: false,
      productId: product.id,
      defaultWarehouseId: fg[0]?.id ?? null,
    })
    .returning({ id: inventoryItems.id });
  return row!.id;
}

// Đổi tên sản phẩm thì đổi tên hàng thành phẩm theo (R-KHO-3)
export async function renameFinishedItem(tx: Tx, productId: string, name: string): Promise<void> {
  await tx.update(inventoryItems).set({ name, updatedAt: new Date() }).where(eq(inventoryItems.productId, productId));
}

export type { StockMoveType };
