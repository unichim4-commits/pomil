// Kho: hàm cho màn hình quản trị (T-14c). Đọc danh sách, CRUD hàng hóa/NCC/kho/vị trí, sửa giá nhập (R-KHO-37),
// báo cáo (R-KHO-21, R-KHO-22, R-KHO-28), mẫu lưu khi xuất qc_sample. Hàm ghi nhận tx của người gọi; quyền kiểm ở action.
// Không đổi chữ ký hàm dùng chung ở ledger.ts (00 mục 8.2).
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import {
  extractionRuns,
  inventoryItems,
  lots,
  productionOrders,
  qcInspections,
  retainedSamples,
  staffUsers,
  stockBalances,
  stockCountLines,
  stockCounts,
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
import { adjustDebtAmount, findDebtBySource, openPayable } from "@/modules/finance/ledger";
import { nextDocCode } from "@/modules/numbering/service";
import { vnToday } from "@/modules/numbering/rules";
import { recalcProductionCost } from "@/modules/production/costing";
import { ERP_SETTINGS_KEY, parseErpSettings } from "@/modules/settings/erp-schema";
import { settings } from "@/db/schema";
import { getItemStock, STALE_MESSAGE } from "./ledger";
import {
  addDays,
  checkItemWarehouse,
  checkUom,
  classifyBalance,
  costOfQty,
  expiryFlag,
  fefoWarning,
  isLotUsable,
  lotCostAfterLineEdit,
  moveKinds,
  moveNeedsUsableLot,
  ISSUE_MOVE,
  normalizeItemCode,
  normalizeLocationCode,
  normalizeWarehouseCode,
  planFefo,
  slowMovingDays,
  type BaseUom,
  type FefoCandidate,
  type IssueInput,
  type ItemKind,
  type ItemStock,
  type ProductLotStatus,
  type StockBucket,
  type StockLotQcStatus,
  type WarehouseKind,
} from "./rules";

type Reader = Db | Tx;

// ---------------------------------------------------------------------------------------------
// Kho và vị trí (R-KHO-4)

export async function listWarehouses(db: Reader) {
  const whs = await db.select().from(warehouses).orderBy(asc(warehouses.createdAt), asc(warehouses.code));
  const locs = await db.select().from(warehouseLocations).orderBy(desc(warehouseLocations.isDefault), asc(warehouseLocations.code));
  const qty = await db
    .select({ warehouseId: stockBalances.warehouseId, locationId: stockBalances.locationId, qty: sql<string>`sum(${stockBalances.qty})::text` })
    .from(stockBalances)
    .groupBy(stockBalances.warehouseId, stockBalances.locationId);
  const byLoc = new Map(qty.map((q) => [q.locationId, Number(q.qty)]));
  return whs.map((w) => {
    const ls = locs.filter((l) => l.warehouseId === w.id).map((l) => ({ ...l, hasStock: (byLoc.get(l.id) ?? 0) > 0 }));
    return { ...w, locations: ls, hasStock: ls.some((l) => l.hasStock) };
  });
}

export async function createWarehouse(tx: Tx, input: { code: string; name: string; kind: WarehouseKind; address?: string | null; note?: string | null }, actorId: string): Promise<{ id: string }> {
  const code = normalizeWarehouseCode(input.code);
  if (!code.ok) throw new UserError(code.message);
  const name = input.name.trim();
  if (!name) throw new UserError("Nhập tên kho");
  const [dup] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.code, code.code));
  if (dup) throw new UserError(`Mã kho ${code.code} đã có`);
  const [row] = await tx
    .insert(warehouses)
    .values({ code: code.code, name, kind: input.kind, address: input.address ?? null, note: input.note ?? null })
    .returning({ id: warehouses.id });
  // Mỗi kho đúng một vị trí mặc định CHUNG, tạo cùng kho
  await tx.insert(warehouseLocations).values({ warehouseId: row!.id, code: "CHUNG", name: "Chung", isDefault: true });
  await writeAudit(tx, { actorId, action: "warehouse.created", entity: "warehouses", entityId: row!.id, after: { code: code.code, name, kind: input.kind } });
  return { id: row!.id };
}

async function warehouseQty(db: Reader, warehouseId: string): Promise<number> {
  const [r] = await db.select({ q: sql<string>`coalesce(sum(${stockBalances.qty}), 0)::text` }).from(stockBalances).where(eq(stockBalances.warehouseId, warehouseId));
  return Number(r?.q ?? 0);
}

// Ngừng dùng chỉ khi tổng số dư = 0 (R-KHO-4)
export async function setWarehouseActive(tx: Tx, warehouseId: string, active: boolean, actorId: string): Promise<void> {
  const [w] = await tx.select().from(warehouses).where(eq(warehouses.id, warehouseId)).for("update");
  if (!w) throw new UserError("Không tìm thấy kho");
  if (w.isActive === active) return;
  if (!active && (await warehouseQty(tx, warehouseId)) > 0) throw new UserError("Kho còn hàng, chuyển hết trước khi ngừng dùng");
  await tx.update(warehouses).set({ isActive: active }).where(eq(warehouses.id, warehouseId));
  await writeAudit(tx, { actorId, action: "warehouse.active", entity: "warehouses", entityId: warehouseId, before: { isActive: w.isActive }, after: { isActive: active } });
}

export async function createLocation(tx: Tx, input: { warehouseId: string; code: string; name?: string }, actorId: string): Promise<{ id: string }> {
  const code = normalizeLocationCode(input.code);
  if (!code.ok) throw new UserError(code.message);
  const [w] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, input.warehouseId));
  if (!w) throw new UserError("Không tìm thấy kho");
  const [dup] = await tx
    .select({ id: warehouseLocations.id })
    .from(warehouseLocations)
    .where(and(eq(warehouseLocations.warehouseId, input.warehouseId), eq(warehouseLocations.code, code.code)));
  if (dup) throw new UserError(`Kho đã có vị trí ${code.code}`);
  const [row] = await tx
    .insert(warehouseLocations)
    .values({ warehouseId: input.warehouseId, code: code.code, name: input.name?.trim() ?? "" })
    .returning({ id: warehouseLocations.id });
  await writeAudit(tx, { actorId, action: "warehouse_location.created", entity: "warehouse_locations", entityId: row!.id, after: { warehouseId: input.warehouseId, code: code.code } });
  return { id: row!.id };
}

export async function setLocationActive(tx: Tx, locationId: string, active: boolean, actorId: string): Promise<void> {
  const [l] = await tx.select().from(warehouseLocations).where(eq(warehouseLocations.id, locationId)).for("update");
  if (!l) throw new UserError("Không tìm thấy vị trí");
  if (l.isActive === active) return;
  if (!active && l.isDefault) throw new UserError("Không ngừng dùng vị trí mặc định của kho");
  if (!active) {
    const [r] = await tx.select({ q: sql<string>`coalesce(sum(${stockBalances.qty}), 0)::text` }).from(stockBalances).where(eq(stockBalances.locationId, locationId));
    if (Number(r?.q ?? 0) > 0) throw new UserError("Vị trí còn hàng, chuyển hết trước khi ngừng dùng");
  }
  await tx.update(warehouseLocations).set({ isActive: active }).where(eq(warehouseLocations.id, locationId));
  await writeAudit(tx, { actorId, action: "warehouse_location.active", entity: "warehouse_locations", entityId: locationId, before: { isActive: l.isActive }, after: { isActive: active } });
}

