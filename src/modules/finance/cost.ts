// Giá vốn: bảng giá thành lệnh/lô, so lô, so kế hoạch, biến động giá NVL, phân bổ chi phí chung, chốt/mở chốt
// (05-tai-chinh.md R-TC-17…R-TC-20). Ghi giá thành chỉ qua recalcProductionCost/lockProductionCost (R-CHUNG-11).
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import {
  cashTransactions,
  financeCategories,
  inventoryItems,
  lots,
  overheadAllocationLines,
  overheadAllocations,
  productionOrders,
  products,
  stockReceiptLines,
  stockReceipts,
  suppliers,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { nextDocCode, vnToday } from "@/modules/numbering";
import { DISPLAY_UOM, unitPriceOf, type DisplayUom } from "@/modules/inventory/rules";
import { lockProductionCost, recalcProductionCost } from "@/modules/production/costing";
import { docDate } from "./ledger-rules";
import { allocateLargestRemainder, changeBp, costVsPlan, periodBounds, shouldSuggestLock, suggestedOverhead, vnStartOf } from "./rules";

const VN_OFFSET_MS = 7 * 3600 * 1000;
const vnDateOf = (d: Date | null) => (d ? new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10) : null);

// ---------------------------------------------------------------------------------------------
// R-TC-17 · Bảng giá thành

export type CostRow = {
  id: string;
  code: string;
  kind: "in_house" | "outsourced";
  status: string;
  productId: string;
  productName: string;
  lotNo: string | null;
  finishedOn: string | null;
  material: number;
  packaging: number;
  outsourcing: number;
  labor: number;
  overheadManual: number;
  overheadAllocated: number;
  other: number;
  total: number;
  goodUnits: number | null;
  unitCost: number | null;
  plannedUnitCost: number | null;
  diffPerUnit: number | null;
  diffBp: number | null;
  locked: boolean;
  suggestLock: boolean;
  vsPreviousBp: number | null;
};

