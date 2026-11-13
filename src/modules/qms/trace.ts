// Truy xuất ngược/xuôi và cân đối lô thành phẩm (03-chat-luong.md R-CL-19, R-CL-20, R-CL-21).
import { and, asc, eq, inArray, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db/client";
import {
  customers,
  dealers,
  extractionRuns,
  inventoryItems,
  lotMaterials,
  lots,
  orderItems,
  orders,
  productionOrders,
  products,
  qcInspections,
  stockBalances,
  stockLots,
  stockMovements,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { maskPhone } from "@/lib/phone";
import { formatQty, type BaseUom, type DisplayUom } from "@/modules/inventory/rules";
import { computeLotBalance, TRACE_MAX_DEPTH, type LotBalance } from "./rules";

type DB = Db | Tx;

export type TraceNode = {
  kind: "lot" | "production_order" | "stock_lot" | "extraction_run" | "legacy_material" | "order";
  id: string;
  code: string;
  title: string;
  qty?: string;
  meta: string[];
  href?: string;
  children: TraceNode[];
};

export type TraceOrderRow = { lotNo: string; orderId: string; orderCode: string; status: string; customerName: string; phone: string; dealer: string; qty: number };

const INSPECTION_STATUS_TEXT: Record<string, string> = { pending: "đang chờ", passed: "đạt", failed: "không đạt", cancelled: "đã hủy" };

// Tìm theo số lô thành phẩm hoặc mã lô kho (VT-, EX-)
export async function resolveTraceCode(db: DB, raw: string): Promise<{ kind: "lot"; id: string } | { kind: "stock_lot"; id: string } | null> {
  const code = raw.trim().toUpperCase();
  if (!code) return null;
  const [lot] = await db.select({ id: lots.id }).from(lots).where(eq(lots.lotNo, code)).limit(1);
  if (lot) return { kind: "lot", id: lot.id };
  const [sl] = await db.select({ id: stockLots.id, productLotId: stockLots.productLotId }).from(stockLots).where(eq(stockLots.code, code)).limit(1);
  if (!sl) return null;
  return sl.productLotId ? { kind: "lot", id: sl.productLotId } : { kind: "stock_lot", id: sl.id };
}

function fq(qty: number, uom: { baseUom: BaseUom; displayUom: string }) {
  return formatQty(qty, uom.baseUom, uom.displayUom as DisplayUom);
}

// Lượng dùng ròng theo lô kho cho lệnh SX / mẻ chiết: xuất − trả, tính cả dòng đảo
async function netConsumption(db: DB, ref: { productionOrderId?: string; extractionRunId?: string }): Promise<Map<string, number>> {
  const where = ref.productionOrderId
    ? and(eq(stockMovements.productionOrderId, ref.productionOrderId), inArray(stockMovements.type, ["production_issue", "production_return"]))
    : and(eq(stockMovements.extractionRunId, ref.extractionRunId!), eq(stockMovements.type, "extraction_issue"));
  const base = await db.select({ id: stockMovements.id, stockLotId: stockMovements.stockLotId, qty: stockMovements.qty }).from(stockMovements).where(where);
  const reversals = base.length ? await db.select({ stockLotId: stockMovements.stockLotId, qty: stockMovements.qty }).from(stockMovements).where(inArray(stockMovements.reversalOf, base.map((b) => b.id))) : [];
  const out = new Map<string, number>();
  for (const m of [...base, ...reversals]) out.set(m.stockLotId, (out.get(m.stockLotId) ?? 0) - m.qty);
  for (const [k, v] of out) if (v <= 0) out.delete(k);
  return out;
}

async function balancesText(db: DB, stockLotIds: string[]): Promise<Map<string, string>> {
  if (stockLotIds.length === 0) return new Map();
  const rows = await db
    .select({ stockLotId: stockBalances.stockLotId, wh: warehouses.code, qty: stockBalances.qty, baseUom: inventoryItems.baseUom, displayUom: inventoryItems.displayUom })
    .from(stockBalances)
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockBalances.itemId))
    .where(and(inArray(stockBalances.stockLotId, stockLotIds), ne(stockBalances.qty, 0)))
    .orderBy(asc(warehouses.code));
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.stockLotId, [...(m.get(r.stockLotId) ?? []), `${r.wh} ${fq(r.qty, r)}`]);
  return new Map([...m].map(([k, v]) => [k, `Tồn: ${v.join(" · ")}`]));
}