// ---------------------------------------------------------------------------------------------
// Nhà cung cấp

export type SupplierInput = {
  code?: string | null;
  name: string;
  kind: "material" | "packaging" | "factory" | "farm" | "service" | "other";
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxCode?: string | null;
  paymentTermsDays: number;
  qualified: boolean;
  note?: string | null;
  isActive?: boolean;
};

// Mã NCC-NNN tự sinh (bộ đếm NCC); bỏ qua số đã bị dùng (ví dụ nhập tay trước đó)
async function nextSupplierCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const code = await nextDocCode(tx, "NCC");
    const [dup] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.code, code));
    if (!dup) return code;
  }
  throw new UserError("Không sinh được mã nhà cung cấp, nhập mã tay");
}

export async function saveSupplier(tx: Tx, id: string | null, input: SupplierInput, actorId: string): Promise<{ id: string; code: string }> {
  const name = input.name.trim();
  if (!name) throw new UserError("Nhập tên nhà cung cấp");
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 365) throw new UserError("Hạn trả từ 0 đến 365 ngày");
  const values = {
    name,
    kind: input.kind,
    contactName: input.contactName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    taxCode: input.taxCode ?? null,
    paymentTermsDays: input.paymentTermsDays,
    qualified: input.qualified,
    note: input.note ?? null,
    isActive: input.isActive ?? true,
    updatedAt: new Date(),
  };
  if (!id) {
    let code = input.code?.trim().toUpperCase() || "";
    if (code) {
      if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw new UserError("Mã chỉ gồm chữ, số và gạch ngang");
      const [dup] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.code, code));
      if (dup) throw new UserError(`Mã ${code} đã có`);
    } else code = await nextSupplierCode(tx);
    const [row] = await tx.insert(suppliers).values({ code, ...values }).returning({ id: suppliers.id });
    await writeAudit(tx, { actorId, action: "supplier.created", entity: "suppliers", entityId: row!.id, after: { code, name } });
    return { id: row!.id, code };
  }
  const [before] = await tx.select().from(suppliers).where(eq(suppliers.id, id));
  if (!before) throw new UserError("Không tìm thấy nhà cung cấp");
  await tx.update(suppliers).set(values).where(eq(suppliers.id, id));
  await writeAudit(tx, {
    actorId,
    action: "supplier.updated",
    entity: "suppliers",
    entityId: id,
    before: { name: before.name, paymentTermsDays: before.paymentTermsDays, qualified: before.qualified, isActive: before.isActive },
    after: { name, paymentTermsDays: input.paymentTermsDays, qualified: input.qualified, isActive: values.isActive },
  });
  return { id, code: before.code };
}

export async function listSuppliers(db: Reader, opts: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(suppliers)
    .where(opts.activeOnly ? eq(suppliers.isActive, true) : undefined)
    .orderBy(asc(suppliers.code));
}

export async function getSupplierDetail(db: Reader, id: string) {
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!s) return null;
  const receipts = await db
    .select({ id: stockReceipts.id, code: stockReceipts.code, kind: stockReceipts.kind, status: stockReceipts.status, receivedOn: stockReceipts.receivedOn, totalCost: stockReceipts.totalCost })
    .from(stockReceipts)
    .where(eq(stockReceipts.supplierId, id))
    .orderBy(desc(stockReceipts.receivedOn), desc(stockReceipts.createdAt))
    .limit(50);
  const failedIqc = await db
    .select({ id: qcInspections.id, code: qcInspections.code, decidedAt: qcInspections.decidedAt, lotCode: stockLots.code })
    .from(qcInspections)
    .leftJoin(stockLots, eq(stockLots.id, qcInspections.stockLotId))
    .where(and(eq(qcInspections.supplierId, id), eq(qcInspections.status, "failed")))
    .orderBy(desc(qcInspections.createdAt))
    .limit(50);
  return { supplier: s, receipts, failedIqc };
}

// ---------------------------------------------------------------------------------------------
// Hàng hóa (R-KHO-1, R-KHO-2, R-KHO-3, R-KHO-31, AC-KHO-2, AC-KHO-3)

export type ItemInput = {
  code: string;
  name: string;
  kind: Exclude<ItemKind, "finished">;
  groupName?: string;
  baseUom: BaseUom;
  displayUom: string;
  purchaseUom: string;
  spec?: string;
  refUnitPrice?: number | null;
  defaultSupplierId?: string | null;
  defaultWarehouseId?: string | null;
  shelfLifeDays?: number | null;
  storageCondition?: string;
  minStock?: number | null;
  requiresIqc: boolean;
  densityMgPerMl?: number | null;
  isActive?: boolean;
  note?: string | null;
};

// Sửa hàng thành phẩm: chỉ các trường không phải định danh (mã, tên, đơn vị theo sản phẩm)
export type FinishedItemInput = Pick<ItemInput, "groupName" | "spec" | "storageCondition" | "minStock" | "note" | "defaultWarehouseId">;

async function itemHasMovements(db: Reader, itemId: string): Promise<boolean> {
  const [m] = await db.select({ id: stockMovements.id }).from(stockMovements).where(eq(stockMovements.itemId, itemId)).limit(1);
  return !!m;
}

async function itemOnHand(db: Reader, itemId: string): Promise<number> {
  const [r] = await db.select({ q: sql<string>`coalesce(sum(${stockBalances.qty}), 0)::text` }).from(stockBalances).where(eq(stockBalances.itemId, itemId));
  return Number(r?.q ?? 0);
}

function checkIntOpt(v: number | null | undefined, label: string, min: number): void {
  if (v === null || v === undefined) return;
  if (!Number.isSafeInteger(v) || v < min) throw new UserError(`${label} không hợp lệ`);
}