export async function listProductionCosts(db: Db | Tx, today: string = vnToday()): Promise<CostRow[]> {
  const rows = await db
    .select({
      po: productionOrders,
      productName: products.name,
      lotNo: lots.lotNo,
      allocated: sql<string>`coalesce((select sum(${overheadAllocationLines.amount}) from ${overheadAllocationLines} where ${overheadAllocationLines.productionOrderId} = ${productionOrders.id}), 0)`,
    })
    .from(productionOrders)
    .innerJoin(products, eq(products.id, productionOrders.productId))
    .leftJoin(lots, eq(lots.id, productionOrders.lotId))
    .where(inArray(productionOrders.status, ["in_progress", "qc", "completed"]))
    .orderBy(asc(productionOrders.productId), asc(productionOrders.finishedAt), asc(productionOrders.code));

  const out: CostRow[] = [];
  const lastUnitByProduct = new Map<string, number>();
  for (const { po, productName, lotNo, allocated } of rows) {
    const plan = costVsPlan({ totalCost: po.totalCost, goodUnits: po.goodUnits, plannedCost: po.plannedCost, plannedUnits: po.plannedUnits });
    const prev = lastUnitByProduct.get(po.productId);
    const finishedOn = vnDateOf(po.finishedAt);
    out.push({
      id: po.id,
      code: po.code,
      kind: po.kind,
      status: po.status,
      productId: po.productId,
      productName,
      lotNo,
      finishedOn,
      material: po.materialCost,
      packaging: po.packagingCost,
      outsourcing: po.outsourcingCost,
      labor: po.laborCost,
      overheadManual: po.overheadCost,
      overheadAllocated: Number(allocated),
      other: po.otherCost,
      total: po.totalCost,
      goodUnits: po.goodUnits,
      ...plan,
      locked: po.costLockedAt !== null,
      suggestLock: shouldSuggestLock({ status: po.status, finishedOn, locked: po.costLockedAt !== null }, today),
      vsPreviousBp: plan.unitCost !== null && prev !== undefined ? changeBp(plan.unitCost, prev) : null,
    });
    if (plan.unitCost !== null) lastUnitByProduct.set(po.productId, plan.unitCost);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// R-TC-20 · Biến động giá NVL (giá theo đơn vị mua)

export type PriceRow = { itemId: string; itemCode: string; itemName: string; purchaseUom: string; receivedOn: string; receiptCode: string; supplierName: string | null; unitPrice: number; vsPreviousBp: number | null; vsRefBp: number | null; refUnitPrice: number | null };

export async function priceHistory(db: Db | Tx): Promise<PriceRow[]> {
  const rows = await db
    .select({
      itemId: inventoryItems.id,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      purchaseUom: inventoryItems.purchaseUom,
      refUnitPrice: inventoryItems.refUnitPrice,
      receivedOn: stockReceipts.receivedOn,
      receiptCode: stockReceipts.code,
      supplierName: suppliers.name,
      qty: stockReceiptLines.qty,
      lineCost: stockReceiptLines.lineCost,
    })
    .from(stockReceiptLines)
    .innerJoin(stockReceipts, eq(stockReceipts.id, stockReceiptLines.receiptId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockReceiptLines.itemId))
    .leftJoin(suppliers, eq(suppliers.id, stockReceipts.supplierId))
    .where(and(eq(stockReceipts.kind, "purchase"), eq(stockReceipts.status, "posted")))
    .orderBy(asc(inventoryItems.code), asc(stockReceipts.receivedOn), asc(stockReceipts.code));
  const last = new Map<string, number>();
  return rows
    .filter((r) => r.qty > 0)
    .map((r) => {
      const factor = DISPLAY_UOM[r.purchaseUom as DisplayUom]?.factor ?? 1;
      const unitPrice = unitPriceOf(r.lineCost, r.qty, factor);
      const prev = last.get(r.itemId);
      last.set(r.itemId, unitPrice);
      return {
        itemId: r.itemId,
        itemCode: r.itemCode,
        itemName: r.itemName,
        purchaseUom: r.purchaseUom,
        receivedOn: r.receivedOn,
        receiptCode: r.receiptCode,
        supplierName: r.supplierName,
        unitPrice,
        refUnitPrice: r.refUnitPrice,
        vsPreviousBp: prev !== undefined ? changeBp(unitPrice, prev) : null,
        vsRefBp: r.refUnitPrice ? changeBp(unitPrice, r.refUnitPrice) : null,
      };
    });
}

// ---------------------------------------------------------------------------------------------
// R-TC-18 · Phân bổ chi phí chung

export type OverheadBasis = "units" | "bulk";

async function eligibleOrders(db: Db | Tx, monthStart: string, basis: OverheadBasis) {
  const { to } = periodBounds("month", monthStart);
  const rows = await db
    .select({ id: productionOrders.id, code: productionOrders.code, kind: productionOrders.kind, goodUnits: productionOrders.goodUnits, actualBulk: productionOrders.actualBulk })
    .from(productionOrders)
    .where(
      and(
        inArray(productionOrders.status, ["qc", "completed"]),
        isNull(productionOrders.costLockedAt),
        gte(productionOrders.finishedAt, vnStartOf(monthStart)),
        lt(productionOrders.finishedAt, vnStartOf(to)),
        basis === "bulk" ? eq(productionOrders.kind, "in_house") : undefined,
      ),
    )
    .orderBy(asc(productionOrders.finishedAt), asc(productionOrders.code));
  return rows
    .map((r) => ({ ...r, weight: basis === "units" ? (r.goodUnits ?? 0) : (r.actualBulk ?? 0) }))
    .filter((r) => r.weight > 0);
}

export async function overheadSuggestion(db: Db | Tx, monthStart: string): Promise<{ capitalized: number; allocated: number; suggested: number }> {
  const { from, to } = periodBounds("month", monthStart);
  const [spend] = await db
    .select({ s: sql<string>`coalesce(sum(${cashTransactions.amount}), 0)` })
    .from(cashTransactions)
    .innerJoin(financeCategories, eq(financeCategories.id, cashTransactions.categoryId))
    .where(and(eq(cashTransactions.status, "posted"), eq(cashTransactions.direction, "out"), eq(financeCategories.plLine, "capitalized"), gte(cashTransactions.occurredOn, from), lt(cashTransactions.occurredOn, to)));
  const [alloc] = await db.select({ s: sql<string>`coalesce(sum(${overheadAllocations.totalAmount}), 0)` }).from(overheadAllocations).where(eq(overheadAllocations.periodMonth, from));
  const capitalized = Number(spend?.s ?? 0);
  const allocated = Number(alloc?.s ?? 0);
  return { capitalized, allocated, suggested: suggestedOverhead(capitalized, allocated) };
}

export async function previewAllocation(db: Db | Tx, monthStart: string, total: number, basis: OverheadBasis) {
  const orders = await eligibleOrders(db, periodBounds("month", monthStart).from, basis);
  const amounts = total > 0 ? allocateLargestRemainder(total, orders.map((o) => o.weight)) : null;
  return orders.map((o, i) => ({ id: o.id, code: o.code, weight: o.weight, amount: amounts?.[i] ?? 0 }));
}

export async function allocateOverhead(
  db: Db,
  input: { month: string; total: number; basis: OverheadBasis; note?: string | null },
  actorId: string,
): Promise<{ id: string; code: string; lines: { productionOrderId: string; code: string; amount: number }[] }> {
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(input.month)) throw new UserError("Chọn tháng phân bổ");
  if (!Number.isSafeInteger(input.total) || input.total <= 0 || input.total > 2_147_483_647) throw new UserError("Số tiền phân bổ phải là số nguyên lớn hơn 0");
  if (input.basis !== "units" && input.basis !== "bulk") throw new UserError("Chọn cơ sở phân bổ");
  const monthStart = `${input.month.slice(0, 7)}-01`;
  return db.transaction(async (tx) => {
    const orders = await eligibleOrders(tx, monthStart, input.basis);
    if (orders.length === 0) throw new UserError("Tháng này không có lệnh để phân bổ");
    // Khóa các lệnh; lệnh vừa bị chốt giữa chừng thì dừng
    const locked = await tx.select({ id: productionOrders.id, costLockedAt: productionOrders.costLockedAt }).from(productionOrders).where(inArray(productionOrders.id, orders.map((o) => o.id))).for("update");
    if (locked.some((l) => l.costLockedAt)) throw new UserError("Chứng từ vừa được người khác cập nhật, tải lại trang.");
    const amounts = allocateLargestRemainder(input.total, orders.map((o) => o.weight))!;
    const code = await nextDocCode(tx, "PB", docDate(monthStart));
    const [alloc] = await tx
      .insert(overheadAllocations)
      .values({ code, periodMonth: monthStart, totalAmount: input.total, basis: input.basis, note: input.note?.trim() || null, createdBy: actorId })
      .returning({ id: overheadAllocations.id });
    const lines = orders.map((o, i) => ({ productionOrderId: o.id, code: o.code, amount: amounts[i]! }));
    await tx.insert(overheadAllocationLines).values(lines.map((l) => ({ allocationId: alloc!.id, productionOrderId: l.productionOrderId, amount: l.amount })));
    for (const l of lines) await recalcProductionCost(tx, l.productionOrderId, actorId);
    await writeAudit(tx, {
      actorId,
      action: "overhead_allocation.created",
      entity: "overhead_allocations",
      entityId: alloc!.id,
      after: { code, month: monthStart, total: input.total, basis: input.basis, lines: lines.map((l) => ({ order: l.code, amount: l.amount })) },
    });
    return { id: alloc!.id, code, lines };
  });
}

// Xóa một lần phân bổ khi các lệnh chưa chốt → tính lại
export async function deleteAllocation(db: Db, allocationId: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [alloc] = await tx.select().from(overheadAllocations).where(eq(overheadAllocations.id, allocationId)).for("update");
    if (!alloc) throw new UserError("Không tìm thấy lần phân bổ");
    const lines = await tx
      .select({ productionOrderId: overheadAllocationLines.productionOrderId, amount: overheadAllocationLines.amount, code: productionOrders.code, costLockedAt: productionOrders.costLockedAt })
      .from(overheadAllocationLines)
      .innerJoin(productionOrders, eq(productionOrders.id, overheadAllocationLines.productionOrderId))
      .where(eq(overheadAllocationLines.allocationId, allocationId));
    const lockedCodes = lines.filter((l) => l.costLockedAt).map((l) => l.code);
    if (lockedCodes.length) throw new UserError(`Lệnh ${lockedCodes.join(", ")} đã chốt giá vốn, mở chốt trước khi xóa phân bổ`);
    await tx.delete(overheadAllocations).where(eq(overheadAllocations.id, allocationId));
    for (const l of lines) await recalcProductionCost(tx, l.productionOrderId, actorId);
    await writeAudit(tx, {
      actorId,
      action: "overhead_allocation.deleted",
      entity: "overhead_allocations",
      entityId: allocationId,
      before: { code: alloc.code, month: alloc.periodMonth, total: alloc.totalAmount, basis: alloc.basis, lines: lines.map((l) => ({ order: l.code, amount: l.amount })) },
    });
  });
}

