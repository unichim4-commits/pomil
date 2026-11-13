// Kế hoạch sản xuất (02-san-xuat.md R-SX-12…R-SX-14, R-SX-16)
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { formulaVersions, inventoryItems, productionOrders, productionPlanLines, productionPlans, products } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { getItemStock } from "@/modules/inventory/ledger";
import type { BaseUom } from "@/modules/inventory/rules";
import { nextDocCode } from "@/modules/numbering/service";
import { assertCan, STALE, type Actor } from "./access";
import { currentVersionOfProduct, loadVersionForCalc } from "./formulas";
import {
  avgDays,
  batchesFor,
  bulkForUnits,
  canChangePlanStatus,
  formulaRequirement,
  hoursPerBatch,
  NEED_NET_QTY,
  PLAN_STATUS_LABEL,
  planLineProgress,
  shortageOf,
  type PlanStatus,
} from "./rules";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function createPlan(tx: Tx, actor: Actor, input: { period: "day" | "week" | "month"; periodStart: string; periodEnd: string; note?: string | null }): Promise<{ id: string; code: string }> {
  assertCan(actor, "production.write");
  if (!["day", "week", "month"].includes(input.period)) throw new UserError("Chọn kỳ kế hoạch");
  if (!DATE.test(input.periodStart) || !DATE.test(input.periodEnd)) throw new UserError("Ngày chưa đúng");
  if (input.periodEnd < input.periodStart) throw new UserError("Ngày kết thúc phải từ ngày bắt đầu trở đi");
  const code = await nextDocCode(tx, "KH");
  const [row] = await tx
    .insert(productionPlans)
    .values({ code, period: input.period, periodStart: input.periodStart, periodEnd: input.periodEnd, note: input.note?.trim() || null, createdBy: actor.id })
    .returning({ id: productionPlans.id });
  await writeAudit(tx, { actorId: actor.id, action: "production_plan.created", entity: "production_plans", entityId: row!.id, after: { code, period: input.period } });
  return { id: row!.id, code };
}

async function draftPlan(tx: Tx, planId: string) {
  const [p] = await tx.select().from(productionPlans).where(eq(productionPlans.id, planId)).for("update").limit(1);
  if (!p) throw new UserError("Không tìm thấy kế hoạch");
  if (p.status !== "draft") throw new UserError("Kế hoạch đã xác nhận, không sửa dòng");
  return p;
}

// R-SX-12: sản phẩm phải có dung tích; phiên bản (nếu chọn) phải đang dùng được
export async function addPlanLine(
  tx: Tx,
  actor: Actor,
  planId: string,
  input: { productId: string; formulaVersionId: string | null; targetUnits: number; plannedStart?: string | null; note?: string | null },
): Promise<void> {
  assertCan(actor, "production.write");
  await draftPlan(tx, planId);
  if (!Number.isInteger(input.targetUnits) || input.targetUnits <= 0) throw new UserError("Số chai phải lớn hơn 0");
  const [p] = await tx.select({ netQty: products.netQty, code: products.code }).from(products).where(eq(products.id, input.productId)).limit(1);
  if (!p) throw new UserError("Không tìm thấy sản phẩm");
  if (!p.netQty) throw new UserError(NEED_NET_QTY);
  if (input.formulaVersionId) {
    const [v] = await tx.select({ status: formulaVersions.status }).from(formulaVersions).where(eq(formulaVersions.id, input.formulaVersionId)).limit(1);
    if (!v || (v.status !== "approved" && v.status !== "trial")) throw new UserError("Chọn phiên bản công thức đã duyệt hoặc đang thử nghiệm");
  }
  const existing = await tx.select({ id: productionPlanLines.id }).from(productionPlanLines).where(eq(productionPlanLines.planId, planId));
  await tx.insert(productionPlanLines).values({
    planId,
    productId: input.productId,
    formulaVersionId: input.formulaVersionId,
    targetUnits: input.targetUnits,
    plannedStart: input.plannedStart || null,
    note: input.note?.trim() || null,
    sort: existing.length,
  });
  await writeAudit(tx, { actorId: actor.id, action: "production_plan.line_added", entity: "production_plans", entityId: planId, after: { product: p.code, targetUnits: input.targetUnits } });
}