export async function saveItem(tx: Tx, id: string | null, input: ItemInput, actorId: string): Promise<{ id: string; code: string }> {
  const code = normalizeItemCode(input.code);
  if (!code.ok) throw new UserError(code.message);
  const name = input.name.trim();
  if (!name) throw new UserError("Nhập tên hàng");
  if ((input.kind as string) === "finished") throw new UserError("Hàng thành phẩm tự tạo theo sản phẩm, không tạo tay");
  for (const u of [input.displayUom, input.purchaseUom]) {
    const err = checkUom(input.baseUom, u);
    if (err) throw new UserError(err);
  }
  checkIntOpt(input.refUnitPrice, "Giá tham chiếu", 0);
  checkIntOpt(input.shelfLifeDays, "Hạn dùng mặc định", 1);
  checkIntOpt(input.minStock, "Tồn tối thiểu", 0);
  checkIntOpt(input.densityMgPerMl, "Khối lượng riêng", 1);
  if (input.defaultWarehouseId) {
    const [w] = await tx.select({ kind: warehouses.kind }).from(warehouses).where(eq(warehouses.id, input.defaultWarehouseId));
    if (!w) throw new UserError("Không tìm thấy kho");
    const err = checkItemWarehouse(false, w.kind);
    if (err) throw new UserError(err);
  }
  const [dup] = await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.code, code.code));
  if (dup && dup.id !== id) throw new UserError(`Mã ${code.code} đã có`);

  const values = {
    code: code.code,
    name,
    kind: input.kind,
    groupName: input.groupName?.trim() ?? "",
    baseUom: input.baseUom,
    displayUom: input.displayUom,
    purchaseUom: input.purchaseUom,
    spec: input.spec?.trim() ?? "",
    refUnitPrice: input.refUnitPrice ?? null,
    defaultSupplierId: input.defaultSupplierId ?? null,
    defaultWarehouseId: input.defaultWarehouseId ?? null,
    shelfLifeDays: input.shelfLifeDays ?? null,
    storageCondition: input.storageCondition?.trim() ?? "",
    minStock: input.minStock ?? null,
    requiresIqc: input.requiresIqc,
    densityMgPerMl: input.densityMgPerMl ?? null,
    isActive: input.isActive ?? true,
    note: input.note ?? null,
    updatedAt: new Date(),
  };

  if (!id) {
    const [row] = await tx.insert(inventoryItems).values(values).returning({ id: inventoryItems.id });
    await writeAudit(tx, { actorId, action: "inventory_item.created", entity: "inventory_items", entityId: row!.id, after: { code: code.code, name, kind: input.kind, baseUom: input.baseUom } });
    return { id: row!.id, code: code.code };
  }

  const [before] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id)).for("update");
  if (!before) throw new UserError("Không tìm thấy hàng hóa");
  if (before.kind === "finished") throw new UserError("Hàng thành phẩm sửa ở trang sản phẩm");
  if (before.baseUom !== input.baseUom && (await itemHasMovements(tx, id))) throw new UserError("Hàng đã có lịch sử kho, không đổi được đơn vị cơ sở");
  if (before.code !== code.code && (await itemHasMovements(tx, id))) throw new UserError("Hàng đã có lịch sử kho, không đổi được mã");
  if (before.isActive && values.isActive === false && (await itemOnHand(tx, id)) > 0) throw new UserError("Hàng còn tồn, xuất hoặc kiểm kê về 0 trước khi ngừng dùng");
  await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, id));
  await writeAudit(tx, {
    actorId,
    action: "inventory_item.updated",
    entity: "inventory_items",
    entityId: id,
    before: { code: before.code, name: before.name, baseUom: before.baseUom, minStock: before.minStock, isActive: before.isActive, requiresIqc: before.requiresIqc },
    after: { code: code.code, name, baseUom: input.baseUom, minStock: values.minStock, isActive: values.isActive, requiresIqc: values.requiresIqc },
  });
  return { id, code: code.code };
}

export async function saveFinishedItem(tx: Tx, id: string, input: FinishedItemInput, actorId: string): Promise<void> {
  const [before] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
  if (!before) throw new UserError("Không tìm thấy hàng hóa");
  if (before.kind !== "finished") throw new UserError("Không phải hàng thành phẩm");
  checkIntOpt(input.minStock, "Tồn tối thiểu", 0);
  if (input.defaultWarehouseId) {
    const [w] = await tx.select({ kind: warehouses.kind }).from(warehouses).where(eq(warehouses.id, input.defaultWarehouseId));
    if (!w) throw new UserError("Không tìm thấy kho");
    const err = checkItemWarehouse(true, w.kind);
    if (err) throw new UserError(err);
  }
  const after = {
    groupName: input.groupName?.trim() ?? "",
    spec: input.spec?.trim() ?? "",
    storageCondition: input.storageCondition?.trim() ?? "",
    minStock: input.minStock ?? null,
    note: input.note ?? null,
    defaultWarehouseId: input.defaultWarehouseId ?? before.defaultWarehouseId,
  };
  await tx.update(inventoryItems).set({ ...after, updatedAt: new Date() }).where(eq(inventoryItems.id, id));
  await writeAudit(tx, { actorId, action: "inventory_item.updated", entity: "inventory_items", entityId: id, before: { minStock: before.minStock, groupName: before.groupName }, after });
}

export async function listItems(db: Reader, opts: { kind?: string | null; q?: string | null; activeOnly?: boolean } = {}) {
  const where: SQL[] = [];
  if (opts.kind) where.push(eq(inventoryItems.kind, opts.kind as ItemKind));
  if (opts.activeOnly) where.push(eq(inventoryItems.isActive, true));
  if (opts.q) where.push(or(ilike(inventoryItems.code, `%${opts.q}%`), ilike(inventoryItems.name, `%${opts.q}%`))!);
  return db
    .select()
    .from(inventoryItems)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(inventoryItems.kind), asc(inventoryItems.code));
}

// ---------------------------------------------------------------------------------------------
// Tồn kho (R-KHO-9, R-KHO-20, R-KHO-21, R-KHO-28)

export type BalanceRow = {
  locationId: string;
  locationCode: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseKind: WarehouseKind;
  stockLotId: string;
  lotCode: string;
  itemId: string;
  qty: number;
  qcStatus: StockLotQcStatus | null;
  productLotId: string | null;
  productLotStatus: ProductLotStatus | null;
  expiresOn: string | null;
  manufacturedOn: string | null;
  receivedQty: number;
  receivedCost: number;
  createdAt: Date;
};

export async function loadBalances(db: Reader, filter: { itemIds?: string[]; warehouseId?: string | null; stockLotId?: string | null } = {}): Promise<BalanceRow[]> {
  const where: SQL[] = [gt(stockBalances.qty, 0)];
  if (filter.itemIds) {
    if (filter.itemIds.length === 0) return [];
    where.push(inArray(stockBalances.itemId, filter.itemIds));
  }
  if (filter.warehouseId) where.push(eq(stockBalances.warehouseId, filter.warehouseId));
  if (filter.stockLotId) where.push(eq(stockBalances.stockLotId, filter.stockLotId));
  const rows = await db
    .select({
      locationId: stockBalances.locationId,
      locationCode: warehouseLocations.code,
      warehouseId: stockBalances.warehouseId,
      warehouseCode: warehouses.code,
      warehouseKind: warehouses.kind,
      stockLotId: stockBalances.stockLotId,
      lotCode: stockLots.code,
      itemId: stockBalances.itemId,
      qty: stockBalances.qty,
      qcStatus: stockLots.qcStatus,
      productLotId: stockLots.productLotId,
      productLotStatus: lots.releaseStatus,
      expiresOn: stockLots.expiresOn,
      productLotExpiresOn: lots.expiresOn,
      manufacturedOn: stockLots.manufacturedOn,
      receivedQty: stockLots.receivedQty,
      receivedCost: stockLots.receivedCost,
      createdAt: stockLots.createdAt,
    })
    .from(stockBalances)
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .innerJoin(warehouseLocations, eq(warehouseLocations.id, stockBalances.locationId))
    .innerJoin(stockLots, eq(stockLots.id, stockBalances.stockLotId))
    .leftJoin(lots, eq(lots.id, stockLots.productLotId))
    .where(and(...where))
    .orderBy(asc(stockLots.code), asc(warehouses.code), asc(warehouseLocations.code));
  return rows.map(({ productLotExpiresOn, ...r }) => ({ ...r, expiresOn: r.expiresOn ?? productLotExpiresOn ?? null }));
}

export function balanceBucket(b: BalanceRow, today: string): StockBucket {
  return classifyBalance(b, today);
}

// Giá trị một số dư (R-KHO-28)
export function balanceValue(b: Pick<BalanceRow, "qty" | "receivedQty" | "receivedCost">): number {
  return costOfQty(b.qty, b.receivedQty, b.receivedCost);
}

export type StockOverviewRow = {
  item: typeof inventoryItems.$inferSelect;
  stock: ItemStock;
  value: number;
  pendingQc: boolean;
  belowMin: boolean;
  expiring: number;
  expired: number;
};

