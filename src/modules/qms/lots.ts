// Khóa lô vật tư (R-CL-22) và xuất mẫu lưu (R-CL-25).
import { and, desc, eq, gt } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { inventoryItems, lots, retainedSamples, stockBalances, stockLots, warehouses } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { postIssue, setStockLotQcStatus } from "@/modules/inventory/ledger";
import { actorCan, PERMISSION_DENIED, type Actor } from "./rules";

// Khóa lô vật tư: quality.write; mở khóa về released: quality.approve
export async function setStockLotHold(tx: Tx, stockLotId: string, hold: boolean, reason: string | null, actor: Actor): Promise<void> {
  if (!actorCan(actor, hold ? "quality.write" : "quality.approve")) throw new UserError(PERMISSION_DENIED);
  const [sl] = await tx.select({ qcStatus: stockLots.qcStatus }).from(stockLots).where(eq(stockLots.id, stockLotId));
  if (!sl) throw new UserError("Không tìm thấy lô");
  if (hold && sl.qcStatus !== "released") throw new UserError("Chỉ khóa được lô đang dùng được");
  if (!hold && sl.qcStatus !== "on_hold") throw new UserError("Lô không ở trạng thái khóa");
  await setStockLotQcStatus(tx, stockLotId, hold ? "on_hold" : "released", reason, actor.id);
}

// Xuất mẫu lưu lô thành phẩm: phiếu xuất qc_sample + retained_samples gắn stock_issue_id
export async function createRetainedSample(
  tx: Tx,
  input: { lotId: string; units: number; location: string; keepUntil: string; note?: string | null },
  actor: Actor,
): Promise<{ sampleId: string; issueId: string; issueCode: string; status: "posted" | "pending_approval" }> {
  if (!actorCan(actor, "quality.write")) throw new UserError(PERMISSION_DENIED);
  if (!Number.isInteger(input.units) || input.units <= 0) throw new UserError("Số chai mẫu phải lớn hơn 0");
  if (!input.location.trim()) throw new UserError("Ghi vị trí lưu mẫu");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.keepUntil)) throw new UserError("Ngày giữ đến chưa đúng");
  const [lot] = await tx.select({ id: lots.id, lotNo: lots.lotNo }).from(lots).where(eq(lots.id, input.lotId));
  if (!lot) throw new UserError("Không tìm thấy lô");
  // Lô kho thành phẩm còn tồn ở kho FG
  const [bal] = await tx
    .select({ stockLotId: stockBalances.stockLotId, itemId: stockLots.itemId, warehouseId: stockBalances.warehouseId, qty: stockBalances.qty })
    .from(stockBalances)
    .innerJoin(stockLots, eq(stockLots.id, stockBalances.stockLotId))
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
    .where(and(eq(stockLots.productLotId, lot.id), eq(warehouses.kind, "finished"), gt(stockBalances.qty, 0)))
    .orderBy(desc(stockBalances.qty))
    .limit(1);
  if (!bal) throw new UserError(`Lô ${lot.lotNo} không còn tồn ở kho thành phẩm`);
  const issue = await postIssue(
    tx,
    { kind: "qc_sample", warehouseId: bal.warehouseId, purpose: `Mẫu lưu lô ${lot.lotNo}`, note: input.note ?? null, lines: [{ itemId: bal.itemId, qty: input.units, stockLotId: bal.stockLotId }] },
    actor.id,
  );
  const [s] = await tx
    .insert(retainedSamples)
    .values({ lotId: lot.id, units: input.units, location: input.location.trim(), keepUntil: input.keepUntil, stockIssueId: issue.issueId })
    .returning({ id: retainedSamples.id });
  await writeAudit(tx, { actorId: actor.id, action: "retained_sample.created", entity: "retained_samples", entityId: s!.id, after: { lotId: lot.id, units: input.units, issue: issue.code, status: issue.status } });
  return { sampleId: s!.id, issueId: issue.issueId, issueCode: issue.code, status: issue.status };
}