export async function removePlanLine(tx: Tx, actor: Actor, lineId: string): Promise<void> {
  assertCan(actor, "production.write");
  const [line] = await tx.select().from(productionPlanLines).where(eq(productionPlanLines.id, lineId)).limit(1);
  if (!line) throw new UserError("Không tìm thấy dòng kế hoạch");
  await draftPlan(tx, line.planId);
  const [used] = await tx.select({ id: productionOrders.id }).from(productionOrders).where(eq(productionOrders.planLineId, lineId)).limit(1);
  if (used) throw new UserError("Dòng đã có lệnh sản xuất, không xóa được");
  await tx.delete(productionPlanLines).where(eq(productionPlanLines.id, lineId));
  await writeAudit(tx, { actorId: actor.id, action: "production_plan.line_removed", entity: "production_plans", entityId: line.planId, before: { productId: line.productId, targetUnits: line.targetUnits } });
}

export async function setPlanStatus(tx: Tx, actor: Actor, planId: string, to: PlanStatus): Promise<void> {
  assertCan(actor, "production.write");
  const [p] = await tx.select().from(productionPlans).where(eq(productionPlans.id, planId)).limit(1);
  if (!p) throw new UserError("Không tìm thấy kế hoạch");
  if (!canChangePlanStatus(p.status, to)) throw new UserError(`Không chuyển được từ ${PLAN_STATUS_LABEL[p.status]} sang ${PLAN_STATUS_LABEL[to]}`);
  if (to === "confirmed") {
    const [has] = await tx.select({ id: productionPlanLines.id }).from(productionPlanLines).where(eq(productionPlanLines.planId, planId)).limit(1);
    if (!has) throw new UserError("Kế hoạch chưa có dòng nào");
  }
  const [row] = await tx
    .update(productionPlans)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(productionPlans.id, planId), eq(productionPlans.status, p.status)))
    .returning({ id: productionPlans.id });
  if (!row) throw new UserError(STALE);
  await writeAudit(tx, { actorId: actor.id, action: `production_plan.${to}`, entity: "production_plans", entityId: planId, before: { status: p.status }, after: { status: to, code: p.code } });
}

export async function listPlans(db: Db | Tx) {
  return db.select().from(productionPlans).orderBy(desc(productionPlans.periodStart), desc(productionPlans.createdAt)).limit(100);
}

// R-SX-14: ước tính theo lịch sử lệnh đã hoàn thành
export async function estimateFor(db: Db | Tx, productId: string, batches: number): Promise<{ inHouseHours: number | null; perBatch: number | null }> {
  const hist = await db
    .select({ startedAt: productionOrders.startedAt, finishedAt: productionOrders.finishedAt, batchCount: productionOrders.batchCount })
    .from(productionOrders)
    .where(and(eq(productionOrders.productId, productId), eq(productionOrders.kind, "in_house"), eq(productionOrders.status, "completed"), isNotNull(productionOrders.startedAt), isNotNull(productionOrders.finishedAt)));
  const per = hoursPerBatch(hist.map((h) => ({ startedAt: h.startedAt!, finishedAt: h.finishedAt!, batchCount: h.batchCount })));
  return { perBatch: per, inHouseHours: per === null ? null : per * batches };
}

export async function outsourcedDaysFor(db: Db | Tx, supplierId: string): Promise<number | null> {
  const hist = await db
    .select({ approvedAt: productionOrders.approvedAt, finishedAt: productionOrders.finishedAt })
    .from(productionOrders)
    .where(and(eq(productionOrders.supplierId, supplierId), eq(productionOrders.kind, "outsourced"), eq(productionOrders.status, "completed"), isNotNull(productionOrders.approvedAt), isNotNull(productionOrders.finishedAt)));
  return avgDays(hist.map((h) => ({ from: h.approvedAt!, to: h.finishedAt! })));
}

export type PlanNeedRow = { itemId: string; itemCode: string; itemName: string; baseUom: BaseUom; displayUom: string; need: number; available: number; committed: number; shortage: number };