// Bảng /admin/kho: theo hàng; lọc kho thì số theo kho đó, "đã giữ/đã cam kết" luôn toàn công ty
export async function stockOverview(db: Reader, opts: { warehouseId?: string | null; kind?: string | null; group?: string | null; today?: string } = {}): Promise<StockOverviewRow[]> {
  const today = opts.today ?? vnToday();
  const [cfgRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, ERP_SETTINGS_KEY));
  const cfg = parseErpSettings(cfgRow?.value);
  const where: SQL[] = [];
  if (opts.kind) where.push(eq(inventoryItems.kind, opts.kind as ItemKind));
  if (opts.group) where.push(eq(inventoryItems.groupName, opts.group));
  const items = await db.select().from(inventoryItems).where(where.length ? and(...where) : undefined).orderBy(asc(inventoryItems.kind), asc(inventoryItems.code));
  const ids = items.map((i) => i.id);
  const total = await getItemStock(db, ids, today);
  const balances = await loadBalances(db, { itemIds: ids, warehouseId: opts.warehouseId });
  const rows: StockOverviewRow[] = items.map((item) => ({
    item,
    stock: opts.warehouseId
      ? { onHand: 0, available: 0, quarantine: 0, rejected: 0, expired: 0, reserved: total.get(item.id)!.reserved, committed: total.get(item.id)!.committed }
      : total.get(item.id)!,
    value: 0,
    pendingQc: false,
    belowMin: false,
    expiring: 0,
    expired: 0,
  }));
  const byId = new Map(rows.map((r) => [r.item.id, r]));
  for (const b of balances) {
    const r = byId.get(b.itemId)!;
    if (opts.warehouseId) {
      r.stock[balanceBucket(b, today)] += b.qty;
      r.stock.onHand += b.qty;
    }
    r.value += balanceValue(b);
    if (b.qcStatus === "pending") r.pendingQc = true;
    if (b.warehouseKind !== "rejected") {
      const f = expiryFlag(b.expiresOn, today, cfg.expiryWarnDays);
      if (f?.kind === "expiring") r.expiring++;
      if (f?.kind === "expired") r.expired++;
    }
  }
  for (const r of rows) {
    // Dưới tối thiểu xét tồn khả dụng toàn công ty (R-KHO-20)
    r.belowMin = r.item.minStock !== null && r.item.isActive && (total.get(r.item.id)?.available ?? 0) < r.item.minStock;
  }
  return rows;
}

export async function getItemDetail(db: Reader, id: string, today = vnToday()) {
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
  if (!item) return null;
  const stock = (await getItemStock(db, [id], today)).get(id)!;
  const balances = await loadBalances(db, { itemIds: [id] });
  const movements = await listMovements(db, { itemId: id }, 30);
  return { item, stock, balances, movements };
}

// ---------------------------------------------------------------------------------------------
// Lô (/admin/kho/lo)

export async function listStockLots(db: Reader, opts: { itemId?: string | null; status?: string | null; q?: string | null; withStockOnly?: boolean; today?: string } = {}) {
  const today = opts.today ?? vnToday();
  const where: SQL[] = [];
  if (opts.itemId) where.push(eq(stockLots.itemId, opts.itemId));
  if (opts.q) where.push(ilike(stockLots.code, `%${opts.q}%`));
  const rows = await db
    .select({
      id: stockLots.id,
      code: stockLots.code,
      itemId: stockLots.itemId,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
      qcStatus: stockLots.qcStatus,
      productLotId: stockLots.productLotId,
      productLotStatus: lots.releaseStatus,
      expiresOn: stockLots.expiresOn,
      productLotExpiresOn: lots.expiresOn,
      createdAt: stockLots.createdAt,
      qty: sql<string>`coalesce((select sum(qty) from stock_balances b where b.stock_lot_id = ${stockLots.id}), 0)::text`,
    })
    .from(stockLots)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
    .leftJoin(lots, eq(lots.id, stockLots.productLotId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(stockLots.createdAt))
    .limit(300);
  return rows
    .map(({ productLotExpiresOn, qty, ...r }) => {
      const expiresOn = r.expiresOn ?? productLotExpiresOn ?? null;
      const status = (r.qcStatus ?? r.productLotStatus ?? "pending") as string;
      return { ...r, expiresOn, qty: Number(qty), status, usable: isLotUsable({ qcStatus: r.qcStatus, productLotStatus: r.productLotStatus, expiresOn }, today) };
    })
    .filter((r) => (!opts.withStockOnly || r.qty > 0) && (!opts.status || r.status === opts.status));
}

export async function getStockLotDetail(db: Reader, id: string) {
  const [lot] = await db
    .select({
      lot: stockLots,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      itemKind: inventoryItems.kind,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
      productLotNo: lots.lotNo,
      productLotStatus: lots.releaseStatus,
      productLotExpiresOn: lots.expiresOn,
      supplierCode: suppliers.code,
      supplierName: suppliers.name,
    })
    .from(stockLots)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
    .leftJoin(lots, eq(lots.id, stockLots.productLotId))
    .leftJoin(suppliers, eq(suppliers.id, stockLots.supplierId))
    .where(eq(stockLots.id, id));
  if (!lot) return null;
  const balances = await loadBalances(db, { stockLotId: id });
  const movements = await listMovements(db, { stockLotId: id }, 100);
  const inspections = await db
    .select({ id: qcInspections.id, code: qcInspections.code, stage: qcInspections.stage, status: qcInspections.status, createdAt: qcInspections.createdAt })
    .from(qcInspections)
    .where(eq(qcInspections.stockLotId, id))
    .orderBy(desc(qcInspections.createdAt));
  let source: { label: string; href: string | null } | null = null;
  if (lot.lot.sourceDocType === "receipt") {
    const [r] = await db.select({ code: stockReceipts.code }).from(stockReceipts).where(eq(stockReceipts.id, lot.lot.sourceDocId));
    if (r) source = { label: r.code, href: `/admin/kho/nhap/${lot.lot.sourceDocId}` };
  }
  return { ...lot, balances, movements, inspections, source };
}

// ---------------------------------------------------------------------------------------------
// Sổ biến động (/admin/kho/so-kho)

export type MovementFilter = {
  itemId?: string | null;
  stockLotId?: string | null;
  lotCode?: string | null;
  warehouseId?: string | null;
  type?: string | null;
  from?: string | null; // YYYY-MM-DD giờ VN
  to?: string | null;
};

const VN_DAY_START = (d: string) => new Date(`${d}T00:00:00+07:00`);

export async function listMovements(db: Reader, f: MovementFilter, limit = 200) {
  const where: SQL[] = [];
  if (f.itemId) where.push(eq(stockMovements.itemId, f.itemId));
  if (f.stockLotId) where.push(eq(stockMovements.stockLotId, f.stockLotId));
  if (f.lotCode) where.push(ilike(stockLots.code, `%${f.lotCode}%`));
  if (f.warehouseId) where.push(eq(stockMovements.warehouseId, f.warehouseId));
  if (f.type) where.push(sql`${stockMovements.type} = ${f.type}`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) where.push(gte(stockMovements.occurredAt, VN_DAY_START(f.from)));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) where.push(lt(stockMovements.occurredAt, VN_DAY_START(addDays(f.to, 1))));
  return db
    .select({
      id: stockMovements.id,
      occurredAt: stockMovements.occurredAt,
      type: stockMovements.type,
      docType: stockMovements.docType,
      docId: stockMovements.docId,
      docCode: stockMovements.docCode,
      itemId: stockMovements.itemId,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
      stockLotId: stockMovements.stockLotId,
      lotCode: stockLots.code,
      warehouseCode: warehouses.code,
      locationCode: warehouseLocations.code,
      qty: stockMovements.qty,
      balanceAfter: stockMovements.balanceAfter,
      note: stockMovements.note,
      actorName: staffUsers.name,
    })
    .from(stockMovements)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockMovements.itemId))
    .innerJoin(stockLots, eq(stockLots.id, stockMovements.stockLotId))
    .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .innerJoin(warehouseLocations, eq(warehouseLocations.id, stockMovements.locationId))
    .leftJoin(staffUsers, eq(staffUsers.id, stockMovements.actorId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(stockMovements.occurredAt), desc(stockMovements.createdAt))
    .limit(limit);
}

