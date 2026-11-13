// Sản xuất: giá thành lệnh (00-tong-quan.md mục 8.4, 02-san-xuat.md R-SX-26, 05-tai-chinh.md R-TC-17, R-TC-19). Thân hàm do T-14b-C viết.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/db/client";
import { inventoryItems, overheadAllocationLines, productionOrders, stockLots, stockMovements } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { costOfQty } from "@/modules/inventory/rules";

// R-SX-26: tổng = mọi khoản cộng lại; giá đơn vị = tổng / số chai đạt, làm tròn nửa lên tới đồng (chỉ để hiện).
// Giá vốn bán đọc stock_lots.received_cost qua costOfQty, không dùng số đã làm tròn này. 0 chai đạt → null.
export function computeProductionCost(input: {
  material: number;
  packaging: number;
  labor: number;
  overheadManual: number;
  overheadAllocated: number;
  outsourcing: number;
  other: number;
  goodUnits: number;
}): { total: number; unitCost: number | null } {
  const total = input.material + input.packaging + input.labor + input.overheadManual + input.overheadAllocated + input.outsourcing + input.other;
  if (!(input.goodUnits > 0)) return { total, unitCost: null };
  // Tổng không âm: Math.round là làm tròn nửa lên
  return { total, unitCost: Math.round(total / input.goodUnits) };
}

export type NetConsumption = { stockLotId: string; netQty: number; receivedQty: number; receivedCost: number; isPackaging: boolean };

// R-SX-26: giá vật tư (không phải bao bì) và bao bì từ lượng xuất ròng theo lô × giá lô nguồn (costOfQty).
// Lượng ròng âm (trả nhiều hơn xuất, chỉ xảy ra khi dữ liệu lệch) lấy giá âm tương ứng để tổng vẫn khớp sổ.
export function materialCostsFromConsumption(rows: NetConsumption[]): { material: number; packaging: number } {
  let material = 0;
  let packaging = 0;
  for (const r of rows) {
    if (r.netQty === 0) continue;
    const abs = Math.abs(r.netQty);
    const cost = costOfQty(abs, r.receivedQty, r.receivedCost) * Math.sign(r.netQty);
    if (r.isPackaging) packaging += cost;
    else material += cost;
  }
  return { material, packaging };
}

const ISSUE_TYPES = ["production_issue", "production_return"] as const;

async function loadNetConsumption(tx: Tx, productionOrderId: string): Promise<NetConsumption[]> {
  const original = alias(stockMovements, "original");
  // Biến động production_issue (âm) và production_return (dương) của lệnh, cộng cả dòng reversal đảo chúng.
  const rows = await tx
    .select({
      stockLotId: stockMovements.stockLotId,
      sumQty: sql<string>`sum(${stockMovements.qty})`,
      receivedQty: stockLots.receivedQty,
      receivedCost: stockLots.receivedCost,
      kind: inventoryItems.kind,
    })
    .from(stockMovements)
    .leftJoin(original, eq(original.id, stockMovements.reversalOf))
    .innerJoin(stockLots, eq(stockLots.id, stockMovements.stockLotId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockMovements.itemId))
    .where(
      or(
        and(eq(stockMovements.productionOrderId, productionOrderId), inArray(stockMovements.type, [...ISSUE_TYPES])),
        and(eq(stockMovements.type, "reversal"), eq(original.productionOrderId, productionOrderId), inArray(original.type, [...ISSUE_TYPES])),
      ),
    )
    .groupBy(stockMovements.stockLotId, stockLots.receivedQty, stockLots.receivedCost, inventoryItems.kind);
  return rows.map((r) => ({
    stockLotId: r.stockLotId,
    // Xuất mang dấu âm trong sổ: lượng dùng ròng = −tổng
    netQty: -Number(r.sumQty),
    receivedQty: r.receivedQty,
    receivedCost: r.receivedCost,
    isPackaging: r.kind === "packaging",
  }));
}

