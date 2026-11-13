// Thu hồi lô (03-chat-luong.md R-CL-23, R-CL-24). Phần mềm không gửi tin cho khách.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { lots, ncrs, orderItems, products, recallContacts, recallLots, recalls, stockLots } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { receiveOrderReturn, syncSellableStock, transferLotBalance } from "@/modules/inventory/ledger";
import { nextDocCode } from "@/modules/numbering/service";
import { actorCan, checkRecallClose, DOC_STALE, PERMISSION_DENIED, recallReturnRate, type Actor, type NcrSeverity, type RecallContactStatus } from "./rules";
import { lotBalance, ordersOfLots, recalledReturnQty } from "./trace";

function need(actor: Actor, p: "quality.write" | "quality.approve") {
  if (!actorCan(actor, p)) throw new UserError(PERMISSION_DENIED);
}

// Mở hồ sơ (quality.approve): lô → recalled, tồn sang REJ, số bán được tính lại, danh sách liên hệ theo đơn
export async function openRecall(tx: Tx, input: { reason: string; severity: NcrSeverity; lotIds: string[]; ncrId?: string | null; note?: string | null }, actor: Actor): Promise<{ id: string; code: string; contacts: number; movedQty: number }> {
  need(actor, "quality.approve");
  const reason = input.reason.trim();
  if (!reason) throw new UserError("Ghi lý do thu hồi");
  const lotIds = [...new Set(input.lotIds)];
  if (lotIds.length === 0) throw new UserError("Chọn ít nhất một lô");
  if (input.ncrId) {
    const [n] = await tx.select({ id: ncrs.id }).from(ncrs).where(eq(ncrs.id, input.ncrId));
    if (!n) throw new UserError("Không tìm thấy NCR");
  }
  const code = await nextDocCode(tx, "TH");
  const [rec] = await tx
    .insert(recalls)
    .values({ code, reason, severity: input.severity, ncrId: input.ncrId ?? null, openedBy: actor.id, note: input.note ?? null })
    .returning({ id: recalls.id });
  const recallId = rec!.id;
  let movedQty = 0;
  const productIds = new Set<string>();
  for (const lotId of lotIds) {
    const [before] = await tx.select({ lotNo: lots.lotNo, status: lots.releaseStatus }).from(lots).where(eq(lots.id, lotId));
    if (!before) throw new UserError("Không tìm thấy lô");
    const [lot] = await tx
      .update(lots)
      .set({ releaseStatus: "recalled", holdReason: `Thu hồi ${code}: ${reason}` })
      .where(and(eq(lots.id, lotId), inArray(lots.releaseStatus, ["released", "on_hold"])))
      .returning({ id: lots.id, productId: lots.productId });
    if (!lot) throw new UserError(`Lô ${before.lotNo} không ở trạng thái đang bán hoặc đang giữ, không thu hồi được`);
    productIds.add(lot.productId);
    await writeAudit(tx, { actorId: actor.id, action: "lot.recalled", entity: "lots", entityId: lotId, before: { releaseStatus: before.status }, after: { releaseStatus: "recalled", recall: code } });
    await tx.insert(recallLots).values({ recallId, lotId });
    for (const s of await tx.select({ id: stockLots.id }).from(stockLots).where(eq(stockLots.productLotId, lotId))) {
      movedQty += (await transferLotBalance(tx, { stockLotId: s.id, toWarehouseKind: "rejected", reason: `Thu hồi ${code}`, source: { type: "recall", id: recallId } }, actor.id)).qty;
    }
  }
  for (const pid of [...productIds].sort()) await syncSellableStock(tx, pid);
  const contacts = await ordersOfLots(tx, lotIds, true);
  const seen = new Set<string>();
  for (const c of contacts) {
    if (seen.has(c.orderId)) continue;
    seen.add(c.orderId);
    await tx.insert(recallContacts).values({ recallId, orderId: c.orderId, customerId: c.customerId, dealerId: c.dealerId }).onConflictDoNothing();
  }
  await writeAudit(tx, { actorId: actor.id, action: "recall.opened", entity: "recalls", entityId: recallId, after: { code, lots: lotIds.length, contacts: seen.size, movedQty } });
  return { id: recallId, code, contacts: seen.size, movedQty };
}

// Ghi kết quả liên hệ (quality.write). Hồ sơ open → in_progress
export async function recordRecallContact(tx: Tx, contactId: string, input: { status: Exclude<RecallContactStatus, "pending">; note?: string | null }, actor: Actor): Promise<void> {
  need(actor, "quality.write");
  const [c] = await tx.select().from(recallContacts).where(eq(recallContacts.id, contactId));
  if (!c) throw new UserError("Không tìm thấy liên hệ");
  const [r] = await tx.select({ status: recalls.status }).from(recalls).where(eq(recalls.id, c.recallId));
  if (!r || r.status === "closed") throw new UserError("Hồ sơ thu hồi đã đóng");
  await tx
    .update(recallContacts)
    .set({ status: input.status, note: input.note?.trim() || c.note, contactedAt: c.contactedAt ?? new Date() })
    .where(eq(recallContacts.id, contactId));
  await tx.update(recalls).set({ status: "in_progress" }).where(and(eq(recalls.id, c.recallId), eq(recalls.status, "open")));
  await writeAudit(tx, { actorId: actor.id, action: "recall.contact", entity: "recall_contacts", entityId: contactId, before: { status: c.status }, after: { status: input.status } });
}