// Liên kết tới chứng từ của một dòng biến động
export function docHref(docType: string, docId: string): string | null {
  switch (docType) {
    case "receipt":
      return `/admin/kho/nhap/${docId}`;
    case "issue":
      return `/admin/kho/xuat/${docId}`;
    case "transfer":
      return `/admin/kho/dieu-chuyen/${docId}`;
    case "count":
      return `/admin/kho/kiem-ke/${docId}`;
    case "order":
      return `/admin/don-hang/${docId}`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Phiếu: danh sách và chi tiết

export async function listReceipts(db: Reader, f: { kind?: string | null; status?: string | null; supplierId?: string | null; month?: string | null } = {}) {
  const where: SQL[] = [];
  if (f.kind) where.push(sql`${stockReceipts.kind} = ${f.kind}`);
  if (f.status) where.push(sql`${stockReceipts.status} = ${f.status}`);
  if (f.supplierId) where.push(eq(stockReceipts.supplierId, f.supplierId));
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
    where.push(gte(stockReceipts.receivedOn, `${f.month}-01`));
    where.push(lte(stockReceipts.receivedOn, `${f.month}-31`));
  }
  return db
    .select({
      id: stockReceipts.id,
      code: stockReceipts.code,
      kind: stockReceipts.kind,
      status: stockReceipts.status,
      receivedOn: stockReceipts.receivedOn,
      totalCost: stockReceipts.totalCost,
      supplierName: suppliers.name,
      warehouseCode: warehouses.code,
      lines: sql<number>`(select count(*)::int from stock_receipt_lines l where l.receipt_id = ${stockReceipts.id})`,
      lineCostSum: sql<number>`(select coalesce(sum(line_cost), 0)::int from stock_receipt_lines l where l.receipt_id = ${stockReceipts.id})`,
    })
    .from(stockReceipts)
    .innerJoin(warehouses, eq(warehouses.id, stockReceipts.warehouseId))
    .leftJoin(suppliers, eq(suppliers.id, stockReceipts.supplierId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(stockReceipts.createdAt))
    .limit(200);
}

export async function getReceiptDetail(db: Reader, id: string) {
  const [r] = await db
    .select({ receipt: stockReceipts, supplierName: suppliers.name, supplierCode: suppliers.code, warehouseCode: warehouses.code, warehouseName: warehouses.name })
    .from(stockReceipts)
    .innerJoin(warehouses, eq(warehouses.id, stockReceipts.warehouseId))
    .leftJoin(suppliers, eq(suppliers.id, stockReceipts.supplierId))
    .where(eq(stockReceipts.id, id));
  if (!r) return null;
  const lines = await db
    .select({
      line: stockReceiptLines,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
      purchaseUom: inventoryItems.purchaseUom,
      refUnitPrice: inventoryItems.refUnitPrice,
      lotCode: stockLots.code,
      locationCode: warehouseLocations.code,
      productLotNo: lots.lotNo,
    })
    .from(stockReceiptLines)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockReceiptLines.itemId))
    .leftJoin(stockLots, eq(stockLots.id, stockReceiptLines.stockLotId))
    .leftJoin(warehouseLocations, eq(warehouseLocations.id, stockReceiptLines.locationId))
    .leftJoin(lots, eq(lots.id, stockReceiptLines.productLotId))
    .where(eq(stockReceiptLines.receiptId, id))
    .orderBy(asc(stockReceiptLines.sort));
  const debt = await findDebtBySource(db, { kind: "payable", sourceType: "stock_receipt", sourceId: id });
  const people = await staffNames(db, [r.receipt.createdBy, r.receipt.postedBy]);
  return { ...r, lines, debt, people };
}

async function staffNames(db: Reader, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await db.select({ id: staffUsers.id, name: staffUsers.name, email: staffUsers.email }).from(staffUsers).where(inArray(staffUsers.id, list));
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

export async function listIssues(db: Reader, f: { kind?: string | null; status?: string | null } = {}) {
  const where: SQL[] = [];
  if (f.kind) where.push(sql`${stockIssues.kind} = ${f.kind}`);
  if (f.status) where.push(sql`${stockIssues.status} = ${f.status}`);
  return db
    .select({
      id: stockIssues.id,
      code: stockIssues.code,
      kind: stockIssues.kind,
      status: stockIssues.status,
      purpose: stockIssues.purpose,
      createdAt: stockIssues.createdAt,
      requestedName: staffUsers.name,
      lines: sql<number>`(select count(*)::int from stock_issue_lines l where l.issue_id = ${stockIssues.id})`,
    })
    .from(stockIssues)
    .leftJoin(staffUsers, eq(staffUsers.id, stockIssues.requestedBy))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(stockIssues.createdAt))
    .limit(200);
}

export async function getIssueDetail(db: Reader, id: string, today = vnToday()) {
  const [issue] = await db
    .select({ issue: stockIssues, warehouseCode: warehouses.code })
    .from(stockIssues)
    .leftJoin(warehouses, eq(warehouses.id, stockIssues.warehouseId))
    .where(eq(stockIssues.id, id));
  if (!issue) return null;
  const lines = await db
    .select({
      line: stockIssueLines,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      itemKind: inventoryItems.kind,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
      lotCode: stockLots.code,
      productLotId: stockLots.productLotId,
      receivedQty: stockLots.receivedQty,
      receivedCost: stockLots.receivedCost,
      locationCode: warehouseLocations.code,
    })
    .from(stockIssueLines)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockIssueLines.itemId))
    .leftJoin(stockLots, eq(stockLots.id, stockIssueLines.stockLotId))
    .leftJoin(warehouseLocations, eq(warehouseLocations.id, stockIssueLines.locationId))
    .where(eq(stockIssueLines.issueId, id))
    .orderBy(asc(stockIssueLines.createdAt), asc(stockIssueLines.id));

  // Gợi ý FEFO và cảnh báo chọn tay (R-KHO-10, R-KHO-11) cho phiếu chưa ghi sổ
  const hints = new Map<string, string>();
  if (issue.issue.status === "draft" || issue.issue.status === "pending_approval") {
    const type = ISSUE_MOVE[issue.issue.kind];
    let kinds = moveKinds(type);
    if (issue.issue.warehouseId) {
      const [w] = await db.select({ kind: warehouses.kind }).from(warehouses).where(eq(warehouses.id, issue.issue.warehouseId));
      kinds = w ? [w.kind] : [];
    }
    for (const l of lines) {
      const cands = await issueCandidates(db, l.line.itemId, kinds, issue.issue.warehouseId, today);
      const usableNeeded = moveNeedsUsableLot(type);
      if (l.line.stockLotId) {
        const w = usableNeeded ? fefoWarning(l.line.stockLotId, cands, today) : null;
        if (w) hints.set(l.line.id, w);
      } else {
        const plan = planFefo(usableNeeded ? cands : cands.map((c) => ({ ...c, usable: true })), l.line.qty, today);
        hints.set(l.line.id, plan.ok ? `Gợi ý FEFO: ${plan.picks.map((p) => `${cands.find((c) => c.stockLotId === p.stockLotId && c.locationId === p.locationId)?.code ?? "?"} × ${p.qty}`).join(", ")}` : `Hiện chỉ còn ${plan.available} (đơn vị cơ sở) khả dụng`);
      }
    }
  }
  const people = await staffNames(db, [issue.issue.requestedBy, issue.issue.approvedBy, issue.issue.postedBy]);
  const samples = await db.select().from(retainedSamples).where(eq(retainedSamples.stockIssueId, id));
  return { ...issue, lines, hints, people, samples };
}