// Chi tiết kế hoạch: nhu cầu từng dòng, gộp theo hàng, so tồn (R-SX-12, R-SX-13), tiến độ (R-SX-16)
export async function getPlanDetail(db: Db | Tx, planId: string) {
  const [plan] = await db.select().from(productionPlans).where(eq(productionPlans.id, planId)).limit(1);
  if (!plan) return null;
  const lines = await db
    .select({
      id: productionPlanLines.id,
      productId: productionPlanLines.productId,
      formulaVersionId: productionPlanLines.formulaVersionId,
      targetUnits: productionPlanLines.targetUnits,
      plannedStart: productionPlanLines.plannedStart,
      note: productionPlanLines.note,
      productCode: products.code,
      productName: products.name,
      netQty: products.netQty,
      netUom: products.netUom,
    })
    .from(productionPlanLines)
    .innerJoin(products, eq(products.id, productionPlanLines.productId))
    .where(eq(productionPlanLines.planId, planId))
    .orderBy(asc(productionPlanLines.sort));

  const needs: { itemId: string; qty: number }[] = [];
  const outLines = [];
  for (const l of lines) {
    const versionId = l.formulaVersionId ?? (await currentVersionOfProduct(db, l.productId));
    const v = versionId ? await loadVersionForCalc(db, versionId) : null;
    let error: string | null = null;
    let bulk: number | null = null;
    let batches: number | null = null;
    if (!v) error = "Chưa có công thức đã duyệt: không tính được nguyên liệu";
    else {
      const b = bulkForUnits({ targetUnits: l.targetUnits, netQty: l.netQty, netUom: l.netUom, batchUom: v.batchUom as BaseUom, bulkDensityMgPerMl: v.bulkDensityMgPerMl, expectedYieldBp: v.expectedYieldBp });
      if (!b.ok) error = b.message;
      else {
        bulk = b.bulk;
        batches = batchesFor(b.bulk, v.batchSize);
        const req = formulaRequirement(
          b.bulk,
          v.batchUom as BaseUom,
          v.lines.map((x) => ({ ppm: x.ppm, isBalance: x.isBalance, sort: x.sort, item: { id: x.itemId, code: x.itemCode, kind: x.itemKind, baseUom: x.baseUom as BaseUom, densityMgPerMl: x.densityMgPerMl } })),
        );
        if (!req.ok) error = req.message;
        else for (const r of req.lines) needs.push({ itemId: r.itemId, qty: r.qty });
        for (const p of v.packaging) needs.push({ itemId: p.itemId, qty: l.targetUnits * p.qtyPerUnit });
      }
    }
    const orders = await db
      .select({ id: productionOrders.id, code: productionOrders.code, status: productionOrders.status, plannedUnits: productionOrders.plannedUnits, goodUnits: productionOrders.goodUnits })
      .from(productionOrders)
      .where(eq(productionOrders.planLineId, l.id));
    const estimate = batches ? await estimateFor(db, l.productId, batches) : { inHouseHours: null, perBatch: null };
    outLines.push({ ...l, versionLabel: v?.label ?? null, bulk, batchUom: (v?.batchUom ?? null) as BaseUom | null, batches, error, orders, progress: planLineProgress(l.targetUnits, orders), estimate });
  }

  const totals = new Map<string, number>();
  for (const n of needs) totals.set(n.itemId, (totals.get(n.itemId) ?? 0) + n.qty);
  const itemIds = [...totals.keys()];
  const items = itemIds.length ? await db.select().from(inventoryItems).where(inArray(inventoryItems.id, itemIds)) : [];
  const stock = await getItemStock(db, itemIds);
  const need: PlanNeedRow[] = items
    .map((it) => {
      const s = stock.get(it.id)!;
      const q = totals.get(it.id)!;
      return { itemId: it.id, itemCode: it.code, itemName: it.name, baseUom: it.baseUom as BaseUom, displayUom: it.displayUom, need: q, available: s.available, committed: s.committed, shortage: shortageOf(q, s.available, s.committed) };
    })
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  return { plan, lines: outLines, need };
}