async function stockLotNode(db: DB, stockLotId: string, qty: number | null, depth: number, direction: "back" | "forward", showPhone: boolean, orderRows: TraceOrderRow[]): Promise<TraceNode | null> {
  const [sl] = await db
    .select({
      id: stockLots.id,
      code: stockLots.code,
      qcStatus: stockLots.qcStatus,
      supplierLotNo: stockLots.supplierLotNo,
      manufacturedOn: stockLots.manufacturedOn,
      expiresOn: stockLots.expiresOn,
      sourceDocType: stockLots.sourceDocType,
      sourceDocId: stockLots.sourceDocId,
      extractionRunId: stockLots.extractionRunId,
      productLotId: stockLots.productLotId,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
      supplierCode: suppliers.code,
      supplierName: suppliers.name,
    })
    .from(stockLots)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
    .leftJoin(suppliers, eq(suppliers.id, stockLots.supplierId))
    .where(eq(stockLots.id, stockLotId));
  if (!sl) return null;
  if (sl.productLotId && direction === "forward") return lotForwardNode(db, sl.productLotId, depth, showPhone, orderRows);

  const meta: string[] = [];
  if (sl.supplierCode) meta.push(`NCC ${sl.supplierCode} ${sl.supplierName}`);
  if (sl.supplierLotNo) meta.push(`Số lô NCC ${sl.supplierLotNo}`);
  if (sl.sourceDocType === "receipt") {
    const [r] = await db.select({ code: stockReceipts.code, receivedOn: stockReceipts.receivedOn }).from(stockReceipts).where(eq(stockReceipts.id, sl.sourceDocId));
    if (r) meta.push(`Phiếu nhập ${r.code} (${r.receivedOn})`);
  }
  const insps = await db
    .select({ code: qcInspections.code, status: qcInspections.status })
    .from(qcInspections)
    .where(and(eq(qcInspections.stockLotId, stockLotId), ne(qcInspections.status, "cancelled")))
    .orderBy(asc(qcInspections.createdAt));
  for (const i of insps) meta.push(`${i.code} ${INSPECTION_STATUS_TEXT[i.status]}`);
  const bal = (await balancesText(db, [stockLotId])).get(stockLotId);
  if (bal) meta.push(bal);

  const node: TraceNode = {
    kind: "stock_lot",
    id: sl.id,
    code: sl.code,
    title: `${sl.itemCode} ${sl.itemName}`,
    qty: qty === null ? undefined : fq(qty, sl),
    meta,
    children: [],
  };
  if (depth >= TRACE_MAX_DEPTH) return node;

  if (direction === "back") {
    // Lô EX → mẻ chiết → lô vỏ đã xuất cho mẻ
    const runId = sl.extractionRunId ?? (await db.select({ id: extractionRuns.id }).from(extractionRuns).where(eq(extractionRuns.outputStockLotId, sl.id)).limit(1))[0]?.id ?? null;
    if (runId) {
      const run = await extractionRunNode(db, runId);
      if (run) {
        for (const [lotId, q] of await netConsumption(db, { extractionRunId: runId })) {
          const child = await stockLotNode(db, lotId, q, depth + 2, "back", showPhone, orderRows);
          if (child) run.children.push(child);
        }
        node.children.push(run);
      }
    }
  } else {
    // Lô → lệnh SX đã dùng → lô thành phẩm
    const used = await db
      .select({ productionOrderId: stockMovements.productionOrderId, extractionRunId: stockMovements.extractionRunId })
      .from(stockMovements)
      .where(and(eq(stockMovements.stockLotId, stockLotId), inArray(stockMovements.type, ["production_issue", "extraction_issue"])));
    const poIds = [...new Set(used.map((u) => u.productionOrderId).filter((x): x is string => !!x))];
    const runIds = [...new Set(used.map((u) => u.extractionRunId).filter((x): x is string => !!x))];
    for (const poId of poIds) {
      const q = (await netConsumption(db, { productionOrderId: poId })).get(stockLotId);
      if (!q) continue;
      const po = await productionOrderNode(db, poId, fq(q, sl));
      if (!po) continue;
      if (po.lotId) {
        const lotNode = await lotForwardNode(db, po.lotId, depth + 2, showPhone, orderRows);
        if (lotNode) po.node.children.push(lotNode);
      }
      node.children.push(po.node);
    }
    for (const runId of runIds) {
      const q = (await netConsumption(db, { extractionRunId: runId })).get(stockLotId);
      if (!q) continue;
      const run = await extractionRunNode(db, runId);
      if (!run) continue;
      run.qty = fq(q, sl);
      const outLots = await db.select({ id: stockLots.id }).from(stockLots).where(eq(stockLots.extractionRunId, runId));
      for (const o of outLots) {
        const child = await stockLotNode(db, o.id, null, depth + 2, "forward", showPhone, orderRows);
        if (child) run.children.push(child);
      }
      node.children.push(run);
    }
  }
  return node;
}