export async function issueCandidates(db: Reader, itemId: string, kinds: WarehouseKind[], warehouseId: string | null, today: string): Promise<FefoCandidate[]> {
  const rows = await loadBalances(db, { itemIds: [itemId], warehouseId });
  return rows
    .filter((r) => kinds.includes(r.warehouseKind))
    .map((r) => ({
      stockLotId: r.stockLotId,
      locationId: r.locationId,
      warehouseId: r.warehouseId,
      qty: r.qty,
      code: r.lotCode,
      expiresOn: r.expiresOn,
      manufacturedOn: r.manufacturedOn,
      usable: isLotUsable(r, today),
    }));
}

export async function listTransfers(db: Reader, f: { status?: string | null } = {}) {
  const from = sql<string>`(select code from warehouses w where w.id = ${stockTransfers.fromWarehouseId})`;
  const to = sql<string>`(select code from warehouses w where w.id = ${stockTransfers.toWarehouseId})`;
  return db
    .select({ id: stockTransfers.id, code: stockTransfers.code, status: stockTransfers.status, reason: stockTransfers.reason, createdAt: stockTransfers.createdAt, fromCode: from, toCode: to, sourceType: stockTransfers.sourceType })
    .from(stockTransfers)
    .where(f.status ? sql`${stockTransfers.status} = ${f.status}` : undefined)
    .orderBy(desc(stockTransfers.createdAt))
    .limit(200);
}

export async function getTransferDetail(db: Reader, id: string) {
  const [t] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, id));
  if (!t) return null;
  const whs = await db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, [t.fromWarehouseId, t.toWarehouseId]));
  const fromLoc = sql<string>`(select code from warehouse_locations x where x.id = ${stockTransferLines.fromLocationId})`;
  const toLoc = sql<string>`(select code from warehouse_locations x where x.id = ${stockTransferLines.toLocationId})`;
  const lines = await db
    .select({ line: stockTransferLines, itemCode: inventoryItems.code, itemName: inventoryItems.name, baseUom: inventoryItems.baseUom, displayUom: inventoryItems.displayUom, lotCode: stockLots.code, fromLoc, toLoc })
    .from(stockTransferLines)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockTransferLines.itemId))
    .innerJoin(stockLots, eq(stockLots.id, stockTransferLines.stockLotId))
    .where(eq(stockTransferLines.transferId, id));
  const people = await staffNames(db, [t.createdBy, t.postedBy]);
  return { transfer: t, from: whs.find((w) => w.id === t.fromWarehouseId), to: whs.find((w) => w.id === t.toWarehouseId), lines, people };
}

// Điều chuyển: nháp → hủy (đặc tả: draft → cancelled)
export async function cancelTransferDraft(tx: Tx, transferId: string, actorId: string): Promise<void> {
  const [row] = await tx
    .update(stockTransfers)
    .set({ status: "cancelled" })
    .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.status, "draft")))
    .returning({ id: stockTransfers.id });
  if (!row) throw new UserError(STALE_MESSAGE);
  await writeAudit(tx, { actorId, action: "stock_transfer.cancelled", entity: "stock_transfers", entityId: transferId, before: { status: "draft" }, after: { status: "cancelled" } });
}

export async function listCounts(db: Reader) {
  return db
    .select({
      id: stockCounts.id,
      code: stockCounts.code,
      status: stockCounts.status,
      countedOn: stockCounts.countedOn,
      warehouseCode: warehouses.code,
      lines: sql<number>`(select count(*)::int from stock_count_lines l where l.count_id = ${stockCounts.id})`,
      counted: sql<number>`(select count(*)::int from stock_count_lines l where l.count_id = ${stockCounts.id} and l.counted_qty is not null)`,
    })
    .from(stockCounts)
    .innerJoin(warehouses, eq(warehouses.id, stockCounts.warehouseId))
    .orderBy(desc(stockCounts.createdAt))
    .limit(200);
}

export async function getCountDetail(db: Reader, id: string) {
  const [c] = await db.select({ count: stockCounts, warehouseCode: warehouses.code, warehouseName: warehouses.name }).from(stockCounts).innerJoin(warehouses, eq(warehouses.id, stockCounts.warehouseId)).where(eq(stockCounts.id, id));
  if (!c) return null;
  const current = sql<string>`coalesce((select qty from stock_balances b where b.location_id = ${stockCountLines.locationId} and b.stock_lot_id = ${stockCountLines.stockLotId}), 0)::text`;
  const lines = await db
    .select({
      line: stockCountLines,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
      lotCode: stockLots.code,
      receivedQty: stockLots.receivedQty,
      receivedCost: stockLots.receivedCost,
      locationCode: warehouseLocations.code,
      current,
    })
    .from(stockCountLines)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockCountLines.itemId))
    .innerJoin(stockLots, eq(stockLots.id, stockCountLines.stockLotId))
    .innerJoin(warehouseLocations, eq(warehouseLocations.id, stockCountLines.locationId))
    .where(eq(stockCountLines.countId, id))
    .orderBy(asc(warehouseLocations.code), asc(stockLots.code));
  const people = await staffNames(db, [c.count.createdBy, c.count.postedBy, c.count.approvedBy]);
  return { ...c, lines: lines.map((l) => ({ ...l, current: Number(l.current) })), people };
}

// ---------------------------------------------------------------------------------------------
// Báo cáo (R-KHO-21, R-KHO-22, R-KHO-28, AC-KHO-25, AC-KHO-26, AC-KHO-38)

export type LotReportRow = { stockLotId: string; lotCode: string; itemCode: string; itemName: string; baseUom: BaseUom; displayUom: string; qty: number; value: number; expiresOn: string | null; days: number };

async function lotsWithStock(db: Reader) {
  const rows = await loadBalances(db);
  const items = rows.length ? await db.select({ id: inventoryItems.id, code: inventoryItems.code, name: inventoryItems.name, baseUom: inventoryItems.baseUom, displayUom: inventoryItems.displayUom, kind: inventoryItems.kind, groupName: inventoryItems.groupName }).from(inventoryItems).where(inArray(inventoryItems.id, [...new Set(rows.map((r) => r.itemId))])) : [];
  return { rows, items: new Map(items.map((i) => [i.id, i])) };
}

