// Lệnh sản xuất tự làm và gia công (02-san-xuat.md R-SX-15…R-SX-22, R-SX-26, R-SX-27, R-SX-29).
// Mọi hàm ghi nhận tx của người gọi; kiểm quyền bằng assertCan (Server Action đã kiểm requirePermission).
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db/client";
import {
  auditLog,
  formulas,
  formulaVersions,
  inventoryItems,
  lots,
  productionOrderMaterials,
  productionOrders,
  productionOrderSteps,
  productionPlanLines,
  products,
  qcInspections,
  stockBalances,
  stockLots,
  stockMovements,
  suppliers,
  warehouses,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { adjustDebtAmount, findDebtBySource, openPayable } from "@/modules/finance/ledger";
import { ensureFinishedItem, getItemStock, postIssue, postReceipt } from "@/modules/inventory/ledger";
import { addDays, costOfQty, formatQty, type BaseUom, type DisplayUom } from "@/modules/inventory/rules";
import { vnToday } from "@/modules/numbering/rules";
import { nextDocCode } from "@/modules/numbering/service";
import { createInspection, hasBlockingDeviation } from "@/modules/qms/inspections";
import { lockProductionCost, recalcProductionCost } from "./costing";
import { assertCan, readErpSettings, STALE, type Actor } from "./access";
import { currentVersionOfProduct, loadVersionForCalc } from "./formulas";
import {
  batchesFor,
  buildOrderMaterials,
  bulkForUnits,
  cancelPermission,
  checkCustomLotNo,
  checkFinishStep,
  checkIssue,
  checkOrderReady,
  checkReturn,
  checkStartStep,
  DEFAULT_STEPS,
  DEVIATION_BLOCK,
  nextLotNo,
  ORDER_STATUS_LABEL,
  plannedCostOf,
  qcResultFromLot,
  resolveOutput,
  shortageOf,
  type FormulaLineWithItem,
  type ItemLite,
  type MaterialSource,
  type ProductionKind,
  type ProductionStatus,
} from "./rules";

export const COST_LOCKED = "Giá vốn lệnh đã chốt";

type OrderRow = typeof productionOrders.$inferSelect;

async function lockOrder(tx: Tx, orderId: string): Promise<OrderRow> {
  const [o] = await tx.select().from(productionOrders).where(eq(productionOrders.id, orderId)).for("update").limit(1);
  if (!o) throw new UserError("Không tìm thấy lệnh sản xuất");
  return o;
}

// Đổi trạng thái có điều kiện (R-CHUNG-9)
async function moveStatus(tx: Tx, o: OrderRow, to: ProductionStatus, extra: Partial<typeof productionOrders.$inferInsert>, actor: Actor, after: Record<string, unknown> = {}) {
  const [row] = await tx
    .update(productionOrders)
    .set({ status: to, updatedAt: new Date(), ...extra })
    .where(and(eq(productionOrders.id, o.id), eq(productionOrders.status, o.status)))
    .returning({ id: productionOrders.id });
  if (!row) throw new UserError(STALE);
  await writeAudit(tx, { actorId: actor.id, action: `production_order.${to}`, entity: "production_orders", entityId: o.id, before: { status: o.status }, after: { status: to, code: o.code, ...after } });
}

// ---------------------------------------------------------------------------------------------
// Tạo, sửa (R-SX-15)

export type OrderInput = {
  kind: ProductionKind;
  productId: string;
  formulaVersionId: string | null;
  formulaLabel: string | null;
  supplierId: string | null;
  outsourcingUnitPrice: number | null;
  plannedUnits: number;
  plannedBulk?: number | null;
  batchCount?: number | null;
  responsibleId?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  planLineId?: string | null;
  note?: string | null;
};

function checkBasic(input: OrderInput) {
  if (input.kind !== "in_house" && input.kind !== "outsourced") throw new UserError("Chọn loại lệnh");
  if (!Number.isInteger(input.plannedUnits) || input.plannedUnits <= 0 || input.plannedUnits > 10_000_000) throw new UserError("Số chai kế hoạch phải lớn hơn 0");
  if (input.outsourcingUnitPrice !== null && (!Number.isInteger(input.outsourcingUnitPrice) || input.outsourcingUnitPrice < 0)) throw new UserError("Đơn giá gia công không hợp lệ");
  if (input.plannedStart && input.plannedEnd && input.plannedEnd < input.plannedStart) throw new UserError("Ngày kết thúc phải sau ngày bắt đầu");
}

// Gợi ý lượng mẻ, số mẻ theo R-SX-12 (không đủ dữ liệu thì để trống)
async function suggestBulk(db: Db | Tx, productId: string, versionId: string | null, units: number): Promise<{ plannedBulk: number | null; batchCount: number | null }> {
  if (!versionId) return { plannedBulk: null, batchCount: null };
  const [p] = await db.select({ netQty: products.netQty, netUom: products.netUom }).from(products).where(eq(products.id, productId)).limit(1);
  const [v] = await db.select().from(formulaVersions).where(eq(formulaVersions.id, versionId)).limit(1);
  if (!p || !v) return { plannedBulk: null, batchCount: null };
  const r = bulkForUnits({ targetUnits: units, netQty: p.netQty, netUom: p.netUom, batchUom: v.batchUom, bulkDensityMgPerMl: v.bulkDensityMgPerMl, expectedYieldBp: v.expectedYieldBp });
  if (!r.ok) return { plannedBulk: null, batchCount: null };
  return { plannedBulk: r.bulk, batchCount: batchesFor(r.bulk, v.batchSize) };
}

export async function createOrder(tx: Tx, actor: Actor, input: OrderInput): Promise<{ id: string; code: string }> {
  assertCan(actor, "production.write");
  checkBasic(input);
  const [p] = await tx.select({ id: products.id }).from(products).where(eq(products.id, input.productId)).limit(1);
  if (!p) throw new UserError("Không tìm thấy sản phẩm");
  const suggest = input.plannedBulk ? { plannedBulk: input.plannedBulk, batchCount: input.batchCount ?? null } : await suggestBulk(tx, input.productId, input.formulaVersionId, input.plannedUnits);
  const code = await nextDocCode(tx, "LSX");
  const [row] = await tx
    .insert(productionOrders)
    .values({
      code,
      kind: input.kind,
      productId: input.productId,
      formulaVersionId: input.formulaVersionId,
      formulaLabel: input.formulaLabel?.trim() || null,
      supplierId: input.supplierId,
      outsourcingUnitPrice: input.outsourcingUnitPrice,
      plannedUnits: input.plannedUnits,
      plannedBulk: suggest.plannedBulk,
      batchCount: input.batchCount ?? suggest.batchCount,
      responsibleId: input.responsibleId ?? null,
      plannedStart: input.plannedStart ?? null,
      plannedEnd: input.plannedEnd ?? null,
      planLineId: input.planLineId ?? null,
      note: input.note?.trim() || null,
      createdBy: actor.id,
    })
    .returning({ id: productionOrders.id });
  await writeAudit(tx, { actorId: actor.id, action: "production_order.created", entity: "production_orders", entityId: row!.id, after: { code, kind: input.kind, plannedUnits: input.plannedUnits } });
  return { id: row!.id, code };
}

// Tạo lệnh từ dòng kế hoạch: chép sản phẩm, phiên bản, số chai (R-SX-15)
export async function createOrderFromPlanLine(tx: Tx, actor: Actor, planLineId: string, input: { kind: ProductionKind; supplierId: string | null; outsourcingUnitPrice: number | null }) {
  assertCan(actor, "production.write");
  const [line] = await tx.select().from(productionPlanLines).where(eq(productionPlanLines.id, planLineId)).limit(1);
  if (!line) throw new UserError("Không tìm thấy dòng kế hoạch");
  const versionId = line.formulaVersionId ?? (await currentVersionOfProduct(tx, line.productId));
  return createOrder(tx, actor, {
    kind: input.kind,
    productId: line.productId,
    formulaVersionId: versionId,
    formulaLabel: null,
    supplierId: input.supplierId,
    outsourcingUnitPrice: input.outsourcingUnitPrice,
    plannedUnits: line.targetUnits,
    plannedStart: line.plannedStart,
    planLineId: line.id,
  });
}

// Sửa trước khi duyệt; còn planned thì sinh lại định mức (R-SX-17)
export async function updateOrder(tx: Tx, actor: Actor, orderId: string, input: OrderInput): Promise<void> {
  assertCan(actor, "production.write");
  checkBasic(input);
  const o = await lockOrder(tx, orderId);
  if (o.status !== "draft" && o.status !== "planned") throw new UserError("Chỉ sửa lệnh khi còn nháp hoặc đã lên kế hoạch");
  const changedBase = o.plannedUnits !== input.plannedUnits || o.formulaVersionId !== input.formulaVersionId || o.productId !== input.productId;
  let plannedBulk = input.plannedBulk ?? null;
  let batchCount = input.batchCount ?? null;
  if (changedBase && !input.plannedBulk) {
    const s = await suggestBulk(tx, input.productId, input.formulaVersionId, input.plannedUnits);
    plannedBulk = s.plannedBulk;
    batchCount = s.batchCount;
  } else if (!plannedBulk) {
    plannedBulk = o.plannedBulk;
    batchCount = batchCount ?? o.batchCount;
  }
  await tx
    .update(productionOrders)
    .set({
      kind: input.kind,
      productId: input.productId,
      formulaVersionId: input.formulaVersionId,
      formulaLabel: input.formulaLabel?.trim() || null,
      supplierId: input.supplierId,
      outsourcingUnitPrice: input.outsourcingUnitPrice,
      plannedUnits: input.plannedUnits,
      plannedBulk,
      batchCount,
      responsibleId: input.responsibleId ?? null,
      plannedStart: input.plannedStart ?? null,
      plannedEnd: input.plannedEnd ?? null,
      note: input.note?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(productionOrders.id, orderId));
  if (o.status === "planned" && (changedBase || o.kind !== input.kind || plannedBulk !== o.plannedBulk)) {
    const fresh = await lockOrder(tx, orderId);
    const check = await readinessOf(tx, fresh);
    if (check) throw new UserError(check);
    await regenerateMaterials(tx, fresh);
  }
  await writeAudit(tx, {
    actorId: actor.id,
    action: "production_order.updated",
    entity: "production_orders",
    entityId: orderId,
    before: { plannedUnits: o.plannedUnits, formulaVersionId: o.formulaVersionId, outsourcingUnitPrice: o.outsourcingUnitPrice },
    after: { plannedUnits: input.plannedUnits, formulaVersionId: input.formulaVersionId, outsourcingUnitPrice: input.outsourcingUnitPrice },
  });
}

async function readinessOf(tx: Tx, o: OrderRow): Promise<string | null> {
  let versionStatus = null;
  if (o.formulaVersionId) {
    const [v] = await tx.select({ status: formulaVersions.status }).from(formulaVersions).where(eq(formulaVersions.id, o.formulaVersionId)).limit(1);
    if (!v) return "Không tìm thấy phiên bản công thức";
    versionStatus = v.status;
  }
  let supplierKind: string | null = null;
  if (o.supplierId) {
    const [s] = await tx.select({ kind: suppliers.kind }).from(suppliers).where(eq(suppliers.id, o.supplierId)).limit(1);
    supplierKind = s?.kind ?? null;
  }
  return checkOrderReady({ kind: o.kind, productId: o.productId, plannedUnits: o.plannedUnits, versionStatus, formulaLabel: o.formulaLabel, supplierId: o.supplierId, supplierKind });
}

// Sinh định mức từ công thức (R-SX-17). Gia công giữ đánh dấu "Pomil cấp" của dòng cũ cùng hàng.
async function regenerateMaterials(tx: Tx, o: OrderRow): Promise<void> {
  const old = await tx.select().from(productionOrderMaterials).where(eq(productionOrderMaterials.productionOrderId, o.id));
  const manual = old.filter((m) => m.role === "extra" || (!o.formulaVersionId && m.role !== "extra"));
  if (!o.formulaVersionId) return; // Gia công không có công thức: chỉ dòng tay
  const v = await loadVersionForCalc(tx, o.formulaVersionId);
  if (!v) throw new UserError("Không tìm thấy phiên bản công thức");
  const lines: FormulaLineWithItem[] = v.lines.map((l) => ({
    ppm: l.ppm,
    isBalance: l.isBalance,
    sort: l.sort,
    item: { id: l.itemId, code: l.itemCode, kind: l.itemKind, baseUom: l.baseUom as BaseUom, densityMgPerMl: l.densityMgPerMl } satisfies ItemLite,
  }));
  const built = buildOrderMaterials({
    kind: o.kind,
    plannedUnits: o.plannedUnits,
    plannedBulk: o.plannedBulk,
    batchUom: v.batchUom as BaseUom,
    lines,
    packaging: v.packaging.map((p) => ({ itemId: p.itemId, qtyPerUnit: p.qtyPerUnit })),
  });
  if (!built.ok) throw new UserError(built.message);
  const prevSource = new Map(old.map((m) => [m.itemId, m.suppliedBy]));
  await tx.delete(productionOrderMaterials).where(and(eq(productionOrderMaterials.productionOrderId, o.id), ne(productionOrderMaterials.role, "extra")));
  const keepIds = new Set(manual.filter((m) => m.role === "extra").map((m) => m.itemId));
  const rows = built.materials
    .filter((m) => !keepIds.has(m.itemId))
    .map((m) => ({
      productionOrderId: o.id,
      itemId: m.itemId,
      role: m.role,
      plannedQty: m.plannedQty,
      suppliedBy: (o.kind === "outsourced" ? (prevSource.get(m.itemId) ?? m.suppliedBy) : "pomil") as MaterialSource,
      sort: m.sort,
    }));
  if (rows.length) await tx.insert(productionOrderMaterials).values(rows);
}

async function ensureDefaultSteps(tx: Tx, o: OrderRow): Promise<void> {
  const [has] = await tx.select({ id: productionOrderSteps.id }).from(productionOrderSteps).where(eq(productionOrderSteps.productionOrderId, o.id)).limit(1);
  if (has) return;
  await tx.insert(productionOrderSteps).values(DEFAULT_STEPS[o.kind].map((s, i) => ({ productionOrderId: o.id, seq: i + 1, name: s.name, needsQc: s.needsQc })));
}

// ---------------------------------------------------------------------------------------------
// Chuyển trạng thái

export async function planOrder(tx: Tx, actor: Actor, orderId: string): Promise<void> {
  assertCan(actor, "production.write");
  const o = await lockOrder(tx, orderId);
  if (o.status !== "draft") throw new UserError(STALE);
  const problem = await readinessOf(tx, o);
  if (problem) throw new UserError(problem);
  await regenerateMaterials(tx, o);
  await ensureDefaultSteps(tx, o);
  await moveStatus(tx, o, "planned", {}, actor);
}

export async function unplanOrder(tx: Tx, actor: Actor, orderId: string): Promise<void> {
  assertCan(actor, "production.write");
  const o = await lockOrder(tx, orderId);
  if (o.status !== "planned") throw new UserError(STALE);
  await moveStatus(tx, o, "draft", {}, actor);
}

async function materialRows(db: Db | Tx, orderId: string) {
  return db
    .select({
      id: productionOrderMaterials.id,
      itemId: productionOrderMaterials.itemId,
      role: productionOrderMaterials.role,
      plannedQty: productionOrderMaterials.plannedQty,
      suppliedBy: productionOrderMaterials.suppliedBy,
      note: productionOrderMaterials.note,
      sort: productionOrderMaterials.sort,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      itemKind: inventoryItems.kind,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
      refUnitPrice: inventoryItems.refUnitPrice,
      purchaseUom: inventoryItems.purchaseUom,
    })
    .from(productionOrderMaterials)
    .innerJoin(inventoryItems, eq(inventoryItems.id, productionOrderMaterials.itemId))
    .where(eq(productionOrderMaterials.productionOrderId, orderId))
    .orderBy(asc(productionOrderMaterials.sort), asc(inventoryItems.code));
}

// Cảnh báo thiếu NVL cho các dòng Pomil cấp (R-SX-13), không chặn
export async function orderShortages(db: Db | Tx, orderId: string): Promise<{ itemCode: string; shortage: number; text: string }[]> {
  const mats = (await materialRows(db, orderId)).filter((m) => m.suppliedBy === "pomil" && m.plannedQty > 0);
  if (mats.length === 0) return [];
  const net = await netIssuedByItem(db, orderId);
  const stock = await getItemStock(db, mats.map((m) => m.itemId));
  const [o] = await db.select({ status: productionOrders.status }).from(productionOrders).where(eq(productionOrders.id, orderId)).limit(1);
  const out: { itemCode: string; shortage: number; text: string }[] = [];
  for (const m of mats) {
    const s = stock.get(m.itemId)!;
    const remaining = Math.max(0, m.plannedQty - (net.get(m.itemId) ?? 0));
    // Lệnh đã duyệt thì "đã cam kết" có cả phần của chính lệnh này: trừ ra
    const committedOthers = o && (o.status === "approved" || o.status === "in_progress") ? Math.max(0, s.committed - remaining) : s.committed;
    const shortage = shortageOf(remaining, s.available, committedOthers);
    if (shortage > 0) out.push({ itemCode: m.itemCode, shortage, text: `${m.itemCode} thiếu ${formatQty(shortage, m.baseUom as BaseUom, m.displayUom as DisplayUom)}` });
  }
  return out;
}

// planned → approved: production.approve; chụp giá thành kế hoạch (R-SX-27)
export async function approveOrder(tx: Tx, actor: Actor, orderId: string): Promise<{ plannedCost: number; missingPrice: string[]; shortages: string[] }> {
  assertCan(actor, "production.approve");
  const o = await lockOrder(tx, orderId);
  if (o.status !== "planned") throw new UserError(STALE);
  const problem = await readinessOf(tx, o);
  if (problem) throw new UserError(problem);
  const mats = await materialRows(tx, orderId);
  if (o.kind === "in_house" && mats.length === 0) throw new UserError("Định mức vật tư chưa có dòng nào");
  const pc = plannedCostOf({
    kind: o.kind,
    plannedUnits: o.plannedUnits,
    outsourcingUnitPrice: o.outsourcingUnitPrice,
    labor: o.laborCost,
    overhead: o.overheadCost,
    materials: mats.map((m) => ({ itemCode: m.itemCode, plannedQty: m.plannedQty, suppliedBy: m.suppliedBy, refUnitPrice: m.refUnitPrice, purchaseUom: m.purchaseUom })),
  });
  const shortages = (await orderShortages(tx, orderId)).map((s) => s.text);
  await moveStatus(tx, o, "approved", { plannedCost: pc.total, approvedBy: actor.id, approvedAt: new Date() }, actor, { plannedCost: pc.total, missingPrice: pc.missing, shortages });
  return { plannedCost: pc.total, missingPrice: pc.missing, shortages };
}

export async function startOrder(tx: Tx, actor: Actor, orderId: string): Promise<void> {
  assertCan(actor, "production.write");
  const o = await lockOrder(tx, orderId);
  if (o.status !== "approved") throw new UserError(STALE);
  await moveStatus(tx, o, "in_progress", { startedAt: new Date() }, actor);
}

// ---------------------------------------------------------------------------------------------
// Định mức: dòng tay, nguồn cấp (R-SX-17)

export async function addMaterialLine(tx: Tx, actor: Actor, orderId: string, input: { itemId: string; plannedQty: number; note?: string | null }): Promise<void> {
  assertCan(actor, "production.write");
  const o = await lockOrder(tx, orderId);
  const [item] = await tx.select({ id: inventoryItems.id, code: inventoryItems.code, kind: inventoryItems.kind }).from(inventoryItems).where(eq(inventoryItems.id, input.itemId)).limit(1);
  if (!item) throw new UserError("Không tìm thấy hàng hóa");
  if (item.kind === "finished") throw new UserError("Không xuất thành phẩm cho lệnh sản xuất");
  const [dup] = await tx
    .select({ id: productionOrderMaterials.id })
    .from(productionOrderMaterials)
    .where(and(eq(productionOrderMaterials.productionOrderId, orderId), eq(productionOrderMaterials.itemId, item.id)))
    .limit(1);
  if (dup) throw new UserError(`Hàng ${item.code} đã có trong định mức`);
  let role: string;
  let plannedQty: number;
  if (o.status === "draft" || o.status === "planned") {
    if (!Number.isSafeInteger(input.plannedQty) || input.plannedQty <= 0) throw new UserError("Lượng kế hoạch phải lớn hơn 0");
    role = item.kind === "packaging" ? "packaging" : "formula";
    plannedQty = input.plannedQty;
  } else if (o.status === "approved" || o.status === "in_progress") {
    // Sau duyệt: chỉ thêm dòng phát sinh (kế hoạch 0), ghi lý do
    if (!input.note?.trim()) throw new UserError("Ghi lý do thêm dòng phát sinh");
    role = "extra";
    plannedQty = 0;
  } else throw new UserError("Lệnh đã ghi sản lượng hoặc đã hủy, không thêm định mức");
  const [m] = await tx.select({ m: sql<number>`coalesce(max(${productionOrderMaterials.sort}), 0)::int` }).from(productionOrderMaterials).where(eq(productionOrderMaterials.productionOrderId, orderId));
  await tx.insert(productionOrderMaterials).values({
    productionOrderId: orderId,
    itemId: item.id,
    role,
    plannedQty,
    suppliedBy: o.kind === "outsourced" && role !== "extra" ? "factory" : "pomil",
    note: input.note?.trim() || null,
    sort: Number(m?.m ?? 0) + 1,
  });
  await writeAudit(tx, { actorId: actor.id, action: "production_order.material_added", entity: "production_orders", entityId: orderId, after: { item: item.code, role, plannedQty, note: input.note ?? null } });
}

export async function removeMaterialLine(tx: Tx, actor: Actor, materialId: string): Promise<void> {
  assertCan(actor, "production.write");
  const [m] = await tx.select().from(productionOrderMaterials).where(eq(productionOrderMaterials.id, materialId)).limit(1);
  if (!m) throw new UserError("Không tìm thấy dòng định mức");
  const o = await lockOrder(tx, m.productionOrderId);
  if (o.status !== "draft" && o.status !== "planned") throw new UserError("Sau khi duyệt không sửa dòng định mức cũ");
  await tx.delete(productionOrderMaterials).where(eq(productionOrderMaterials.id, materialId));
  await writeAudit(tx, { actorId: actor.id, action: "production_order.material_removed", entity: "production_orders", entityId: o.id, before: { itemId: m.itemId, plannedQty: m.plannedQty } });
}

export async function setMaterialSource(tx: Tx, actor: Actor, materialId: string, suppliedBy: MaterialSource): Promise<void> {
  assertCan(actor, "production.write");
  const [m] = await tx.select().from(productionOrderMaterials).where(eq(productionOrderMaterials.id, materialId)).limit(1);
  if (!m) throw new UserError("Không tìm thấy dòng định mức");
  const o = await lockOrder(tx, m.productionOrderId);
  if (o.kind !== "outsourced") throw new UserError("Lệnh tự làm: Pomil cấp mọi vật tư");
  if (o.status !== "draft" && o.status !== "planned") throw new UserError("Sau khi duyệt không đổi nguồn cấp");
  await tx.update(productionOrderMaterials).set({ suppliedBy }).where(eq(productionOrderMaterials.id, materialId));
  await writeAudit(tx, { actorId: actor.id, action: "production_order.material_source", entity: "production_orders", entityId: o.id, before: { suppliedBy: m.suppliedBy }, after: { itemId: m.itemId, suppliedBy } });
}

// ---------------------------------------------------------------------------------------------
// Xuất / trả NVL (R-SX-18)

const ISSUE_TYPES = ["production_issue", "production_return"] as const;

// Xuất ròng theo lô của lệnh (gồm dòng đảo): dương = đã dùng
export async function netIssuedByLot(db: Db | Tx, orderId: string) {
  const original = alias(stockMovements, "original");
  const rows = await db
    .select({
      stockLotId: stockMovements.stockLotId,
      itemId: stockMovements.itemId,
      sumQty: sql<string>`sum(${stockMovements.qty})`,
      lotCode: stockLots.code,
      receivedQty: stockLots.receivedQty,
      receivedCost: stockLots.receivedCost,
    })
    .from(stockMovements)
    .leftJoin(original, eq(original.id, stockMovements.reversalOf))
    .innerJoin(stockLots, eq(stockLots.id, stockMovements.stockLotId))
    .where(
      or(
        and(eq(stockMovements.productionOrderId, orderId), inArray(stockMovements.type, [...ISSUE_TYPES])),
        and(eq(stockMovements.type, "reversal"), eq(original.productionOrderId, orderId), inArray(original.type, [...ISSUE_TYPES])),
      ),
    )
    .groupBy(stockMovements.stockLotId, stockMovements.itemId, stockLots.code, stockLots.receivedQty, stockLots.receivedCost);
  return rows
    .map((r) => {
      const net = -Number(r.sumQty);
      return { stockLotId: r.stockLotId, itemId: r.itemId, lotCode: r.lotCode, net, value: costOfQty(net, r.receivedQty, r.receivedCost) };
    })
    .filter((r) => r.net !== 0);
}

export async function netIssuedByItem(db: Db | Tx, orderId: string): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (const r of await netIssuedByLot(db, orderId)) m.set(r.itemId, (m.get(r.itemId) ?? 0) + r.net);
  return m;
}

export async function issueMaterial(
  tx: Tx,
  actor: Actor,
  orderId: string,
  input: { itemId: string; qty: number; stockLotId?: string | null; reason?: string | null },
): Promise<{ issueCode: string }> {
  assertCan(actor, "production.write");
  const o = await lockOrder(tx, orderId);
  const [m] = await tx
    .select()
    .from(productionOrderMaterials)
    .where(and(eq(productionOrderMaterials.productionOrderId, orderId), eq(productionOrderMaterials.itemId, input.itemId)))
    .limit(1);
  const net = (await netIssuedByItem(tx, orderId)).get(input.itemId) ?? 0;
  const settings = await readErpSettings(tx);
  const problem = checkIssue({ orderStatus: o.status, material: m ?? null, netIssued: net, qty: input.qty, overIssueWarnBp: settings.overIssueWarnBp, reason: input.reason ?? null });
  if (problem) throw new UserError(problem);
  const r = await postIssue(
    tx,
    {
      kind: "production",
      productionOrderId: orderId,
      purpose: `Xuất NVL cho ${o.code}`,
      note: input.reason?.trim() || null,
      lines: [{ itemId: input.itemId, qty: input.qty, stockLotId: input.stockLotId ?? null, note: input.reason?.trim() || null }],
    },
    actor.id,
  );
  if (o.status === "approved") await moveStatus(tx, o, "in_progress", { startedAt: new Date() }, actor, { by: "first_issue" });
  await recalcProductionCost(tx, orderId, actor.id);
  await writeAudit(tx, { actorId: actor.id, action: "production_order.material_issued", entity: "production_orders", entityId: orderId, after: { issue: r.code, itemId: input.itemId, qty: input.qty, reason: input.reason ?? null } });
  return { issueCode: r.code };
}

// Trả NVL thừa về đúng lô và vị trí đã xuất, phiếu nhập production_return gắn lệnh
export async function returnMaterial(tx: Tx, actor: Actor, orderId: string, input: { stockLotId: string; qty: number }): Promise<{ receiptCode: string }> {
  assertCan(actor, "production.write");
  const o = await lockOrder(tx, orderId);
  if (!["approved", "in_progress", "qc", "completed", "cancelled"].includes(o.status)) throw new UserError("Lệnh chưa xuất NVL");
  const lot = (await netIssuedByLot(tx, orderId)).find((r) => r.stockLotId === input.stockLotId);
  const problem = checkReturn(input.qty, lot?.net ?? 0, lot?.lotCode ?? "");
  if (problem) throw new UserError(problem);
  const [last] = await tx
    .select({ locationId: stockMovements.locationId, warehouseId: stockMovements.warehouseId })
    .from(stockMovements)
    .where(and(eq(stockMovements.productionOrderId, orderId), eq(stockMovements.stockLotId, input.stockLotId), eq(stockMovements.type, "production_issue")))
    .orderBy(desc(stockMovements.occurredAt))
    .limit(1);
  if (!last) throw new UserError("Không tìm thấy lần xuất của lô này");
  const r = await postReceipt(
    tx,
    {
      kind: "production_return",
      warehouseId: last.warehouseId,
      receivedOn: vnToday(),
      source: { type: "production_order", id: orderId },
      paymentMode: "none",
      note: `Trả NVL thừa của ${o.code}`,
      lines: [{ itemId: lot!.itemId, qty: input.qty, lineCost: 0, stockLotId: input.stockLotId, locationId: last.locationId, qcRequired: false }],
    },
    actor.id,
  );
  await recalcProductionCost(tx, orderId, actor.id);
  await writeAudit(tx, { actorId: actor.id, action: "production_order.material_returned", entity: "production_orders", entityId: orderId, after: { receipt: r.code, stockLotId: input.stockLotId, qty: input.qty } });
  return { receiptCode: r.code };
}

// ---------------------------------------------------------------------------------------------
// Công đoạn và IPQC (R-SX-22)

async function stepsOf(db: Db | Tx, orderId: string) {
  return db.select().from(productionOrderSteps).where(eq(productionOrderSteps.productionOrderId, orderId)).orderBy(asc(productionOrderSteps.seq));
}

async function latestIpqc(db: Db | Tx, stepId: string) {
  const [row] = await db
    .select({ id: qcInspections.id, code: qcInspections.code, status: qcInspections.status })
    .from(qcInspections)
    .where(and(eq(qcInspections.productionStepId, stepId), eq(qcInspections.stage, "ipqc"), ne(qcInspections.status, "cancelled")))
    .orderBy(desc(qcInspections.createdAt))
    .limit(1);
  return row ?? null;
}

export async function addStep(tx: Tx, actor: Actor, orderId: string, input: { name: string; needsQc: boolean }): Promise<void> {
  assertCan(actor, "production.write");
  const o = await lockOrder(tx, orderId);
  if (o.status !== "draft" && o.status !== "planned") throw new UserError("Chỉ sửa công đoạn trước khi duyệt lệnh");
  const name = input.name.trim();
  if (!name) throw new UserError("Nhập tên công đoạn");
  const steps = await stepsOf(tx, orderId);
  await tx.insert(productionOrderSteps).values({ productionOrderId: orderId, seq: (steps.at(-1)?.seq ?? 0) + 1, name, needsQc: input.needsQc });
  await writeAudit(tx, { actorId: actor.id, action: "production_order.step_added", entity: "production_orders", entityId: orderId, after: { name, needsQc: input.needsQc } });
}

export async function removeStep(tx: Tx, actor: Actor, stepId: string): Promise<void> {
  assertCan(actor, "production.write");
  const [s] = await tx.select().from(productionOrderSteps).where(eq(productionOrderSteps.id, stepId)).limit(1);
  if (!s) throw new UserError("Không tìm thấy công đoạn");
  const o = await lockOrder(tx, s.productionOrderId);
  if (o.status !== "draft" && o.status !== "planned") throw new UserError("Chỉ sửa công đoạn trước khi duyệt lệnh");
  await tx.delete(productionOrderSteps).where(eq(productionOrderSteps.id, stepId));
  // Đánh số lại liền mạch: dời các công đoạn sau lên một bậc (đi từ nhỏ đến lớn để không trùng khóa)
  const later = (await stepsOf(tx, o.id)).filter((x) => x.seq > s.seq);
  for (const x of later) await tx.update(productionOrderSteps).set({ seq: x.seq - 1 }).where(eq(productionOrderSteps.id, x.id));
  await writeAudit(tx, { actorId: actor.id, action: "production_order.step_removed", entity: "production_orders", entityId: o.id, before: { name: s.name, seq: s.seq } });
}

export async function startStep(tx: Tx, actor: Actor, stepId: string): Promise<void> {
  assertCan(actor, "production.write");
  const [s] = await tx.select().from(productionOrderSteps).where(eq(productionOrderSteps.id, stepId)).limit(1);
  if (!s) throw new UserError("Không tìm thấy công đoạn");
  const o = await lockOrder(tx, s.productionOrderId);
  if (o.status !== "approved" && o.status !== "in_progress") throw new UserError("Lệnh chưa duyệt hoặc đã ghi sản lượng");
  const blocked = await hasBlockingDeviation(tx, { productionOrderId: o.id });
  const problem = checkStartStep(await stepsOf(tx, o.id), s.seq, blocked);
  if (problem) throw new UserError(problem);
  const [row] = await tx
    .update(productionOrderSteps)
    .set({ status: "in_progress", startedAt: new Date(), operatorId: actor.id })
    .where(and(eq(productionOrderSteps.id, stepId), eq(productionOrderSteps.status, "pending")))
    .returning({ id: productionOrderSteps.id });
  if (!row) throw new UserError(STALE);
  if (o.status === "approved") await moveStatus(tx, o, "in_progress", { startedAt: new Date() }, actor, { by: "first_step" });
  // Công đoạn cần QC: lập phiếu IPQC chờ ngay khi bắt đầu
  if (s.needsQc) await createInspection(tx, { stage: "ipqc", productionOrderId: o.id, productionStepId: s.id }, actor.id);
  await writeAudit(tx, { actorId: actor.id, action: "production_step.started", entity: "production_order_steps", entityId: stepId, after: { order: o.code, seq: s.seq, name: s.name } });
}

// Lập lại phiếu IPQC (sau khi phiếu trước không đạt và đã khắc phục)
export async function requestStepIpqc(tx: Tx, actor: Actor, stepId: string): Promise<{ code: string }> {
  assertCan(actor, "production.write");
  const [s] = await tx.select().from(productionOrderSteps).where(eq(productionOrderSteps.id, stepId)).limit(1);
  if (!s) throw new UserError("Không tìm thấy công đoạn");
  if (!s.needsQc) throw new UserError("Công đoạn này không cần IPQC");
  if (s.status !== "in_progress") throw new UserError("Công đoạn chưa bắt đầu");
  const r = await createInspection(tx, { stage: "ipqc", productionOrderId: s.productionOrderId, productionStepId: s.id }, actor.id);
  return { code: r.code };
}

export async function finishStep(tx: Tx, actor: Actor, stepId: string, note?: string | null): Promise<void> {
  assertCan(actor, "production.write");
  const [s] = await tx.select().from(productionOrderSteps).where(eq(productionOrderSteps.id, stepId)).limit(1);
  if (!s) throw new UserError("Không tìm thấy công đoạn");
  const ipqc = s.needsQc ? await latestIpqc(tx, s.id) : null;
  const problem = checkFinishStep(s, ipqc?.status ?? null);
  if (problem) throw new UserError(problem);
  const [row] = await tx
    .update(productionOrderSteps)
    .set({ status: "done", finishedAt: new Date(), note: note?.trim() || s.note })
    .where(and(eq(productionOrderSteps.id, stepId), eq(productionOrderSteps.status, "in_progress")))
    .returning({ id: productionOrderSteps.id });
  if (!row) throw new UserError(STALE);
  await writeAudit(tx, { actorId: actor.id, action: "production_step.done", entity: "production_order_steps", entityId: stepId, after: { seq: s.seq, ipqc: ipqc?.code ?? null } });
}

export async function skipStep(tx: Tx, actor: Actor, stepId: string, note: string): Promise<void> {
  assertCan(actor, "production.write");
  if (!note.trim()) throw new UserError("Ghi lý do bỏ qua công đoạn");
  const [row] = await tx
    .update(productionOrderSteps)
    .set({ status: "skipped", note: note.trim(), finishedAt: new Date() })
    .where(and(eq(productionOrderSteps.id, stepId), eq(productionOrderSteps.status, "pending")))
    .returning({ id: productionOrderSteps.id, seq: productionOrderSteps.seq });
  if (!row) throw new UserError("Chỉ bỏ qua công đoạn chưa bắt đầu");
  await writeAudit(tx, { actorId: actor.id, action: "production_step.skipped", entity: "production_order_steps", entityId: stepId, after: { seq: row.seq, note: note.trim() } });
}

// ---------------------------------------------------------------------------------------------
// Ghi sản lượng (R-SX-19, R-SX-30)

export type RecordOutputInput = {
  goodUnits: number;
  rejectedUnits: number;
  manufacturedOn?: string | null;
  expiresOn?: string | null;
  actualBulk?: number | null;
  outsourcingCost?: number | null;
  lotNo?: string | null;
};

export async function recordOutput(tx: Tx, actor: Actor, orderId: string, input: RecordOutputInput, today: string = vnToday()): Promise<{ lotId: string; lotNo: string; fqcCode: string; payableCode: string | null; totalCost: number }> {
  assertCan(actor, "production.write");
  const o = await lockOrder(tx, orderId);
  if (o.status !== "in_progress") throw new UserError(o.status === "approved" ? "Bắt đầu lệnh trước khi ghi sản lượng" : STALE);
  if (await hasBlockingDeviation(tx, { productionOrderId: o.id })) throw new UserError(DEVIATION_BLOCK);
  const openQc = (await stepsOf(tx, o.id)).filter((s) => s.needsQc && s.status !== "done" && s.status !== "skipped");
  if (openQc.length) throw new UserError(`Công đoạn ${openQc[0]!.seq} (${openQc[0]!.name}) cần QC chưa xong`);

  const [p] = await tx.select().from(products).where(eq(products.id, o.productId)).limit(1);
  if (!p) throw new UserError("Không tìm thấy sản phẩm");
  const fgItemId = await ensureFinishedItem(tx, { id: p.id, code: p.code, name: p.name });
  const [fgItem] = await tx.select({ shelfLifeDays: inventoryItems.shelfLifeDays }).from(inventoryItems).where(eq(inventoryItems.id, fgItemId)).limit(1);
  const out = resolveOutput(
    {
      kind: o.kind,
      goodUnits: input.goodUnits,
      rejectedUnits: input.rejectedUnits,
      manufacturedOn: input.manufacturedOn ?? null,
      expiresOn: input.expiresOn ?? null,
      actualBulk: input.actualBulk ?? null,
      outsourcingUnitPrice: o.outsourcingUnitPrice,
      outsourcingCost: input.outsourcingCost ?? null,
    },
    today,
    fgItem?.shelfLifeDays ?? null,
  );
  if (!out.ok) throw new UserError(out.message);

  // 1. Số lô
  let lotNo: string;
  if (input.lotNo?.trim()) {
    lotNo = input.lotNo.trim().toUpperCase();
    const problem = checkCustomLotNo(lotNo, p.code);
    if (problem) throw new UserError(problem);
    const [dup] = await tx.select({ id: lots.id }).from(lots).where(eq(lots.lotNo, lotNo)).limit(1);
    if (dup) throw new UserError(`Số lô ${lotNo} đã có`);
  } else {
    const same = await tx.select({ lotNo: lots.lotNo }).from(lots).where(and(eq(lots.productId, p.id), eq(lots.manufacturedOn, out.manufacturedOn)));
    lotNo = nextLotNo(p.code, out.manufacturedOn, same.map((r) => r.lotNo));
    const [dup] = await tx.select({ id: lots.id }).from(lots).where(eq(lots.lotNo, lotNo)).limit(1);
    if (dup) throw new UserError(`Số lô ${lotNo} đã có, nhập số lô khác`);
  }

  // 2. Lô thành phẩm cách ly
  let label = o.formulaLabel?.trim() || "";
  if (o.formulaVersionId) {
    const [v] = await tx.select({ label: formulaVersions.label }).from(formulaVersions).where(eq(formulaVersions.id, o.formulaVersionId)).limit(1);
    label = v?.label ?? label;
  }
  let factory = "Pomil";
  let supplier: typeof suppliers.$inferSelect | undefined;
  if (o.kind === "outsourced" && o.supplierId) {
    [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, o.supplierId)).limit(1);
    factory = supplier?.name ?? factory;
  }
  const [lot] = await tx
    .insert(lots)
    .values({ lotNo, productId: p.id, formulaVersion: label || "—", factory, manufacturedOn: out.manufacturedOn, expiresOn: out.expiresOn, unitsProduced: input.goodUnits })
    .returning({ id: lots.id });
  await writeAudit(tx, { actorId: actor.id, action: "lot.created", entity: "lots", entityId: lot!.id, after: { lotNo, productionOrder: o.code, units: input.goodUnits } });
  await tx
    .update(productionOrders)
    .set({
      lotId: lot!.id,
      goodUnits: input.goodUnits,
      rejectedUnits: input.rejectedUnits,
      manufacturedOn: out.manufacturedOn,
      expiresOn: out.expiresOn,
      actualBulk: out.actualBulk,
      outsourcingCost: o.kind === "outsourced" ? out.outsourcingCost : o.outsourcingCost,
      updatedAt: new Date(),
    })
    .where(eq(productionOrders.id, o.id));

  // 3. Nhập kho thành phẩm (cách ly theo trạng thái lô)
  const [fg] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.kind, "finished"), eq(warehouses.isActive, true))).orderBy(sql`case when ${warehouses.code} = 'FG' then 0 else 1 end`).limit(1);
  if (!fg) throw new UserError("Chưa có kho thành phẩm");
  await postReceipt(
    tx,
    {
      kind: "production",
      warehouseId: fg.id,
      receivedOn: today,
      source: { type: "production_order", id: o.id },
      paymentMode: "none",
      note: `Thành phẩm của ${o.code}`,
      lines: [{ itemId: fgItemId, qty: input.goodUnits, lineCost: 0, productLotId: lot!.id, qcRequired: false }],
    },
    actor.id,
  );

  // 4. Phiếu FQC chờ
  const fqc = await createInspection(tx, { stage: "fqc", lotId: lot!.id, productionOrderId: o.id }, actor.id);

  // 5. Công nợ gia công
  let payableCode: string | null = null;
  if (o.kind === "outsourced" && out.outsourcingCost > 0 && supplier) {
    const pay = await openPayable(
      tx,
      {
        supplierId: supplier.id,
        categoryCode: "CHI-GIA-CONG",
        source: { type: "production_order", id: o.id, code: o.code },
        amount: out.outsourcingCost,
        issuedOn: today,
        dueOn: addDays(today, supplier.paymentTermsDays),
        note: `Gia công ${o.code}, lô ${lotNo}`,
      },
      actor.id,
    );
    payableCode = pay.code;
  }

  // 6. Giá thành; 7. Trạng thái qc
  const cost = await recalcProductionCost(tx, o.id, actor.id);
  await moveStatus(tx, o, "qc", { finishedAt: new Date() }, actor, { lotNo, goodUnits: input.goodUnits, rejectedUnits: input.rejectedUnits });
  return { lotId: lot!.id, lotNo, fqcCode: fqc.code, payableCode, totalCost: cost.total };
}

