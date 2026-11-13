// Đọc dữ liệu cho trang quản trị Chất lượng (03-chat-luong.md mục Màn hình). Chỉ đọc, không ghi.
import { and, asc, desc, eq, inArray, lte, ne, or, type SQL } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  capaActions,
  capas,
  complaints,
  customers,
  dealers,
  extractionRuns,
  formulaVersions,
  inventoryItems,
  lots,
  lotTests,
  ncrs,
  notifications,
  orderItems,
  orders,
  productionOrders,
  productionOrderSteps,
  products,
  qcInspections,
  qcStandards,
  recallContacts,
  recallLots,
  recalls,
  retainedSamples,
  stockLots,
  stockReceipts,
  suppliers,
} from "@/db/schema";
import { maskPhone } from "@/lib/phone";
import { evaluateInspection } from "./decisions";
import type { CapaStatus, InspectionStageKey, NcrSeverity, NcrStatus } from "./rules";

export const STAGE_LABEL: Record<InspectionStageKey, string> = { iqc: "IQC", ipqc: "IPQC", fqc: "FQC", recheck: "Kiểm lại" };
export const STAGE_DESCRIPTION: Record<InspectionStageKey, string> = {
  iqc: "Kiểm đầu vào",
  ipqc: "Kiểm trong quá trình",
  fqc: "Kiểm thành phẩm",
  recheck: "Kiểm lại mẫu lưu",
};
export type InspectionStatusKey = "pending" | "passed" | "failed" | "cancelled";
export const INSPECTION_STATUS_LABEL: Record<InspectionStatusKey, string> = { pending: "Đang chờ", passed: "Đạt", failed: "Không đạt", cancelled: "Đã hủy" };
export const APPLIES_TO_LABEL = { raw_material: "Nguyên liệu", extract: "Tinh dầu, chiết xuất", wip: "Bán thành phẩm", finished: "Thành phẩm", packaging: "Bao bì" } as const;
export const STANDARD_STATUS_LABEL = { draft: "Nháp", active: "Đang áp dụng", archived: "Lưu trữ" } as const;
export const RECALL_STATUS_LABEL = { open: "Mới mở", in_progress: "Đang xử lý", closed: "Đã đóng" } as const;
export const CAPA_TYPE_LABEL = { corrective: "Khắc phục", preventive: "Phòng ngừa" } as const;

async function d(db?: Db): Promise<Db> {
  return db ?? (await getDb());
}

// ---------------------------------------------------------------------------------------------
// Phiếu kiểm

export async function listInspections(filter: { stage?: InspectionStageKey; status?: InspectionStatusKey; supplierId?: string }, db?: Db) {
  const x = await d(db);
  const conds: SQL[] = [];
  if (filter.stage) conds.push(eq(qcInspections.stage, filter.stage));
  if (filter.status) conds.push(eq(qcInspections.status, filter.status));
  if (filter.supplierId) conds.push(eq(qcInspections.supplierId, filter.supplierId));
  return x
    .select({
      id: qcInspections.id,
      code: qcInspections.code,
      stage: qcInspections.stage,
      status: qcInspections.status,
      createdAt: qcInspections.createdAt,
      decidedAt: qcInspections.decidedAt,
      stockLotCode: stockLots.code,
      itemName: inventoryItems.name,
      lotNo: lots.lotNo,
      orderCode: productionOrders.code,
      stepName: productionOrderSteps.name,
      runCode: extractionRuns.code,
      supplierName: suppliers.name,
    })
    .from(qcInspections)
    .leftJoin(stockLots, eq(stockLots.id, qcInspections.stockLotId))
    .leftJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
    .leftJoin(lots, eq(lots.id, qcInspections.lotId))
    .leftJoin(productionOrders, eq(productionOrders.id, qcInspections.productionOrderId))
    .leftJoin(productionOrderSteps, eq(productionOrderSteps.id, qcInspections.productionStepId))
    .leftJoin(extractionRuns, eq(extractionRuns.id, qcInspections.extractionRunId))
    .leftJoin(suppliers, eq(suppliers.id, qcInspections.supplierId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(qcInspections.createdAt))
    .limit(200);
}

export async function inspectionCounts(db?: Db) {
  const x = await d(db);
  const rows = await x.select({ stage: qcInspections.stage }).from(qcInspections).where(eq(qcInspections.status, "pending"));
  const out: Record<InspectionStageKey, number> = { iqc: 0, ipqc: 0, fqc: 0, recheck: 0 };
  for (const r of rows) out[r.stage]++;
  return out;
}

export async function listSuppliersBrief(db?: Db) {
  const x = await d(db);
  return x.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.code));
}