// Tính lại chi phí từ biến động và phân bổ, ghi cột chi phí, total_cost và stock_lots.received_cost lô thành phẩm.
// Đã chốt (cost_locked_at) thì không ghi, trả locked: true (R-SX-26, R-TC-17).
export async function recalcProductionCost(tx: Tx, productionOrderId: string, actorId: string | null): Promise<{ total: number; unitCost: number | null; locked: boolean }> {
  // Khóa dòng lệnh để hai lần tính cùng lúc không ghi chồng
  const [po] = await tx.select().from(productionOrders).where(eq(productionOrders.id, productionOrderId)).for("update").limit(1);
  if (!po) throw new Error("Không tìm thấy lệnh sản xuất");

  const goodUnits = po.goodUnits ?? 0;
  if (po.costLockedAt) {
    return { total: po.totalCost, unitCost: goodUnits > 0 ? Math.round(po.totalCost / goodUnits) : null, locked: true };
  }

  const { material, packaging } = materialCostsFromConsumption(await loadNetConsumption(tx, productionOrderId));
  const [alloc] = await tx
    .select({ sum: sql<string | null>`sum(${overheadAllocationLines.amount})` })
    .from(overheadAllocationLines)
    .where(eq(overheadAllocationLines.productionOrderId, productionOrderId));
  const overheadAllocated = Number(alloc?.sum ?? 0);

  const { total, unitCost } = computeProductionCost({
    material,
    packaging,
    labor: po.laborCost,
    overheadManual: po.overheadCost,
    overheadAllocated,
    outsourcing: po.outsourcingCost,
    other: po.otherCost,
    goodUnits,
  });
  if (total > 2_147_483_647) throw new Error("Giá thành lệnh vượt giới hạn lưu trữ");

  const changed = po.materialCost !== material || po.packagingCost !== packaging || po.totalCost !== total;
  if (changed) {
    await tx.update(productionOrders).set({ materialCost: material, packagingCost: packaging, totalCost: total, updatedAt: new Date() }).where(eq(productionOrders.id, productionOrderId));
  }

  // Lô thành phẩm của lệnh: received_cost = total_cost (R-SX-26)
  let fgLotUpdated = 0;
  if (po.lotId) {
    const updated = await tx
      .update(stockLots)
      .set({ receivedCost: Math.max(0, total) })
      .where(and(eq(stockLots.productLotId, po.lotId), sql`${stockLots.receivedCost} <> ${Math.max(0, total)}`))
      .returning({ id: stockLots.id });
    fgLotUpdated = updated.length;
  }

  if (changed || fgLotUpdated > 0) {
    await writeAudit(tx, {
      actorId,
      action: "production_order.cost_recalculated",
      entity: "production_order",
      entityId: productionOrderId,
      before: { materialCost: po.materialCost, packagingCost: po.packagingCost, totalCost: po.totalCost },
      after: { materialCost: material, packagingCost: packaging, overheadAllocated, totalCost: total, unitCost, fgLotUpdated },
    });
  }
  return { total, unitCost, locked: false };
}

// R-TC-19: chốt giá vốn đặt cost_locked_at cho lệnh và lô kho thành phẩm (tính lại lần cuối trước khi chốt); mở chốt xóa mốc.
// Gọi lại với cùng trạng thái thì không làm gì. Quyền và lý do mở chốt do trang gọi kiểm.
export async function lockProductionCost(tx: Tx, productionOrderId: string, lock: boolean, actorId: string): Promise<void> {
  const [po] = await tx
    .select({ id: productionOrders.id, code: productionOrders.code, lotId: productionOrders.lotId, costLockedAt: productionOrders.costLockedAt })
    .from(productionOrders)
    .where(eq(productionOrders.id, productionOrderId))
    .for("update")
    .limit(1);
  if (!po) throw new Error("Không tìm thấy lệnh sản xuất");
  if (lock === (po.costLockedAt !== null)) return;

  if (lock) {
    const { total, unitCost } = await recalcProductionCost(tx, productionOrderId, actorId);
    const at = new Date();
    await tx.update(productionOrders).set({ costLockedAt: at, updatedAt: at }).where(eq(productionOrders.id, productionOrderId));
    if (po.lotId) await tx.update(stockLots).set({ costLockedAt: at }).where(eq(stockLots.productLotId, po.lotId));
    await writeAudit(tx, { actorId, action: "production_order.cost_locked", entity: "production_order", entityId: productionOrderId, after: { code: po.code, totalCost: total, unitCost } });
  } else {
    await tx.update(productionOrders).set({ costLockedAt: null, updatedAt: new Date() }).where(eq(productionOrders.id, productionOrderId));
    if (po.lotId) await tx.update(stockLots).set({ costLockedAt: null }).where(eq(stockLots.productLotId, po.lotId));
    await writeAudit(tx, {
      actorId,
      action: "production_order.cost_unlocked",
      entity: "production_order",
      entityId: productionOrderId,
      before: { costLockedAt: po.costLockedAt?.toISOString() ?? null },
      after: { code: po.code },
    });
  }
}