// qc → completed theo kết luận FQC của lô (R-SX-20)
export async function completeOrder(tx: Tx, actor: Actor, orderId: string): Promise<{ qcResult: "pass" | "fail" }> {
  assertCan(actor, "production.write");
  const o = await lockOrder(tx, orderId);
  if (o.status !== "qc" || !o.lotId) throw new UserError(STALE);
  const [lot] = await tx.select({ releaseStatus: lots.releaseStatus, releasedAt: lots.releasedAt }).from(lots).where(eq(lots.id, o.lotId)).limit(1);
  if (!lot) throw new UserError("Không tìm thấy lô thành phẩm");
  const r = qcResultFromLot(lot.releaseStatus, lot.releasedAt);
  if (!r.ok) throw new UserError(r.message);
  await moveStatus(tx, o, "completed", { qcResult: r.result, finishedAt: o.finishedAt ?? new Date() }, actor, { qcResult: r.result });
  return { qcResult: r.result };
}

// Hủy (R-SX-21): NVL đã xuất mà không trả về thì thành "hao hụt do hủy lệnh"
export async function cancelOrder(tx: Tx, actor: Actor, orderId: string, reason: string): Promise<{ leftoverValue: number }> {
  const o = await lockOrder(tx, orderId);
  const perm = cancelPermission(o.status);
  if (typeof perm !== "string") throw new UserError(perm.error);
  assertCan(actor, perm);
  if (!reason.trim()) throw new UserError("Ghi lý do hủy lệnh");
  const left = await netIssuedByLot(tx, orderId);
  const leftoverValue = left.reduce((s, r) => s + r.value, 0);
  await moveStatus(tx, o, "cancelled", { cancelReason: reason.trim() }, actor, { reason: reason.trim(), leftoverValue });
  await recalcProductionCost(tx, orderId, actor.id);
  return { leftoverValue };
}