export async function getInspectionDetail(id: string, db?: Db) {
  const x = await d(db);
  const [insp] = await x.select().from(qcInspections).where(eq(qcInspections.id, id));
  if (!insp) return null;
  const one = async <T>(p: Promise<T[]>): Promise<T | null> => (await p)[0] ?? null;
  const [evaluated, standard, stockLot, lot, supplier, receipt, order, step, run, complaint, linkedNcrs] = await Promise.all([
    evaluateInspection(x, insp),
    insp.standardId ? one(x.select({ id: qcStandards.id, code: qcStandards.code, version: qcStandards.version, name: qcStandards.name }).from(qcStandards).where(eq(qcStandards.id, insp.standardId))) : null,
    insp.stockLotId
      ? one(
          x
            .select({
              id: stockLots.id,
              code: stockLots.code,
              qcStatus: stockLots.qcStatus,
              holdReason: stockLots.holdReason,
              supplierLotNo: stockLots.supplierLotNo,
              manufacturedOn: stockLots.manufacturedOn,
              expiresOn: stockLots.expiresOn,
              receivedQty: stockLots.receivedQty,
              itemCode: inventoryItems.code,
              itemName: inventoryItems.name,
              itemKind: inventoryItems.kind,
              baseUom: inventoryItems.baseUom,
              displayUom: inventoryItems.displayUom,
            })
            .from(stockLots)
            .innerJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
            .where(eq(stockLots.id, insp.stockLotId)),
        )
      : null,
    insp.lotId ? one(x.select({ id: lots.id, lotNo: lots.lotNo, releaseStatus: lots.releaseStatus, productId: lots.productId, productName: products.name, expiresOn: lots.expiresOn }).from(lots).innerJoin(products, eq(products.id, lots.productId)).where(eq(lots.id, insp.lotId))) : null,
    insp.supplierId ? one(x.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, qualified: suppliers.qualified }).from(suppliers).where(eq(suppliers.id, insp.supplierId))) : null,
    insp.stockReceiptId ? one(x.select({ id: stockReceipts.id, code: stockReceipts.code }).from(stockReceipts).where(eq(stockReceipts.id, insp.stockReceiptId))) : null,
    insp.productionOrderId ? one(x.select({ id: productionOrders.id, code: productionOrders.code }).from(productionOrders).where(eq(productionOrders.id, insp.productionOrderId))) : null,
    insp.productionStepId ? one(x.select({ id: productionOrderSteps.id, seq: productionOrderSteps.seq, name: productionOrderSteps.name }).from(productionOrderSteps).where(eq(productionOrderSteps.id, insp.productionStepId))) : null,
    insp.extractionRunId ? one(x.select({ id: extractionRuns.id, code: extractionRuns.code }).from(extractionRuns).where(eq(extractionRuns.id, insp.extractionRunId))) : null,
    insp.complaintId ? one(x.select({ id: complaints.id, symptoms: complaints.symptoms }).from(complaints).where(eq(complaints.id, insp.complaintId))) : null,
    x.select({ id: ncrs.id, code: ncrs.code, status: ncrs.status }).from(ncrs).where(eq(ncrs.inspectionId, id)),
  ]);
  // FQC: khối lot_tests và phiếu công bố của sản phẩm
  const [tests, notification] = lot
    ? await Promise.all([
        x.select().from(lotTests).where(eq(lotTests.lotId, lot.id)).orderBy(asc(lotTests.type)),
        one(x.select().from(notifications).where(eq(notifications.productId, lot.productId)).orderBy(desc(notifications.expiresAt)).limit(1)),
      ])
    : [[], null];
  return { inspection: insp, ...evaluated, standard, stockLot, lot, supplier, receipt, order, step, run, complaint, ncrs: linkedNcrs, tests, notification };
}