// Sắp hết hạn và đã hết hạn: lô có số dư > 0 ngoài kho rejected (R-KHO-21)
export async function reportExpiry(db: Reader, today: string, warnDays: number): Promise<{ expiring: LotReportRow[]; expired: LotReportRow[] }> {
  const { rows, items } = await lotsWithStock(db);
  const byLot = new Map<string, LotReportRow & { flag: "expiring" | "expired" }>();
  for (const b of rows) {
    if (b.warehouseKind === "rejected") continue;
    const f = expiryFlag(b.expiresOn, today, warnDays);
    if (!f) continue;
    const it = items.get(b.itemId)!;
    const cur = byLot.get(b.stockLotId) ?? { stockLotId: b.stockLotId, lotCode: b.lotCode, itemCode: it.code, itemName: it.name, baseUom: it.baseUom, displayUom: it.displayUom, qty: 0, value: 0, expiresOn: b.expiresOn, days: f.days, flag: f.kind };
    cur.qty += b.qty;
    cur.value += balanceValue(b);
    byLot.set(b.stockLotId, cur);
  }
  const all = [...byLot.values()].sort((a, b) => a.days - b.days);
  const strip = ({ flag: _f, ...r }: LotReportRow & { flag: string }) => r;
  return { expiring: all.filter((r) => r.flag === "expiring").map(strip), expired: all.filter((r) => r.flag === "expired").map(strip) };
}

// Tồn lâu (R-KHO-22): từ lần xuất gần nhất (biến động âm trừ transfer_out) hoặc ngày nhập
export async function reportSlowMoving(db: Reader, today: string, threshold: number): Promise<LotReportRow[]> {
  const { rows, items } = await lotsWithStock(db);
  if (!rows.length) return [];
  const lotIds = [...new Set(rows.map((r) => r.stockLotId))];
  const lastOut = await db
    .select({ stockLotId: stockMovements.stockLotId, at: sql<string>`max(${stockMovements.occurredAt})::text` })
    .from(stockMovements)
    .where(and(inArray(stockMovements.stockLotId, lotIds), lt(stockMovements.qty, 0), ne(stockMovements.type, "transfer_out")))
    .groupBy(stockMovements.stockLotId);
  const firstIn = await db
    .select({ stockLotId: stockMovements.stockLotId, at: sql<string>`min(${stockMovements.occurredAt})::text` })
    .from(stockMovements)
    .where(and(inArray(stockMovements.stockLotId, lotIds), gt(stockMovements.qty, 0)))
    .groupBy(stockMovements.stockLotId);
  const lastMap = new Map(lastOut.map((r) => [r.stockLotId, vnToday(new Date(r.at))]));
  const inMap = new Map(firstIn.map((r) => [r.stockLotId, vnToday(new Date(r.at))]));
  const byLot = new Map<string, LotReportRow>();
  for (const b of rows) {
    const received = inMap.get(b.stockLotId) ?? vnToday(b.createdAt);
    const days = slowMovingDays(received, lastMap.get(b.stockLotId) ?? null, today, threshold);
    if (days === null) continue;
    const it = items.get(b.itemId)!;
    const cur = byLot.get(b.stockLotId) ?? { stockLotId: b.stockLotId, lotCode: b.lotCode, itemCode: it.code, itemName: it.name, baseUom: it.baseUom, displayUom: it.displayUom, qty: 0, value: 0, expiresOn: b.expiresOn, days };
    cur.qty += b.qty;
    cur.value += balanceValue(b);
    byLot.set(b.stockLotId, cur);
  }
  return [...byLot.values()].sort((a, b) => b.days - a.days);
}

// Giá trị tồn theo kho và theo nhóm hàng (R-KHO-28). Chỉ gọi khi người xem có finance.view.
export async function reportValuation(db: Reader): Promise<{ total: number; byWarehouse: { code: string; name: string; value: number }[]; byGroup: { kind: string; group: string; value: number }[] }> {
  const { rows, items } = await lotsWithStock(db);
  const whs = await db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).orderBy(asc(warehouses.code));
  const byWh = new Map<string, number>();
  const byGroup = new Map<string, { kind: string; group: string; value: number }>();
  let total = 0;
  for (const b of rows) {
    const v = balanceValue(b);
    total += v;
    byWh.set(b.warehouseId, (byWh.get(b.warehouseId) ?? 0) + v);
    const it = items.get(b.itemId)!;
    const key = `${it.kind}|${it.groupName}`;
    const g = byGroup.get(key) ?? { kind: it.kind, group: it.groupName, value: 0 };
    g.value += v;
    byGroup.set(key, g);
  }
  return {
    total,
    byWarehouse: whs.map((w) => ({ code: w.code, name: w.name, value: byWh.get(w.id) ?? 0 })).filter((w) => w.value > 0),
    byGroup: [...byGroup.values()].sort((a, b) => b.value - a.value),
  };
}

// ---------------------------------------------------------------------------------------------
// Sửa giá nhập sau ghi sổ (R-KHO-37, AC-KHO-41). Quyền finance.write kiểm ở action.