// ---------------------------------------------------------------------------------------------
// Chi phí nhập tay (R-SX-26, R-SX-29), chốt giá vốn (R-TC-19)

export async function updateOrderCosts(
  tx: Tx,
  actor: Actor,
  orderId: string,
  input: { laborCost: number; overheadCost: number; otherCost: number; outsourcingCost?: number | null; reason?: string | null },
): Promise<{ total: number }> {
  assertCan(actor, "production.write");
  assertCan(actor, "finance.view");
  const o = await lockOrder(tx, orderId);
  if (o.costLockedAt) throw new UserError(COST_LOCKED);
  if (o.status === "cancelled") throw new UserError("Lệnh đã hủy");
  for (const v of [input.laborCost, input.overheadCost, input.otherCost, input.outsourcingCost ?? 0]) {
    if (!Number.isSafeInteger(v) || v < 0 || v > 2_000_000_000) throw new UserError("Chi phí không hợp lệ");
  }
  const outsourcingCost = o.kind === "outsourced" && input.outsourcingCost !== null && input.outsourcingCost !== undefined ? input.outsourcingCost : o.outsourcingCost;
  await tx
    .update(productionOrders)
    .set({ laborCost: input.laborCost, overheadCost: input.overheadCost, otherCost: input.otherCost, outsourcingCost, updatedAt: new Date() })
    .where(eq(productionOrders.id, orderId));
  // Một lệnh một khoản phải trả; sửa chi phí gia công → điều chỉnh khoản (không thấp hơn số đã trả)
  if (o.kind === "outsourced" && outsourcingCost !== o.outsourcingCost) {
    const debt = await findDebtBySource(tx, { kind: "payable", sourceType: "production_order", sourceId: orderId });
    if (debt && debt.status !== "cancelled") {
      await adjustDebtAmount(tx, { kind: "payable", debtId: debt.id, newAmount: outsourcingCost, reason: input.reason?.trim() || `Sửa chi phí gia công ${o.code}` }, actor.id);
    } else if (!debt && o.supplierId && outsourcingCost > 0 && (o.status === "qc" || o.status === "completed")) {
      const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, o.supplierId)).limit(1);
      const today = vnToday();
      await openPayable(
        tx,
        { supplierId: o.supplierId, categoryCode: "CHI-GIA-CONG", source: { type: "production_order", id: o.id, code: o.code }, amount: outsourcingCost, issuedOn: today, dueOn: addDays(today, s?.paymentTermsDays ?? 0) },
        actor.id,
      );
    }
  }
  const r = await recalcProductionCost(tx, orderId, actor.id);
  await writeAudit(tx, {
    actorId: actor.id,
    action: "production_order.costs_updated",
    entity: "production_orders",
    entityId: orderId,
    before: { laborCost: o.laborCost, overheadCost: o.overheadCost, otherCost: o.otherCost, outsourcingCost: o.outsourcingCost },
    after: { laborCost: input.laborCost, overheadCost: input.overheadCost, otherCost: input.otherCost, outsourcingCost, total: r.total },
  });
  return { total: r.total };
}