async function extractionRunNode(db: DB, runId: string): Promise<TraceNode | null> {
  const [run] = await db
    .select({ id: extractionRuns.id, code: extractionRuns.code, variety: extractionRuns.pomeloVariety, harvestOn: extractionRuns.harvestOn, supplierCode: suppliers.code, supplierName: suppliers.name, status: extractionRuns.status })
    .from(extractionRuns)
    .leftJoin(suppliers, eq(suppliers.id, extractionRuns.sourceSupplierId))
    .where(eq(extractionRuns.id, runId));
  if (!run) return null;
  const meta: string[] = [];
  if (run.supplierCode) meta.push(`Vườn ${run.supplierCode} ${run.supplierName}`);
  if (run.variety) meta.push(`Giống ${run.variety}`);
  if (run.harvestOn) meta.push(`Thu hoạch ${run.harvestOn}`);
  return { kind: "extraction_run", id: run.id, code: run.code, title: "Mẻ chiết", meta, href: `/admin/san-xuat/chiet-xuat/${run.id}`, children: [] };
}

async function productionOrderNode(db: DB, poId: string, qty?: string): Promise<{ node: TraceNode; lotId: string | null } | null> {
  const [po] = await db.select({ id: productionOrders.id, code: productionOrders.code, status: productionOrders.status, lotId: productionOrders.lotId, goodUnits: productionOrders.goodUnits }).from(productionOrders).where(eq(productionOrders.id, poId));
  if (!po) return null;
  const meta = po.goodUnits !== null ? [`${po.goodUnits} chai đạt`] : [];
  return { node: { kind: "production_order", id: po.id, code: po.code, title: "Lệnh sản xuất", qty, meta, href: `/admin/san-xuat/lenh/${po.id}`, children: [] }, lotId: po.lotId };
}

async function lotHeader(db: DB, lotId: string) {
  const [lot] = await db
    .select({ id: lots.id, lotNo: lots.lotNo, status: lots.releaseStatus, units: lots.unitsProduced, productName: products.name })
    .from(lots)
    .innerJoin(products, eq(products.id, lots.productId))
    .where(eq(lots.id, lotId));
  return lot ?? null;
}

// Lô thành phẩm → các đơn (chưa hủy), khách, đại lý, số chai
async function lotForwardNode(db: DB, lotId: string, depth: number, showPhone: boolean, orderRows: TraceOrderRow[]): Promise<TraceNode | null> {
  const lot = await lotHeader(db, lotId);
  if (!lot) return null;
  const sl = await db.select({ id: stockLots.id }).from(stockLots).where(eq(stockLots.productLotId, lotId));
  const bal = await balancesText(db, sl.map((s) => s.id));
  const node: TraceNode = { kind: "lot", id: lot.id, code: lot.lotNo, title: lot.productName, meta: [...bal.values()], href: `/admin/lo/${lot.id}`, children: [] };
  if (depth > TRACE_MAX_DEPTH) return node;
  for (const o of await ordersOfLots(db, [lotId], showPhone)) {
    orderRows.push({ ...o, lotNo: lot.lotNo });
    node.children.push({
      kind: "order",
      id: o.orderId,
      code: o.orderCode,
      title: o.customerName || "Khách",
      qty: `${o.qty} chai`,
      meta: [o.phone, o.dealer].filter(Boolean),
      href: `/admin/don-hang/${o.orderId}`,
      children: [],
    });
  }
  return node;
}

