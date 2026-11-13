// Hiệu suất sản xuất (02-san-xuat.md R-SX-28)
import "server-only";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { extractionRuns, inventoryItems, lots, productionOrderMaterials, productionOrders, products, suppliers } from "@/db/schema";
import { addDays, type BaseUom } from "@/modules/inventory/rules";
import { peelConsumption } from "./extraction";
import { netIssuedByItem } from "./orders";
import { equipmentSummary, materialVarianceBp, orderMetrics, performanceSummary, recoveryOf, type ProductionKind, type Recovery } from "./rules";

export type PerfFilter = { from: string; to: string; productId?: string | null; kind?: ProductionKind | null; supplierId?: string | null };

// Mốc ngày theo giờ Việt Nam: [from 00:00, to + 1 ngày 00:00) UTC+7
function vnStart(date: string): Date {
  return new Date(`${date}T00:00:00+07:00`);
}

export async function getPerformance(db: Db | Tx, f: PerfFilter) {
  const conds = [eq(productionOrders.status, "completed"), gte(productionOrders.finishedAt, vnStart(f.from)), lt(productionOrders.finishedAt, vnStart(addDays(f.to, 1)))];
  if (f.productId) conds.push(eq(productionOrders.productId, f.productId));
  if (f.kind) conds.push(eq(productionOrders.kind, f.kind));
  if (f.supplierId) conds.push(eq(productionOrders.supplierId, f.supplierId));
  const rows = await db
    .select({
      id: productionOrders.id,
      code: productionOrders.code,
      kind: productionOrders.kind,
      plannedUnits: productionOrders.plannedUnits,
      goodUnits: productionOrders.goodUnits,
      rejectedUnits: productionOrders.rejectedUnits,
      actualBulk: productionOrders.actualBulk,
      totalCost: productionOrders.totalCost,
      batchCount: productionOrders.batchCount,
      qcResult: productionOrders.qcResult,
      startedAt: productionOrders.startedAt,
      approvedAt: productionOrders.approvedAt,
      finishedAt: productionOrders.finishedAt,
      netQty: products.netQty,
      productCode: products.code,
      supplierName: suppliers.name,
      lotNo: lots.lotNo,
    })
    .from(productionOrders)
    .innerJoin(products, eq(products.id, productionOrders.productId))
    .leftJoin(suppliers, eq(suppliers.id, productionOrders.supplierId))
    .leftJoin(lots, eq(lots.id, productionOrders.lotId))
    .where(and(...conds))
    .orderBy(productionOrders.finishedAt);
  const perf = rows.map((r) => ({ ...r, goodUnits: r.goodUnits ?? 0 }));
  const orders = perf.map((r) => ({ ...r, metrics: orderMetrics(r) }));

  // Chênh lệch NVL theo hàng (cộng các lệnh trong kỳ)
  const planned = new Map<string, number>();
  const issued = new Map<string, number>();
  if (rows.length) {
    const mats = await db
      .select({ orderId: productionOrderMaterials.productionOrderId, itemId: productionOrderMaterials.itemId, plannedQty: productionOrderMaterials.plannedQty, suppliedBy: productionOrderMaterials.suppliedBy })
      .from(productionOrderMaterials)
      .where(inArray(productionOrderMaterials.productionOrderId, rows.map((r) => r.id)));
    for (const m of mats) if (m.suppliedBy === "pomil") planned.set(m.itemId, (planned.get(m.itemId) ?? 0) + m.plannedQty);
    for (const r of rows) for (const [itemId, q] of await netIssuedByItem(db, r.id)) issued.set(itemId, (issued.get(itemId) ?? 0) + q);
  }
  const itemIds = [...new Set([...planned.keys(), ...issued.keys()])];
  const items = itemIds.length ? await db.select({ id: inventoryItems.id, code: inventoryItems.code, name: inventoryItems.name, baseUom: inventoryItems.baseUom, displayUom: inventoryItems.displayUom }).from(inventoryItems).where(inArray(inventoryItems.id, itemIds)) : [];
  const materials = items
    .map((i) => ({ ...i, planned: planned.get(i.id) ?? 0, issued: issued.get(i.id) ?? 0, varianceBp: materialVarianceBp(issued.get(i.id) ?? 0, planned.get(i.id) ?? 0) }))
    .sort((a, b) => a.code.localeCompare(b.code));

  // Mẻ chiết hoàn thành trong kỳ
  const runs = await db
    .select({
      id: extractionRuns.id,
      code: extractionRuns.code,
      equipment: extractionRuns.equipment,
      startedAt: extractionRuns.startedAt,
      endedAt: extractionRuns.endedAt,
      outputQty: extractionRuns.outputQty,
      totalCost: extractionRuns.totalCost,
      baseUom: inventoryItems.baseUom,
      density: inventoryItems.densityMgPerMl,
    })
    .from(extractionRuns)
    .innerJoin(inventoryItems, eq(inventoryItems.id, extractionRuns.outputItemId))
    .where(and(eq(extractionRuns.status, "completed"), gte(extractionRuns.endedAt, vnStart(f.from)), lt(extractionRuns.endedAt, vnStart(addDays(f.to, 1)))));
  const runRows: { code: string; equipment: string; startedAt: Date | null; endedAt: Date | null; recovery: Recovery | null; totalCost: number }[] = [];
  for (const r of runs) {
    const peel = await peelConsumption(db, r.id);
    runRows.push({ code: r.code, equipment: r.equipment, startedAt: r.startedAt, endedAt: r.endedAt, totalCost: r.totalCost, recovery: recoveryOf(peel.inputMg, r.outputQty ?? 0, r.baseUom as BaseUom, r.density) });
  }
  const pct = runRows.filter((r) => r.recovery?.kind === "percent").map((r) => (r.recovery as { bp: number }).bp);
  return {
    orders,
    summary: performanceSummary(perf),
    materials,
    runs: runRows,
    avgRecoveryBp: pct.length ? Math.round(pct.reduce((s, x) => s + x, 0) / pct.length) : null,
    equipment: equipmentSummary(runRows),
  };
}