// ---------------------------------------------------------------------------------------------
// NCR

export async function listNcrs(filter: { status?: NcrStatus; severity?: NcrSeverity; overdueOn?: string }, db?: Db) {
  const x = await d(db);
  const conds: SQL[] = [];
  if (filter.status) conds.push(eq(ncrs.status, filter.status));
  if (filter.severity) conds.push(eq(ncrs.severity, filter.severity));
  if (filter.overdueOn) conds.push(lte(ncrs.dueOn, filter.overdueOn), inArray(ncrs.status, ["open", "investigating", "action", "verifying"]));
  return x
    .select({ id: ncrs.id, code: ncrs.code, title: ncrs.title, category: ncrs.category, severity: ncrs.severity, status: ncrs.status, dueOn: ncrs.dueOn, createdAt: ncrs.createdAt, lotNo: lots.lotNo })
    .from(ncrs)
    .leftJoin(lots, eq(lots.id, ncrs.lotId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(ncrs.createdAt))
    .limit(200);
}

export async function getNcrDetail(id: string, db?: Db) {
  const x = await d(db);
  const [n] = await x.select().from(ncrs).where(eq(ncrs.id, id));
  if (!n) return null;
  const one = async <T>(p: Promise<T[]>): Promise<T | null> => (await p)[0] ?? null;
  const [lot, stockLot, order, run, inspection, supplier, complaint, linkedCapas] = await Promise.all([
    n.lotId ? one(x.select({ id: lots.id, lotNo: lots.lotNo }).from(lots).where(eq(lots.id, n.lotId))) : null,
    n.stockLotId ? one(x.select({ id: stockLots.id, code: stockLots.code }).from(stockLots).where(eq(stockLots.id, n.stockLotId))) : null,
    n.productionOrderId ? one(x.select({ id: productionOrders.id, code: productionOrders.code }).from(productionOrders).where(eq(productionOrders.id, n.productionOrderId))) : null,
    n.extractionRunId ? one(x.select({ id: extractionRuns.id, code: extractionRuns.code }).from(extractionRuns).where(eq(extractionRuns.id, n.extractionRunId))) : null,
    n.inspectionId ? one(x.select({ id: qcInspections.id, code: qcInspections.code }).from(qcInspections).where(eq(qcInspections.id, n.inspectionId))) : null,
    n.supplierId ? one(x.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, n.supplierId))) : null,
    n.complaintId ? one(x.select({ id: complaints.id, symptoms: complaints.symptoms }).from(complaints).where(eq(complaints.id, n.complaintId))) : null,
    x.select({ id: capas.id, code: capas.code, title: capas.title, status: capas.status }).from(capas).where(eq(capas.ncrId, id)).orderBy(asc(capas.createdAt)),
  ]);
  return { ncr: n, lot, stockLot, order, run, inspection, supplier, complaint, capas: linkedCapas };
}

// ---------------------------------------------------------------------------------------------
// CAPA

export async function listCapas(filter: { status?: CapaStatus }, db?: Db) {
  const x = await d(db);
  return x
    .select({ id: capas.id, code: capas.code, title: capas.title, type: capas.type, status: capas.status, dueOn: capas.dueOn, createdAt: capas.createdAt, ncrCode: ncrs.code })
    .from(capas)
    .leftJoin(ncrs, eq(ncrs.id, capas.ncrId))
    .where(filter.status ? eq(capas.status, filter.status) : undefined)
    .orderBy(desc(capas.createdAt))
    .limit(200);
}