export async function updateReceiptLineCost(tx: Tx, lineId: string, newLineCost: number, reason: string, actorId: string): Promise<{ productionOrdersRecalculated: string[]; extractionReminders: string[] }> {
  const why = reason.trim();
  if (!why) throw new UserError("Ghi lý do sửa giá");
  if (!Number.isSafeInteger(newLineCost) || newLineCost < 0 || newLineCost > 2_147_483_647) throw new UserError("Thành tiền không hợp lệ");
  const [line] = await tx.select().from(stockReceiptLines).where(eq(stockReceiptLines.id, lineId)).for("update");
  if (!line) throw new UserError("Không tìm thấy dòng phiếu nhập");
  const [receipt] = await tx.select().from(stockReceipts).where(eq(stockReceipts.id, line.receiptId)).for("update");
  if (!receipt) throw new UserError("Không tìm thấy phiếu nhập");
  if (receipt.status !== "posted") throw new UserError("Chỉ sửa giá phiếu đã ghi sổ");
  if (!["purchase", "opening", "other"].includes(receipt.kind)) throw new UserError("Chỉ sửa giá phiếu nhập mua, tồn đầu kỳ hoặc nhập khác");
  if (receipt.paymentMode === "paid_now") throw new UserError("Phiếu đã trả tiền ngay: lập phiếu thu/chi chênh lệch");
  if (!line.stockLotId) throw new UserError("Dòng chưa có lô");
  if (newLineCost === line.lineCost) return { productionOrdersRecalculated: [], extractionReminders: [] };

  const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, line.stockLotId)).for("update");
  if (!lot) throw new UserError("Không tìm thấy lô");
  if (lot.costLockedAt) throw new UserError(`Lô ${lot.code} đã chốt giá vốn, không sửa được giá nhập`);

  // Lệnh SX đã xuất từ lô
  const usedBy = await tx
    .selectDistinct({ id: productionOrders.id, code: productionOrders.code, lockedAt: productionOrders.costLockedAt })
    .from(stockMovements)
    .innerJoin(productionOrders, eq(productionOrders.id, stockMovements.productionOrderId))
    .where(and(eq(stockMovements.stockLotId, lot.id), isNotNull(stockMovements.productionOrderId)));
  const locked = usedBy.find((p) => p.lockedAt);
  if (locked) throw new UserError(`Lô đã xuất cho lệnh ${locked.code} đã chốt giá, không sửa được giá nhập`);

  const createdByLine = lot.sourceDocType === "receipt" && lot.sourceDocId === receipt.id && line.stockLotId === lot.id && (await lotFirstLineOf(tx, receipt.id, lot.id)) === line.id;
  const newLotCost = lotCostAfterLineEdit(lot.receivedCost, line.lineCost, newLineCost, createdByLine);
  if (newLotCost < 0) throw new UserError("Giá lô sau khi sửa bị âm");
  await tx.update(stockLots).set({ receivedCost: newLotCost }).where(eq(stockLots.id, lot.id));
  await tx.update(stockReceiptLines).set({ lineCost: newLineCost }).where(eq(stockReceiptLines.id, line.id));
  const newTotal = receipt.totalCost - line.lineCost + newLineCost;
  if (newTotal > 2_147_483_647) throw new UserError("Tổng giá trị phiếu quá lớn");
  await tx.update(stockReceipts).set({ totalCost: newTotal, updatedAt: new Date() }).where(eq(stockReceipts.id, receipt.id));

  // Công nợ phải trả của phiếu (không thấp hơn đã trả)
  const debt = await findDebtBySource(tx, { kind: "payable", sourceType: "stock_receipt", sourceId: receipt.id });
  if (debt && debt.status !== "cancelled") {
    if (newTotal < debt.paidAmount) throw new UserError(`Phiếu đã trả ${debt.paidAmount.toLocaleString("vi-VN")}đ, giá mới không được thấp hơn số đã trả`);
    await adjustDebtAmount(tx, { kind: "payable", debtId: debt.id, newAmount: newTotal, reason: `Sửa giá ${receipt.code}: ${why}` }, actorId);
  } else if (!debt && receipt.paymentMode === "payable" && receipt.supplierId && receipt.kind !== "opening" && newTotal > 0) {
    const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, receipt.supplierId));
    const lineItems = await tx.select({ kind: inventoryItems.kind }).from(stockReceiptLines).innerJoin(inventoryItems, eq(inventoryItems.id, stockReceiptLines.itemId)).where(eq(stockReceiptLines.receiptId, receipt.id));
    await openPayable(
      tx,
      {
        supplierId: receipt.supplierId,
        categoryCode: lineItems.every((l) => l.kind === "packaging") ? "CHI-BAO-BI" : "CHI-NGUYEN-LIEU",
        source: { type: "stock_receipt", id: receipt.id, code: receipt.code },
        amount: newTotal,
        issuedOn: receipt.receivedOn,
        dueOn: addDays(receipt.receivedOn, s?.paymentTermsDays ?? 0),
      },
      actorId,
    );
  }

  await writeAudit(tx, {
    actorId,
    action: "stock_receipt_line.cost",
    entity: "stock_receipt_lines",
    entityId: line.id,
    before: { lineCost: line.lineCost, lotReceivedCost: lot.receivedCost, totalCost: receipt.totalCost },
    after: { lineCost: newLineCost, lotReceivedCost: newLotCost, totalCost: newTotal, reason: why },
  });

  const recalculated: string[] = [];
  for (const p of usedBy) {
    await recalcProductionCost(tx, p.id, actorId);
    recalculated.push(p.code);
  }
  // Lô dùng cho mẻ chiết: nhắc tính lại chi phí mẻ (R-SX-25)
  const runs = await tx
    .selectDistinct({ code: extractionRuns.code })
    .from(stockMovements)
    .innerJoin(extractionRuns, eq(extractionRuns.id, stockMovements.extractionRunId))
    .where(and(eq(stockMovements.stockLotId, lot.id), isNotNull(stockMovements.extractionRunId)));
  return { productionOrdersRecalculated: recalculated, extractionReminders: runs.map((r) => `Tính lại chi phí mẻ ${r.code}`) };
}

// Dòng đầu tiên của phiếu ghi vào lô (lô tạo bởi dòng đó)
async function lotFirstLineOf(tx: Tx, receiptId: string, stockLotId: string): Promise<string | null> {
  const [l] = await tx
    .select({ id: stockReceiptLines.id })
    .from(stockReceiptLines)
    .where(and(eq(stockReceiptLines.receiptId, receiptId), eq(stockReceiptLines.stockLotId, stockLotId)))
    .orderBy(asc(stockReceiptLines.sort))
    .limit(1);
  return l?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// Mẫu lưu khi xuất qc_sample lô thành phẩm (R-KHO-17)

export async function createRetainedSampleFromIssue(
  tx: Tx,
  issueId: string,
  input: { productLotId: string; units: number; location: string; keepUntil: string },
  actorId: string,
): Promise<{ id: string }> {
  const [issue] = await tx.select().from(stockIssues).where(eq(stockIssues.id, issueId));
  if (!issue) throw new UserError("Không tìm thấy phiếu xuất");
  if (issue.kind !== "qc_sample") throw new UserError("Chỉ phiếu xuất mẫu lưu mới tạo mẫu lưu");
  if (issue.status !== "posted") throw new UserError("Ghi sổ phiếu trước khi tạo mẫu lưu");
  if (!Number.isInteger(input.units) || input.units <= 0) throw new UserError("Số chai phải lớn hơn 0");
  const location = input.location.trim();
  if (!location) throw new UserError("Ghi nơi cất mẫu");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.keepUntil) || input.keepUntil <= vnToday()) throw new UserError("Ngày giữ đến phải sau hôm nay");
  const [issued] = await tx
    .select({ qty: sql<string>`coalesce(sum(${stockIssueLines.qty}), 0)::text` })
    .from(stockIssueLines)
    .innerJoin(stockLots, eq(stockLots.id, stockIssueLines.stockLotId))
    .where(and(eq(stockIssueLines.issueId, issueId), eq(stockLots.productLotId, input.productLotId)));
  const issuedQty = Number(issued?.qty ?? 0);
  if (issuedQty === 0) throw new UserError("Phiếu không xuất lô thành phẩm này");
  const [already] = await tx
    .select({ units: sql<string>`coalesce(sum(${retainedSamples.units}), 0)::text` })
    .from(retainedSamples)
    .where(and(eq(retainedSamples.stockIssueId, issueId), eq(retainedSamples.lotId, input.productLotId)));
  if (Number(already?.units ?? 0) + input.units > issuedQty) throw new UserError(`Phiếu chỉ xuất ${issuedQty} chai của lô này`);
  const [row] = await tx
    .insert(retainedSamples)
    .values({ lotId: input.productLotId, units: input.units, location, keepUntil: input.keepUntil, stockIssueId: issueId })
    .returning({ id: retainedSamples.id });
  await writeAudit(tx, { actorId, action: "retained_sample.created", entity: "retained_samples", entityId: row!.id, after: { issueId, lotId: input.productLotId, units: input.units, location, keepUntil: input.keepUntil } });
  return { id: row!.id };
}

// ---------------------------------------------------------------------------------------------
// Chọn lựa cho form

// Lô còn hàng để chọn ở phiếu xuất, điều chuyển
export async function pickableLots(db: Reader) {
  const rows = await loadBalances(db);
  const items = rows.length ? await db.select({ id: inventoryItems.id, code: inventoryItems.code, name: inventoryItems.name, baseUom: inventoryItems.baseUom, displayUom: inventoryItems.displayUom }).from(inventoryItems).where(inArray(inventoryItems.id, [...new Set(rows.map((r) => r.itemId))])) : [];
  const im = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => ({ ...r, item: im.get(r.itemId)! }));
}

// Lô sản xuất (lots) để nhập thành phẩm
export async function productLotsForItems(db: Reader) {
  return db
    .select({ id: lots.id, lotNo: lots.lotNo, productId: lots.productId, itemId: inventoryItems.id })
    .from(lots)
    .innerJoin(inventoryItems, eq(inventoryItems.productId, lots.productId))
    .orderBy(desc(lots.manufacturedOn));
}