// Đơn chưa hủy có dòng thuộc lô, gom theo đơn
export async function ordersOfLots(db: DB, lotIds: string[], showPhone: boolean): Promise<(Omit<TraceOrderRow, "lotNo"> & { lotId: string; customerId: string | null; dealerId: string | null })[]> {
  if (lotIds.length === 0) return [];
  const rows = await db
    .select({
      lotId: orderItems.lotId,
      orderId: orders.id,
      orderCode: orders.code,
      status: orders.status,
      customerId: orders.customerId,
      dealerId: orders.dealerId,
      recipientName: orders.recipientName,
      phone: orders.phoneE164,
      customerName: customers.name,
      qty: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(and(inArray(orderItems.lotId, lotIds), ne(orders.status, "cancelled")))
    .orderBy(asc(orders.createdAt));
  const dealerIds = [...new Set(rows.map((r) => r.dealerId).filter((x): x is string => !!x))];
  const dealerMap = new Map(dealerIds.length ? (await db.select({ id: dealers.id, code: dealers.code, name: dealers.name }).from(dealers).where(inArray(dealers.id, dealerIds))).map((d) => [d.id, `Đại lý ${d.code} ${d.name}`]) : []);
  const byKey = new Map<string, Omit<TraceOrderRow, "lotNo"> & { lotId: string; customerId: string | null; dealerId: string | null }>();
  for (const r of rows) {
    const key = `${r.orderId}:${r.lotId}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.qty += r.qty;
      continue;
    }
    byKey.set(key, {
      lotId: r.lotId!,
      orderId: r.orderId,
      orderCode: r.orderCode,
      status: r.status,
      customerId: r.customerId,
      dealerId: r.dealerId,
      customerName: r.customerName ?? r.recipientName,
      phone: showPhone ? r.phone : maskPhone(r.phone),
      dealer: r.dealerId ? (dealerMap.get(r.dealerId) ?? "") : "",
      qty: r.qty,
    });
  }
  return [...byKey.values()];
}

// R-CL-19: từ lô thành phẩm về NVL
export async function traceBackward(db: DB, lotId: string): Promise<TraceNode | null> {
  const lot = await lotHeader(db, lotId);
  if (!lot) return null;
  const node: TraceNode = { kind: "lot", id: lot.id, code: lot.lotNo, title: lot.productName, meta: [`${lot.units} chai sản xuất`], href: `/admin/lo/${lot.id}`, children: [] };
  const pos = await db.select({ id: productionOrders.id }).from(productionOrders).where(eq(productionOrders.lotId, lotId));
  for (const p of pos) {
    const po = await productionOrderNode(db, p.id);
    if (!po) continue;
    for (const [stockLotId, q] of await netConsumption(db, { productionOrderId: p.id })) {
      const child = await stockLotNode(db, stockLotId, q, 2, "back", false, []);
      if (child) po.node.children.push(child);
    }
    node.children.push(po.node);
  }
  if (pos.length === 0) {
    // Lô cũ không có lệnh SX: hiện lot_materials
    const mats = await db.select().from(lotMaterials).where(eq(lotMaterials.lotId, lotId));
    for (const m of mats) {
      node.children.push({
        kind: "legacy_material",
        id: m.id,
        code: m.materialCode,
        title: "Nguyên liệu (hồ sơ cũ)",
        qty: m.quantity ?? undefined,
        meta: [m.supplierLotNo ? `Số lô NCC ${m.supplierLotNo}` : "", m.coaFileId ? "Có COA" : "Chưa có COA"].filter(Boolean),
        children: [],
      });
    }
  }
  return node;
}

// R-CL-20: từ lô vật tư/lô EX (hoặc lô thành phẩm) ra lệnh, lô TP, đơn, khách
export async function traceForward(db: DB, ref: { kind: "lot" | "stock_lot"; id: string }, showPhone: boolean): Promise<{ tree: TraceNode | null; orders: TraceOrderRow[] }> {
  const rows: TraceOrderRow[] = [];
  const tree = ref.kind === "lot" ? await lotForwardNode(db, ref.id, 1, showPhone, rows) : await stockLotNode(db, ref.id, null, 1, "forward", showPhone, rows);
  return { tree, orders: rows };
}

// R-CL-21: cân đối lô thành phẩm từ sổ kho
export async function lotBalance(db: DB, lotId: string): Promise<LotBalance> {
  const orig = alias(stockMovements, "orig");
  const rows = await db
    .select({ type: stockMovements.type, qty: stockMovements.qty, originalType: orig.type, warehouseKind: warehouses.kind })
    .from(stockMovements)
    .innerJoin(stockLots, eq(stockLots.id, stockMovements.stockLotId))
    .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .leftJoin(orig, eq(orig.id, stockMovements.reversalOf))
    .where(eq(stockLots.productLotId, lotId));
  return computeLotBalance(rows);
}

// Số đã thu về theo hồ sơ thu hồi (R-CL-24): biến động return_receipt của phiếu nhập có nguồn recall
export async function recalledReturnQty(db: DB, lotId: string, recallId?: string): Promise<number> {
  const rows = await db
    .select({ qty: stockMovements.qty })
    .from(stockMovements)
    .innerJoin(stockLots, eq(stockLots.id, stockMovements.stockLotId))
    .innerJoin(stockReceipts, and(eq(stockMovements.docType, "receipt"), eq(stockReceipts.id, stockMovements.docId)))
    .where(
      and(
        eq(stockLots.productLotId, lotId),
        eq(stockMovements.type, "return_receipt"),
        eq(stockReceipts.sourceType, "recall"),
        recallId ? eq(stockReceipts.sourceId, recallId) : or(eq(stockReceipts.sourceType, "recall")),
      ),
    );
  return rows.reduce((s, r) => s + r.qty, 0);
}