export async function getCapaDetail(id: string, db?: Db) {
  const x = await d(db);
  const [c] = await x.select().from(capas).where(eq(capas.id, id));
  if (!c) return null;
  const one = async <T>(p: Promise<T[]>): Promise<T | null> => (await p)[0] ?? null;
  const [steps, ncr, lot, complaint] = await Promise.all([
    x.select().from(capaActions).where(eq(capaActions.capaId, id)).orderBy(asc(capaActions.sort), asc(capaActions.createdAt)),
    c.ncrId ? one(x.select({ id: ncrs.id, code: ncrs.code }).from(ncrs).where(eq(ncrs.id, c.ncrId))) : null,
    c.lotId ? one(x.select({ id: lots.id, lotNo: lots.lotNo }).from(lots).where(eq(lots.id, c.lotId))) : null,
    c.complaintId ? one(x.select({ id: complaints.id, symptoms: complaints.symptoms }).from(complaints).where(eq(complaints.id, c.complaintId))) : null,
  ]);
  return { capa: c, steps, ncr, lot, complaint };
}

// ---------------------------------------------------------------------------------------------
// Thu hồi

export async function listRecalls(db?: Db) {
  const x = await d(db);
  return x.select().from(recalls).orderBy(desc(recalls.openedAt)).limit(200);
}

export async function recallableLots(db?: Db) {
  const x = await d(db);
  return x
    .select({ id: lots.id, lotNo: lots.lotNo, status: lots.releaseStatus, productName: products.name })
    .from(lots)
    .innerJoin(products, eq(products.id, lots.productId))
    .where(inArray(lots.releaseStatus, ["released", "on_hold"]))
    .orderBy(desc(lots.manufacturedOn));
}

export async function listOpenNcrsBrief(db?: Db) {
  const x = await d(db);
  return x.select({ id: ncrs.id, code: ncrs.code, title: ncrs.title }).from(ncrs).where(inArray(ncrs.status, ["open", "investigating", "action", "verifying"])).orderBy(desc(ncrs.createdAt));
}

export async function getRecallDetail(id: string, showPhone: boolean, db?: Db) {
  const x = await d(db);
  const [r] = await x.select().from(recalls).where(eq(recalls.id, id));
  if (!r) return null;
  const lotIds = (await x.select({ lotId: recallLots.lotId }).from(recallLots).where(eq(recallLots.recallId, id))).map((l) => l.lotId);
  const contactRows = await x
    .select({
      id: recallContacts.id,
      orderId: recallContacts.orderId,
      status: recallContacts.status,
      contactedAt: recallContacts.contactedAt,
      note: recallContacts.note,
      orderCode: orders.code,
      orderStatus: orders.status,
      recipientName: orders.recipientName,
      phone: orders.phoneE164,
      customerName: customers.name,
      dealerCode: dealers.code,
      dealerName: dealers.name,
    })
    .from(recallContacts)
    .innerJoin(orders, eq(orders.id, recallContacts.orderId))
    .leftJoin(customers, eq(customers.id, recallContacts.customerId))
    .leftJoin(dealers, eq(dealers.id, recallContacts.dealerId))
    .where(eq(recallContacts.recallId, id))
    .orderBy(asc(orders.code));
  const items =
    lotIds.length && contactRows.length
      ? await x
          .select({ id: orderItems.id, orderId: orderItems.orderId, qty: orderItems.quantity, lotNo: lots.lotNo, productName: products.name })
          .from(orderItems)
          .innerJoin(lots, eq(lots.id, orderItems.lotId))
          .innerJoin(products, eq(products.id, lots.productId))
          .where(and(inArray(orderItems.lotId, lotIds), inArray(orderItems.orderId, contactRows.map((c) => c.orderId))))
      : [];
  const contacts = contactRows.map((c) => ({
    ...c,
    name: c.customerName ?? c.recipientName,
    phone: showPhone ? c.phone : maskPhone(c.phone),
    dealer: c.dealerCode ? `${c.dealerCode} ${c.dealerName ?? ""}`.trim() : "",
    items: items.filter((i) => i.orderId === c.orderId),
    qty: items.filter((i) => i.orderId === c.orderId).reduce((s, i) => s + i.qty, 0),
  }));
  const [ncr] = r.ncrId ? await x.select({ id: ncrs.id, code: ncrs.code }).from(ncrs).where(eq(ncrs.id, r.ncrId)) : [];
  return { recall: r, contacts, ncr: ncr ?? null };
}