// Chốt hoặc mở chốt giá vốn: finance.approve; mở chốt cần lý do
export async function setCostLock(tx: Tx, actor: Actor, orderId: string, lock: boolean, reason: string | null): Promise<void> {
  assertCan(actor, "finance.approve");
  const o = await lockOrder(tx, orderId);
  if (lock && o.status !== "qc" && o.status !== "completed") throw new UserError("Chỉ chốt giá vốn lệnh đã ghi sản lượng");
  if (!lock && !reason?.trim()) throw new UserError("Ghi lý do mở chốt giá vốn");
  await lockProductionCost(tx, orderId, lock, actor.id);
  if (!lock) await writeAudit(tx, { actorId: actor.id, action: "production_order.cost_unlock_reason", entity: "production_orders", entityId: orderId, after: { reason: reason!.trim() } });
}

// ---------------------------------------------------------------------------------------------
// Đọc

export async function listOrders(db: Db | Tx, filter: { status?: ProductionStatus | "active" | null; kind?: ProductionKind | null } = {}) {
  const conds = [];
  if (filter.status === "active") conds.push(inArray(productionOrders.status, ["planned", "approved", "in_progress", "qc"]));
  else if (filter.status) conds.push(eq(productionOrders.status, filter.status));
  if (filter.kind) conds.push(eq(productionOrders.kind, filter.kind));
  return db
    .select({
      id: productionOrders.id,
      code: productionOrders.code,
      kind: productionOrders.kind,
      status: productionOrders.status,
      plannedUnits: productionOrders.plannedUnits,
      goodUnits: productionOrders.goodUnits,
      plannedStart: productionOrders.plannedStart,
      createdAt: productionOrders.createdAt,
      productCode: products.code,
      productName: products.name,
      supplierName: suppliers.name,
      lotNo: lots.lotNo,
    })
    .from(productionOrders)
    .innerJoin(products, eq(products.id, productionOrders.productId))
    .leftJoin(suppliers, eq(suppliers.id, productionOrders.supplierId))
    .leftJoin(lots, eq(lots.id, productionOrders.lotId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(productionOrders.createdAt))
    .limit(200);
}

// Chi tiết lệnh. Không trả tỷ lệ công thức (R-SX-10); tiền do trang ẩn khi thiếu finance.view.
export async function getOrderDetail(db: Db | Tx, orderId: string) {
  const [o] = await db.select().from(productionOrders).where(eq(productionOrders.id, orderId)).limit(1);
  if (!o) return null;
  const [product] = await db.select().from(products).where(eq(products.id, o.productId)).limit(1);
  const version = o.formulaVersionId
    ? ((
        await db
          .select({ id: formulaVersions.id, label: formulaVersions.label, status: formulaVersions.status, batchSize: formulaVersions.batchSize, batchUom: formulaVersions.batchUom, formulaName: formulas.name, formulaId: formulas.id })
          .from(formulaVersions)
          .innerJoin(formulas, eq(formulas.id, formulaVersions.formulaId))
          .where(eq(formulaVersions.id, o.formulaVersionId))
          .limit(1)
      )[0] ?? null)
    : null;
  const supplier = o.supplierId ? ((await db.select().from(suppliers).where(eq(suppliers.id, o.supplierId)).limit(1))[0] ?? null) : null;
  const mats = await materialRows(db, orderId);
  const byLot = await netIssuedByLot(db, orderId);
  const netByItem = new Map<string, number>();
  for (const r of byLot) netByItem.set(r.itemId, (netByItem.get(r.itemId) ?? 0) + r.net);
  const steps = [];
  for (const s of await stepsOf(db, orderId)) steps.push({ ...s, ipqc: s.needsQc ? await latestIpqc(db, s.id) : null });
  const lot = o.lotId ? ((await db.select().from(lots).where(eq(lots.id, o.lotId)).limit(1))[0] ?? null) : null;
  const fqc = o.lotId
    ? ((
        await db
          .select({ id: qcInspections.id, code: qcInspections.code, status: qcInspections.status })
          .from(qcInspections)
          .where(and(eq(qcInspections.lotId, o.lotId), eq(qcInspections.stage, "fqc")))
          .orderBy(desc(qcInspections.createdAt))
          .limit(1)
      )[0] ?? null)
    : null;
  const blocked = await hasBlockingDeviation(db, { productionOrderId: orderId });
  const blockingInspections = blocked
    ? await db
        .select({ id: qcInspections.id, code: qcInspections.code })
        .from(qcInspections)
        .where(and(eq(qcInspections.productionOrderId, orderId), eq(qcInspections.stage, "ipqc"), eq(qcInspections.status, "failed")))
    : [];
  const payable = await findDebtBySource(db, { kind: "payable", sourceType: "production_order", sourceId: orderId });
  const timeline = await db
    .select({ action: auditLog.action, at: auditLog.at, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.entityId, orderId), isNotNull(auditLog.action)))
    .orderBy(desc(auditLog.at))
    .limit(50);
  return {
    order: o,
    product: product ?? null,
    version,
    supplier,
    materials: mats.map((m) => ({ ...m, netIssued: netByItem.get(m.itemId) ?? 0 })),
    lotsIssued: byLot,
    steps,
    lot,
    fqc,
    blocked,
    blockingInspections,
    payable,
    timeline,
    statusLabel: ORDER_STATUS_LABEL[o.status],
  };
}

// Lô có thể xuất cho một hàng (FEFO), để trang lệnh cho chọn tay
export async function issuableLots(db: Db | Tx, itemId: string) {
  return db
    .select({ stockLotId: stockLots.id, code: stockLots.code, expiresOn: stockLots.expiresOn, qty: sql<string>`sum(${stockBalances.qty})`, warehouseCode: warehouses.code })
    .from(stockBalances)
    .innerJoin(stockLots, eq(stockLots.id, stockBalances.stockLotId))
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .where(and(eq(stockBalances.itemId, itemId), eq(stockLots.qcStatus, "released"), inArray(warehouses.kind, ["raw", "extract", "packaging", "wip"]), sql`${stockBalances.qty} > 0`))
    .groupBy(stockLots.id, stockLots.code, stockLots.expiresOn, warehouses.code)
    .orderBy(asc(stockLots.expiresOn), asc(stockLots.code));
}
