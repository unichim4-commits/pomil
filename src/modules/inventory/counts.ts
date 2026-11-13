// Kho: kiểm kê (01-kho.md R-KHO-19). Chạy trong giao dịch của người gọi; quyền kiểm ở tầng action,
// riêng ghi sổ phiếu có chênh lệch thì hàm tự kiểm inventory.approve của người ghi.
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { inventoryItems, staffUsers, stockBalances, stockCountLines, stockCounts, stockLots, warehouseLocations, warehouses } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { can, type StaffRole } from "@/modules/auth/rules";
import { nextDocCode } from "@/modules/numbering/service";
import { vnToday } from "@/modules/numbering/rules";
import { postMovements, STALE_MESSAGE } from "./ledger";
import { formatQty, type DisplayUom, type StockMoveInput } from "./rules";

// Tạo phiếu cho một kho: chụp mọi (vị trí, lô) có số dư > 0
export async function createStockCount(tx: Tx, input: { warehouseId: string; countedOn?: string; note?: string | null }, actorId: string | null): Promise<{ countId: string; code: string; lines: number }> {
  const [wh] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, input.warehouseId));
  if (!wh) throw new UserError("Không tìm thấy kho");
  const balances = await tx
    .select({ locationId: stockBalances.locationId, stockLotId: stockBalances.stockLotId, itemId: stockBalances.itemId, qty: stockBalances.qty })
    .from(stockBalances)
    .innerJoin(warehouseLocations, eq(warehouseLocations.id, stockBalances.locationId))
    .innerJoin(stockLots, eq(stockLots.id, stockBalances.stockLotId))
    .where(and(eq(stockBalances.warehouseId, input.warehouseId), gt(stockBalances.qty, 0)))
    .orderBy(asc(warehouseLocations.code), asc(stockLots.code));
  const code = await nextDocCode(tx, "KK");
  const [row] = await tx
    .insert(stockCounts)
    .values({ code, warehouseId: input.warehouseId, status: "draft", countedOn: input.countedOn ?? vnToday(), note: input.note ?? null, createdBy: actorId })
    .returning({ id: stockCounts.id });
  if (balances.length) {
    await tx.insert(stockCountLines).values(balances.map((b) => ({ countId: row!.id, itemId: b.itemId, stockLotId: b.stockLotId, locationId: b.locationId, systemQty: b.qty })));
  }
  await writeAudit(tx, { actorId, action: "stock_count.created", entity: "stock_counts", entityId: row!.id, after: { code, warehouseId: input.warehouseId, lines: balances.length } });
  return { countId: row!.id, code, lines: balances.length };
}

// Lưu số đếm (null = chưa đếm dòng đó)
export async function saveStockCountQty(tx: Tx, countId: string, entries: { lineId: string; countedQty: number | null; reason?: string | null }[]): Promise<void> {
  const [count] = await tx.select({ status: stockCounts.status }).from(stockCounts).where(eq(stockCounts.id, countId));
  if (!count) throw new UserError("Không tìm thấy phiếu kiểm kê");
  if (count.status !== "draft") throw new UserError(STALE_MESSAGE);
  for (const e of entries) {
    if (e.countedQty !== null && (!Number.isSafeInteger(e.countedQty) || e.countedQty < 0)) throw new UserError("Số đếm không hợp lệ");
    await tx
      .update(stockCountLines)
      .set({ countedQty: e.countedQty, reason: e.reason ?? null })
      .where(and(eq(stockCountLines.id, e.lineId), eq(stockCountLines.countId, countId)));
  }
}

// Ghi sổ: chênh lệch = số đếm − số dư hiện tại lúc ghi sổ (khóa dòng số dư). Có chênh lệch thì cần inventory.approve.
export async function postStockCount(tx: Tx, countId: string, actorId: string): Promise<{ movementIds: string[]; warnings: string[]; diffs: number }> {
  const count = await tx.query.stockCounts.findFirst({ where: eq(stockCounts.id, countId) });
  if (!count) throw new UserError("Không tìm thấy phiếu kiểm kê");
  if (count.status !== "draft") throw new UserError(STALE_MESSAGE);
  const lines = (await tx.select().from(stockCountLines).where(eq(stockCountLines.countId, countId))).filter((l) => l.countedQty !== null);
  const itemRows = lines.length
    ? await tx.select({ id: inventoryItems.id, baseUom: inventoryItems.baseUom, displayUom: inventoryItems.displayUom }).from(inventoryItems).where(inArray(inventoryItems.id, [...new Set(lines.map((l) => l.itemId))]))
    : [];
  const items = new Map(itemRows.map((i) => [i.id, i]));

  const warnings: string[] = [];
  const moves: StockMoveInput[] = [];
  // Khóa số dư theo thứ tự (vị trí, lô) để đọc đúng số hiện tại
  for (const l of [...lines].sort((a, b) => (a.locationId + a.stockLotId < b.locationId + b.stockLotId ? -1 : 1))) {
    const [bal] = await tx
      .select({ qty: stockBalances.qty })
      .from(stockBalances)
      .where(and(eq(stockBalances.locationId, l.locationId), eq(stockBalances.stockLotId, l.stockLotId)))
      .for("update");
    const current = bal?.qty ?? 0;
    const item = items.get(l.itemId)!;
    const f = (q: number) => formatQty(q, item.baseUom, item.displayUom as DisplayUom).replace(/ [^ ]+$/, "");
    if (current !== l.systemQty) warnings.push(`Số dư đã đổi từ lúc tạo phiếu (${f(l.systemQty)} → ${f(current)})`);
    const diff = l.countedQty! - current;
    if (diff !== 0) moves.push({ type: "count_adjust", stockLotId: l.stockLotId, locationId: l.locationId, qty: diff, note: l.reason ?? null });
  }

  if (moves.length) {
    const [actor] = await tx.select({ role: staffUsers.role }).from(staffUsers).where(eq(staffUsers.id, actorId));
    if (!actor || !can(actor.role as StaffRole, "inventory.approve")) throw new UserError("Phiếu có chênh lệch, cần người có quyền duyệt kho ghi sổ");
  }

  const now = new Date();
  const [claimed] = await tx
    .update(stockCounts)
    .set({ status: "posted", postedBy: actorId, postedAt: now, approvedBy: moves.length ? actorId : null })
    .where(and(eq(stockCounts.id, countId), eq(stockCounts.status, "draft")))
    .returning({ id: stockCounts.id });
  if (!claimed) throw new UserError(STALE_MESSAGE);

  const r = await postMovements(tx, { docType: "count", docId: countId, docCode: count.code, actorId }, moves);
  await writeAudit(tx, { actorId, action: "stock_count.posted", entity: "stock_counts", entityId: countId, before: { status: "draft" }, after: { status: "posted", diffs: moves.length } });
  return { movementIds: r.movementIds, warnings, diffs: moves.length };
}

export async function cancelStockCount(tx: Tx, countId: string, actorId: string): Promise<void> {
  const [row] = await tx
    .update(stockCounts)
    .set({ status: "cancelled" })
    .where(and(eq(stockCounts.id, countId), eq(stockCounts.status, "draft")))
    .returning({ id: stockCounts.id });
  if (!row) throw new UserError(STALE_MESSAGE);
  await writeAudit(tx, { actorId, action: "stock_count.cancelled", entity: "stock_counts", entityId: countId, before: { status: "draft" }, after: { status: "cancelled" } });
}