// ---------------------------------------------------------------------------------------------
// Lô thành phẩm (thêm cho /admin/lo/[id])

export async function lotQualityExtras(lotId: string, db?: Db) {
  const x = await d(db);
  const [fqc, samples, lotNcrs, trial] = await Promise.all([
    x.select({ id: qcInspections.id, code: qcInspections.code, stage: qcInspections.stage, status: qcInspections.status }).from(qcInspections).where(eq(qcInspections.lotId, lotId)).orderBy(desc(qcInspections.createdAt)),
    x.select().from(retainedSamples).where(eq(retainedSamples.lotId, lotId)),
    x.select({ id: ncrs.id, code: ncrs.code, status: ncrs.status, title: ncrs.title }).from(ncrs).where(eq(ncrs.lotId, lotId)).orderBy(desc(ncrs.createdAt)),
    x
      .select({ status: formulaVersions.status })
      .from(productionOrders)
      .innerJoin(formulaVersions, eq(formulaVersions.id, productionOrders.formulaVersionId))
      .where(and(eq(productionOrders.lotId, lotId), eq(formulaVersions.status, "trial")))
      .limit(1),
  ]);
  return { inspections: fqc, samples, ncrs: lotNcrs, trialFormula: trial.length > 0 };
}

// NCR/CAPA/phiếu kiểm lại đã gắn phản ánh, kèm lô của phản ánh (cho /admin/phan-anh)
export type ComplaintLink = { lotId: string | null; ncrs: { id: string; code: string }[]; capas: { id: string; code: string }[]; rechecks: { id: string; code: string }[] };

export async function complaintLinks(complaintIds: string[], db?: Db) {
  const map = new Map<string, ComplaintLink>();
  if (complaintIds.length === 0) return map;
  const x = await d(db);
  const [cs, n, c, r] = await Promise.all([
    x.select({ id: complaints.id, lotId: complaints.lotId }).from(complaints).where(inArray(complaints.id, complaintIds)),
    x.select({ id: ncrs.id, code: ncrs.code, complaintId: ncrs.complaintId }).from(ncrs).where(and(inArray(ncrs.complaintId, complaintIds), ne(ncrs.status, "cancelled"))),
    x.select({ id: capas.id, code: capas.code, complaintId: capas.complaintId }).from(capas).where(and(inArray(capas.complaintId, complaintIds), ne(capas.status, "cancelled"))),
    x
      .select({ id: qcInspections.id, code: qcInspections.code, complaintId: qcInspections.complaintId })
      .from(qcInspections)
      .where(and(inArray(qcInspections.complaintId, complaintIds), or(eq(qcInspections.status, "pending"), eq(qcInspections.status, "passed"), eq(qcInspections.status, "failed")))),
  ]);
  for (const id of complaintIds) map.set(id, { lotId: null, ncrs: [], capas: [], rechecks: [] });
  for (const row of cs) {
    const m = map.get(row.id);
    if (m) m.lotId = row.lotId;
  }
  for (const row of n) map.get(row.complaintId!)?.ncrs.push({ id: row.id, code: row.code });
  for (const row of c) map.get(row.complaintId!)?.capas.push({ id: row.id, code: row.code });
  for (const row of r) map.get(row.complaintId!)?.rechecks.push({ id: row.id, code: row.code });
  return map;
}

// Danh sách hàng và sản phẩm cho form tiêu chuẩn
export async function standardTargets(db?: Db) {
  const x = await d(db);
  const [items, prods] = await Promise.all([
    x.select({ id: inventoryItems.id, code: inventoryItems.code, name: inventoryItems.name, kind: inventoryItems.kind }).from(inventoryItems).orderBy(asc(inventoryItems.code)),
    x.select({ id: products.id, name: products.name }).from(products).orderBy(asc(products.name)),
  ]);
  return { items, products: prods };
}



export async function stockLotBrief(id: string, db?: Db) {
  const x = await d(db);
  const [s] = await x.select({ id: stockLots.id, code: stockLots.code, qcStatus: stockLots.qcStatus, holdReason: stockLots.holdReason }).from(stockLots).where(eq(stockLots.id, id));
  return s ?? null;
}