// Nhận hàng khách gửi về: nhập cách ly qua receiveOrderReturn (nguồn recall), liên hệ → returned
export async function receiveRecallReturn(tx: Tx, contactId: string, lines: { orderItemId: string; qty: number }[], actor: Actor): Promise<{ receiptId: string; code: string }> {
  need(actor, "quality.write");
  const [c] = await tx.select().from(recallContacts).where(eq(recallContacts.id, contactId));
  if (!c) throw new UserError("Không tìm thấy liên hệ");
  const [r] = await tx.select({ id: recalls.id, code: recalls.code, status: recalls.status }).from(recalls).where(eq(recalls.id, c.recallId));
  if (!r || r.status === "closed") throw new UserError("Hồ sơ thu hồi đã đóng");
  const recalledLots = new Set((await tx.select({ lotId: recallLots.lotId }).from(recallLots).where(eq(recallLots.recallId, r.id))).map((x) => x.lotId));
  const items = await tx.select({ id: orderItems.id, lotId: orderItems.lotId }).from(orderItems).where(eq(orderItems.orderId, c.orderId));
  const valid = lines.filter((l) => l.qty > 0);
  if (valid.length === 0) throw new UserError("Nhập số chai nhận về");
  for (const l of valid) {
    const it = items.find((i) => i.id === l.orderItemId);
    if (!it || !it.lotId || !recalledLots.has(it.lotId)) throw new UserError("Dòng hàng không thuộc lô thu hồi của đơn này");
  }
  const res = await receiveOrderReturn(tx, { orderId: c.orderId, source: { type: "recall", id: r.id, code: r.code }, lines: valid.map((l) => ({ ...l, disposition: "quarantine" as const })) }, actor.id);
  await tx.update(recallContacts).set({ status: "returned", contactedAt: c.contactedAt ?? new Date() }).where(eq(recallContacts.id, contactId));
  await tx.update(recalls).set({ status: "in_progress" }).where(and(eq(recalls.id, r.id), eq(recalls.status, "open")));
  await writeAudit(tx, { actorId: actor.id, action: "recall.received", entity: "recall_contacts", entityId: contactId, after: { receipt: res.code, qty: valid.reduce((s, l) => s + l.qty, 0) } });
  return res;
}

// Đóng (quality.approve) khi không còn liên hệ pending
export async function closeRecall(tx: Tx, recallId: string, actor: Actor, note?: string | null): Promise<void> {
  need(actor, "quality.approve");
  const [r] = await tx.select().from(recalls).where(eq(recalls.id, recallId));
  if (!r) throw new UserError("Không tìm thấy hồ sơ thu hồi");
  if (r.status === "closed") throw new UserError(DOC_STALE);
  const contacts = await tx.select({ status: recallContacts.status }).from(recallContacts).where(eq(recallContacts.recallId, recallId));
  const err = checkRecallClose(contacts);
  if (err) throw new UserError(err);
  const [row] = await tx
    .update(recalls)
    .set({ status: "closed", closedBy: actor.id, closedAt: new Date(), note: note?.trim() ? (r.note ? `${r.note}\n${note.trim()}` : note.trim()) : r.note })
    .where(and(eq(recalls.id, recallId), eq(recalls.status, r.status)))
    .returning({ id: recalls.id });
  if (!row) throw new UserError(DOC_STALE);
  await writeAudit(tx, { actorId: actor.id, action: "recall.closed", entity: "recalls", entityId: recallId, before: { status: r.status }, after: { status: "closed" } });
}

export type RecallLotStat = { lotId: string; lotNo: string; productName: string; sold: number; onHand: number; recovered: number; rate: number | null };

// R-CL-24: đã bán ròng, còn trong kho, đã thu về, tỷ lệ
export async function recallStats(db: Db | Tx, recallId: string): Promise<RecallLotStat[]> {
  const rl = await db
    .select({ lotId: recallLots.lotId, lotNo: lots.lotNo, productName: products.name })
    .from(recallLots)
    .innerJoin(lots, eq(lots.id, recallLots.lotId))
    .innerJoin(products, eq(products.id, lots.productId))
    .where(eq(recallLots.recallId, recallId))
    .orderBy(asc(lots.lotNo));
  const out: RecallLotStat[] = [];
  for (const l of rl) {
    const b = await lotBalance(db, l.lotId);
    const recovered = await recalledReturnQty(db, l.lotId, recallId);
    out.push({ ...l, sold: b.sold, onHand: b.onHand, recovered, rate: recallReturnRate(b.sold, recovered) });
  }
  return out;
}