export async function listAllocations(db: Db | Tx, limit = 24) {
  const allocs = await db.select().from(overheadAllocations).orderBy(desc(overheadAllocations.periodMonth), desc(overheadAllocations.createdAt)).limit(limit);
  if (allocs.length === 0) return [];
  const lines = await db
    .select({ allocationId: overheadAllocationLines.allocationId, amount: overheadAllocationLines.amount, code: productionOrders.code, locked: sql<boolean>`${productionOrders.costLockedAt} is not null` })
    .from(overheadAllocationLines)
    .innerJoin(productionOrders, eq(productionOrders.id, overheadAllocationLines.productionOrderId))
    .where(inArray(overheadAllocationLines.allocationId, allocs.map((a) => a.id)));
  return allocs.map((a) => ({ ...a, lines: lines.filter((l) => l.allocationId === a.id) }));
}

// ---------------------------------------------------------------------------------------------
// R-TC-19 · Chốt / mở chốt (finance.approve ở trang gọi). Mở chốt cần lý do.

export async function setCostLock(db: Db, productionOrderId: string, lock: boolean, reason: string | null, actorId: string): Promise<void> {
  if (!lock && !reason?.trim()) throw new UserError("Ghi lý do mở chốt giá vốn");
  await db.transaction(async (tx) => {
    const [po] = await tx.select({ code: productionOrders.code, status: productionOrders.status, costLockedAt: productionOrders.costLockedAt }).from(productionOrders).where(eq(productionOrders.id, productionOrderId));
    if (!po) throw new UserError("Không tìm thấy lệnh sản xuất");
    if (lock && po.costLockedAt) throw new UserError("Giá vốn lệnh đã chốt");
    if (!lock && !po.costLockedAt) throw new UserError("Giá vốn lệnh chưa chốt");
    if (lock && po.status !== "qc" && po.status !== "completed") throw new UserError("Chỉ chốt giá vốn lệnh đã ghi sản lượng");
    await lockProductionCost(tx, productionOrderId, lock, actorId);
    await writeAudit(tx, {
      actorId,
      action: lock ? "finance.cost_lock" : "finance.cost_unlock",
      entity: "production_orders",
      entityId: productionOrderId,
      after: { code: po.code, reason: reason?.trim() || null },
    });
  });
}
