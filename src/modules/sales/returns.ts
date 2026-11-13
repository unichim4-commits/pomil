import "server-only";
// Đổi trả (R-BH-19…R-BH-25): tiếp nhận → duyệt → nhận hàng (nhập kho/cách ly) → hoàn tất (hoàn tiền, chi phí, đổi hàng).
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import { cashAccounts, lots, orderEvents, orderItems, orders, products, returnRequestLines, returnRequests, settings } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { adjustDebtAmount, findDebtBySource, recordCashTransaction } from "@/modules/finance/ledger";
import { receiveOrderReturn } from "@/modules/inventory/ledger";
import { nextDocCode, vnToday } from "@/modules/numbering";
import { applyOrderPaymentStatus, paymentAccountCode } from "@/modules/orders/payment";
import { submitComplaint } from "@/modules/quality/service";
import { ERP_SETTINGS_KEY, parseErpSettings } from "@/modules/settings/erp-schema";
import { assertCan, type Actor } from "./access";
import { createExchangeOrderInTx } from "./orders";
import {
  canReturnTransition,
  defaultRefund,
  dispositionProblem,
  isFullReturn,
  maxRefund,
  returnLinesProblem,
  returnWindowProblem,
  splitRefund,
  RETURN_STATUS_LABEL,
  type ReturnCondition,
  type ReturnDisposition,
  type ReturnReason,
  type ReturnResolution,
  type ReturnStatus,
} from "./rules";

const STALE = "Đổi trả vừa được người khác cập nhật, tải lại trang.";
const LIVE_STATUSES: ReturnStatus[] = ["requested", "approved", "received", "completed"];

export const rmaRefundKey = (id: string) => `rma-refund:${id}`;
export const rmaCostKey = (id: string) => `rma-cost:${id}`;

type Ok<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function run<T extends object>(fn: (tx: Tx) => Promise<T>): Promise<Ok<T>> {
  const db = await getDb();
  try {
    const r = await db.transaction(fn);
    return { ok: true, ...r };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, message: error.message };
    throw error;
  }
}

// Số đã trả theo dòng ở các đổi trả chưa hủy/từ chối (trừ một đổi trả nếu cần)
async function returnedQtyByItem(tx: Tx, orderId: string, excludeReturnId?: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ orderItemId: returnRequestLines.orderItemId, qty: sql<number>`coalesce(sum(${returnRequestLines.qty}), 0)::int` })
    .from(returnRequestLines)
    .innerJoin(returnRequests, eq(returnRequests.id, returnRequestLines.returnId))
    .where(and(eq(returnRequests.orderId, orderId), inArray(returnRequests.status, LIVE_STATUSES), excludeReturnId ? ne(returnRequests.id, excludeReturnId) : undefined))
    .groupBy(returnRequestLines.orderItemId);
  return new Map(rows.map((r) => [r.orderItemId, Number(r.qty)]));
}

async function refundedBefore(tx: Tx, orderId: string, excludeReturnId?: string): Promise<number> {
  const [row] = await tx
    .select({ v: sql<string>`coalesce(sum(${returnRequests.refundAmount}), 0)` })
    .from(returnRequests)
    .where(and(eq(returnRequests.orderId, orderId), inArray(returnRequests.status, LIVE_STATUSES), excludeReturnId ? ne(returnRequests.id, excludeReturnId) : undefined));
  return Number(row?.v ?? 0);
}

// Dữ liệu form tạo đổi trả: dòng của đơn, số còn trả được
export async function getReturnDraft(orderId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return null;
    const items = await tx
      .select({ id: orderItems.id, productName: orderItems.productName, unitPrice: orderItems.unitPrice, quantity: orderItems.quantity, lotNo: lots.lotNo })
      .from(orderItems)
      .leftJoin(lots, eq(lots.id, orderItems.lotId))
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.productName), asc(orderItems.id));
    const returned = await returnedQtyByItem(tx, orderId);
    const before = await refundedBefore(tx, orderId);
    return { order, items: items.map((i) => ({ ...i, returnable: Math.max(0, i.quantity - (returned.get(i.id) ?? 0)) })), refundedBefore: before, maxRefund: maxRefund(order.total, before) };
  });
}

export type CreateReturnInput = {
  orderId: string;
  reason: ReturnReason;
  reasonNote: string;
  resolution: ReturnResolution;
  lines: { orderItemId: string; qty: number }[];
  // null → mặc định R-BH-21
  refundAmount: number | null;
  extraCost: number;
  note: string | null;
};

// R-BH-19, R-BH-21
export async function createReturnRequest(input: CreateReturnInput, actor: Actor): Promise<Ok<{ id: string; code: string; refundAmount: number }>> {
  assertCan(actor, "sales.write");
  return run(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!order) throw new UserError("Không tìm thấy đơn");
    if (order.status !== "delivered") throw new UserError("Chỉ tạo đổi trả cho đơn đã giao");
    const [erpRow] = await tx.select().from(settings).where(eq(settings.key, ERP_SETTINGS_KEY));
    const erp = parseErpSettings(erpRow?.value);
    const late = returnWindowProblem(order.deliveredAt, erp.returnWindowDays, vnToday());
    if (late && actor.role !== "owner") throw new UserError(late);

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const returned = await returnedQtyByItem(tx, order.id);
    const lines = input.lines.filter((l) => l.qty > 0);
    const checked = [];
    for (const l of lines) {
      const it = items.find((i) => i.id === l.orderItemId);
      if (!it) throw new UserError("Dòng không thuộc đơn này");
      checked.push({ orderItemId: it.id, qty: l.qty, name: it.productName, deliveredQty: it.quantity, alreadyReturned: returned.get(it.id) ?? 0, unitPrice: it.unitPrice });
    }
    const problem = returnLinesProblem(checked);
    if (problem) throw new UserError(problem);

    const before = await refundedBefore(tx, order.id);
    const max = maxRefund(order.total, before);
    const suggested = Math.min(max, defaultRefund({ lines: checked, subtotal: order.subtotal, discountTotal: order.discountTotal }));
    const refundAmount = input.resolution === "refund" ? (input.refundAmount ?? suggested) : (input.refundAmount ?? 0);
    if (!Number.isSafeInteger(refundAmount) || refundAmount < 0) throw new UserError("Tiền hoàn phải là số không âm");
    if (refundAmount > max) throw new UserError(`Tiền hoàn tối đa ${max.toLocaleString("vi-VN")}đ`);
    if (!Number.isSafeInteger(input.extraCost) || input.extraCost < 0) throw new UserError("Chi phí phát sinh phải là số không âm");

    const code = await nextDocCode(tx, "DT");
    const [row] = await tx
      .insert(returnRequests)
      .values({
        code,
        orderId: order.id,
        customerId: order.customerId,
        dealerId: order.dealerId,
        reason: input.reason,
        reasonNote: input.reasonNote.trim(),
        resolution: input.resolution,
        refundAmount,
        extraCost: input.extraCost,
        note: input.note?.trim() || null,
        createdBy: actor.id,
      })
      .returning({ id: returnRequests.id });
    // Phân bổ tiền hoàn cho từng dòng theo cùng cách tính (tham khảo)
    await tx.insert(returnRequestLines).values(
      checked.map((c) => ({
        returnId: row!.id,
        orderItemId: c.orderItemId,
        qty: c.qty,
        refundAmount: defaultRefund({ lines: [c], subtotal: order.subtotal, discountTotal: order.discountTotal }),
      })),
    );
    await tx.insert(orderEvents).values({ orderId: order.id, type: "return_requested", note: `Đổi trả ${code}${late ? " (quá hạn, chủ cửa hàng tạo)" : ""}`, actorId: actor.id });
    await writeAudit(tx, { actorId: actor.id, action: "return_request.created", entity: "return_requests", entityId: row!.id, after: { code, orderId: order.id, reason: input.reason, refundAmount, lines: checked.map((c) => ({ orderItemId: c.orderItemId, qty: c.qty })) } });
    return { id: row!.id, code, refundAmount };
  });
}

async function lockReturn(tx: Tx, id: string) {
  const [r] = await tx.select().from(returnRequests).where(eq(returnRequests.id, id)).for("update");
  if (!r) throw new UserError("Không tìm thấy đổi trả");
  return r;
}

async function moveStatus(tx: Tx, r: typeof returnRequests.$inferSelect, to: ReturnStatus, patch: Partial<typeof returnRequests.$inferInsert>, actor: Actor, note?: string | null) {
  if (!canReturnTransition(r.status, to)) throw new UserError(`Không chuyển được từ “${RETURN_STATUS_LABEL[r.status]}” sang “${RETURN_STATUS_LABEL[to]}”`);
  const changed = await tx
    .update(returnRequests)
    .set({ ...patch, status: to, updatedAt: new Date() })
    .where(and(eq(returnRequests.id, r.id), eq(returnRequests.status, r.status)))
    .returning({ id: returnRequests.id });
  if (changed.length === 0) throw new UserError(STALE);
  await writeAudit(tx, { actorId: actor.id, action: `return_request.${to}`, entity: "return_requests", entityId: r.id, before: { status: r.status }, after: { status: to, note: note ?? null } });
}

export async function approveReturn(id: string, actor: Actor): Promise<Ok> {
  assertCan(actor, "sales.write");
  return run(async (tx) => {
    const r = await lockReturn(tx, id);
    await moveStatus(tx, r, "approved", { approvedBy: actor.id, approvedAt: new Date() }, actor);
    return {};
  });
}

export async function cancelReturn(id: string, actor: Actor): Promise<Ok> {
  assertCan(actor, "sales.write");
  return run(async (tx) => {
    const r = await lockReturn(tx, id);
    await moveStatus(tx, r, "cancelled", {}, actor);
    return {};
  });
}

export async function rejectReturn(id: string, reason: string, actor: Actor): Promise<Ok> {
  assertCan(actor, "sales.write");
  if (!reason.trim()) return { ok: false, message: "Ghi lý do từ chối" };
  return run(async (tx) => {
    const r = await lockReturn(tx, id);
    // Đã nhận hàng thì hàng vẫn ở kho đã nhập
    await moveStatus(tx, r, "rejected", { note: [r.note, `Từ chối: ${reason.trim()}`].filter(Boolean).join("\n") }, actor, reason.trim());
    return {};
  });
}

// R-BH-20: nhận hàng trả, kiểm từng dòng, nhập kho hoặc cách ly
export async function receiveReturn(id: string, lines: { lineId: string; condition: ReturnCondition | null; disposition: ReturnDisposition | null }[], actor: Actor): Promise<Ok> {
  assertCan(actor, "sales.write");
  return run(async (tx) => {
    const r = await lockReturn(tx, id);
    if (r.status !== "approved") throw new UserError("Chỉ nhận hàng cho đổi trả đã duyệt");
    const rows = await tx
      .select({ line: returnRequestLines, productId: orderItems.productId, track: products.trackInventory, name: orderItems.productName })
      .from(returnRequestLines)
      .innerJoin(orderItems, eq(orderItems.id, returnRequestLines.orderItemId))
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(eq(returnRequestLines.returnId, id));
    const decided = rows.map((row) => {
      const given = lines.find((l) => l.lineId === row.line.id);
      const problem = dispositionProblem(given?.condition ?? null, given?.disposition ?? null);
      if (problem) throw new UserError(`${row.name}: ${problem}`);
      return { ...row, condition: given!.condition!, disposition: given!.disposition! };
    });
    await moveStatus(tx, r, "received", { receivedAt: new Date() }, actor);
    for (const d of decided) {
      await tx.update(returnRequestLines).set({ condition: d.condition, disposition: d.disposition }).where(eq(returnRequestLines.id, d.line.id));
    }
    const [order] = await tx.select().from(orders).where(eq(orders.id, r.orderId));
    const tracked = decided.filter((d) => d.track);
    let receiptId: string | null = null;
    if (tracked.length) {
      const rc = await receiveOrderReturn(
        tx,
        { orderId: r.orderId, source: { type: "return_request", id: r.id, code: r.code }, lines: tracked.map((d) => ({ orderItemId: d.line.orderItemId, qty: d.line.qty, disposition: d.disposition })) },
        actor.id,
      );
      receiptId = rc.receiptId;
      await tx.update(returnRequests).set({ receiptId }).where(eq(returnRequests.id, r.id));
    }
    // Sản phẩm chưa bật quản lý kho: restock cộng stock kiểu cũ, quarantine không cộng
    for (const d of decided.filter((x) => !x.track && x.disposition === "restock")) {
      await tx
        .update(products)
        .set({ stock: sql`${products.stock} + ${d.line.qty}` })
        .where(eq(products.id, d.productId));
      await writeAudit(tx, { actorId: actor.id, action: "product.stock_returned", entity: "products", entityId: d.productId, after: { qty: d.line.qty, returnCode: r.code } });
    }
    await tx.insert(orderEvents).values({ orderId: r.orderId, type: "return_received", note: `Nhận hàng đổi trả ${r.code}`, actorId: actor.id });
    void order;
    return {};
  });
}

export type CompleteReturnInput = {
  refundAmount?: number | null;
  extraCost?: number | null;
  refundAccountId?: string | null;
  exchangeLines?: { productId: string; qty: number }[];
  exchangeShippingFee?: number;
};

// R-BH-22…R-BH-24: hoàn tất
export async function completeReturn(id: string, input: CompleteReturnInput, actor: Actor): Promise<Ok<{ replacementOrderCode: string | null }>> {
  assertCan(actor, "sales.write");
  return run(async (tx) => {
    const r = await lockReturn(tx, id);
    if (r.status !== "received") throw new UserError("Chỉ hoàn tất đổi trả đã nhận hàng");
    const [order] = await tx.select().from(orders).where(eq(orders.id, r.orderId)).for("update");
    if (!order) throw new UserError("Không tìm thấy đơn");

    const refund = input.refundAmount ?? r.refundAmount;
    const extraCost = input.extraCost ?? r.extraCost;
    if (!Number.isSafeInteger(refund) || refund < 0) throw new UserError("Tiền hoàn phải là số không âm");
    if (!Number.isSafeInteger(extraCost) || extraCost < 0) throw new UserError("Chi phí phát sinh phải là số không âm");
    const max = maxRefund(order.total, await refundedBefore(tx, order.id, r.id));
    if (refund > max) throw new UserError(`Tiền hoàn tối đa ${max.toLocaleString("vi-VN")}đ`);
    if (refund > 0 || extraCost > 0) assertCan(actor, "finance.write", "Hoàn tiền và chi phí đổi trả cần quyền tài chính (chủ cửa hàng)");

    let refundAccountId = input.refundAccountId ?? r.refundAccountId ?? null;
    if (refundAccountId) {
      const [acc] = await tx.select({ id: cashAccounts.id }).from(cashAccounts).where(eq(cashAccounts.id, refundAccountId));
      if (!acc) throw new UserError("Không tìm thấy tài khoản tiền");
    }
    await moveStatus(tx, r, "completed", { completedAt: new Date(), refundAmount: refund, extraCost, refundAccountId }, actor);

    const today = vnToday();
    const counterparty = order.dealerId ? { type: "dealer" as const, id: order.dealerId, name: order.recipientName } : { type: "customer" as const, id: order.customerId, name: order.recipientName };
    const source = { type: "return_request", id: r.id, code: r.code };
    const accountRef = () => (refundAccountId ? { accountId: refundAccountId } : { accountCode: paymentAccountCode(order.paymentMethod) ?? "TM" });

    // R-BH-22: tiền hoàn
    if (refund > 0) {
      const debt = await findDebtBySource(tx, { kind: "receivable", orderId: order.id });
      const live = debt && debt.status !== "cancelled" ? debt : null;
      let cashOut = 0;
      if (live) {
        const split = splitRefund(refund, live);
        if (split.reduceDebt > 0) await adjustDebtAmount(tx, { kind: "receivable", debtId: live.id, newAmount: live.amount - split.reduceDebt, reason: `Đổi trả ${r.code}` }, actor.id);
        cashOut = split.cashOut;
      } else if (order.paymentStatus === "paid") {
        cashOut = refund;
      }
      if (cashOut > 0) {
        await recordCashTransaction(
          tx,
          { direction: "out", ...accountRef(), amount: cashOut, categoryCode: "CHI-HOAN-TIEN", occurredOn: today, counterparty, source, idempotencyKey: rmaRefundKey(r.id), note: `Hoàn tiền đổi trả ${r.code} đơn ${order.code}` },
          actor.id,
        );
      }
    }
    // R-BH-23: chi phí phát sinh
    if (extraCost > 0) {
      await recordCashTransaction(
        tx,
        { direction: "out", ...accountRef(), amount: extraCost, categoryCode: "CHI-VAN-CHUYEN", occurredOn: today, counterparty, source, idempotencyKey: rmaCostKey(r.id), note: `Chi phí đổi trả ${r.code}` },
        actor.id,
      );
    }
    // R-BH-24: đổi hàng
    let replacementOrderCode: string | null = null;
    if (r.resolution === "exchange") {
      let lines = input.exchangeLines?.filter((l) => l.qty > 0) ?? [];
      if (lines.length === 0) {
        const rl = await tx
          .select({ productId: orderItems.productId, qty: returnRequestLines.qty })
          .from(returnRequestLines)
          .innerJoin(orderItems, eq(orderItems.id, returnRequestLines.orderItemId))
          .where(eq(returnRequestLines.returnId, r.id));
        lines = rl;
      }
      const ex = await createExchangeOrderInTx(tx, { originalOrderId: order.id, lines, shippingFee: input.exchangeShippingFee ?? 0, returnCode: r.code }, actor.id);
      await tx.update(returnRequests).set({ replacementOrderId: ex.orderId }).where(eq(returnRequests.id, r.id));
      replacementOrderCode = ex.code;
    }

    // Trả đủ mọi chai → đơn returned (customer_return), không nhập kho lần hai
    const items = await tx.select({ id: orderItems.id, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, order.id));
    const completedRows = await tx
      .select({ orderItemId: returnRequestLines.orderItemId, qty: sql<number>`coalesce(sum(${returnRequestLines.qty}), 0)::int` })
      .from(returnRequestLines)
      .innerJoin(returnRequests, eq(returnRequests.id, returnRequestLines.returnId))
      .where(and(eq(returnRequests.orderId, order.id), eq(returnRequests.status, "completed")))
      .groupBy(returnRequestLines.orderItemId);
    const done = new Map(completedRows.map((x) => [x.orderItemId, Number(x.qty)]));
    if (order.status === "delivered" && isFullReturn(items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })), done)) {
      const changed = await tx
        .update(orders)
        .set({ status: "returned", returnType: "customer_return", updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), eq(orders.status, "delivered")))
        .returning({ id: orders.id });
      if (changed.length === 0) throw new UserError(STALE);
      await tx.insert(orderEvents).values({ orderId: order.id, type: "status", fromStatus: "delivered", toStatus: "returned", note: `Trả đủ hàng qua đổi trả ${r.code}`, actorId: actor.id });
      await writeAudit(tx, { actorId: actor.id, action: "order.status", entity: "orders", entityId: order.id, before: { status: "delivered" }, after: { status: "returned", returnType: "customer_return", returnCode: r.code } });
      const [fresh] = await tx.select({ paymentStatus: orders.paymentStatus }).from(orders).where(eq(orders.id, order.id));
      if (fresh?.paymentStatus === "paid") {
        const p = await applyOrderPaymentStatus(tx, order.id, "refunded", actor.id, { source: "return_request" });
        if (!p.ok) throw new UserError(p.message);
      }
    }
    await tx.insert(orderEvents).values({ orderId: order.id, type: "return_completed", note: `Hoàn tất đổi trả ${r.code}${refund ? `, hoàn ${refund.toLocaleString("vi-VN")}đ` : ""}${replacementOrderCode ? `, đơn đổi ${replacementOrderCode}` : ""}`, actorId: actor.id });
    return { replacementOrderCode };
  });
}

// R-BH-25: tạo phản ánh từ đổi trả lỗi sản phẩm (gắn số lô của dòng)
export async function createComplaintFromReturn(id: string, actor: Actor): Promise<Ok<{ complaintId: string }>> {
  assertCan(actor, "sales.write");
  const db = await getDb();
  const [r] = await db.select().from(returnRequests).where(eq(returnRequests.id, id));
  if (!r) return { ok: false, message: "Không tìm thấy đổi trả" };
  if (r.reason !== "defect") return { ok: false, message: "Chỉ tạo phản ánh cho đổi trả lý do lỗi sản phẩm" };
  if (r.complaintId) return { ok: true, complaintId: r.complaintId };
  const [line] = await db
    .select({ lotNo: lots.lotNo })
    .from(returnRequestLines)
    .innerJoin(orderItems, eq(orderItems.id, returnRequestLines.orderItemId))
    .leftJoin(lots, eq(lots.id, orderItems.lotId))
    .where(eq(returnRequestLines.returnId, id))
    .orderBy(sql`${lots.lotNo} is null`)
    .limit(1);
  const [order] = await db.select({ phone: orders.phoneE164, code: orders.code }).from(orders).where(eq(orders.id, r.orderId));
  const res = await submitComplaint({
    lotNo: line?.lotNo ?? null,
    sampleCode: null,
    contactPhone: order?.phone || null,
    startedUsingOn: null,
    symptoms: `Đổi trả ${r.code} (đơn ${order?.code ?? ""}): ${r.reasonNote || "lỗi sản phẩm"}`,
    severity: "mild",
  });
  await db.transaction(async (tx) => {
    await tx.update(returnRequests).set({ complaintId: res.complaintId, updatedAt: new Date() }).where(eq(returnRequests.id, id));
    await writeAudit(tx, { actorId: actor.id, action: "return_request.complaint", entity: "return_requests", entityId: id, after: { complaintId: res.complaintId, lotHeld: res.lotHeld } });
  });
  return { ok: true, complaintId: res.complaintId };
}

export async function listReturns(filter: { status?: ReturnStatus; reason?: ReturnReason }) {
  const db = await getDb();
  return db
    .select({ r: returnRequests, orderCode: orders.code, recipientName: orders.recipientName, channel: orders.channel })
    .from(returnRequests)
    .innerJoin(orders, eq(orders.id, returnRequests.orderId))
    .where(and(filter.status ? eq(returnRequests.status, filter.status) : undefined, filter.reason ? eq(returnRequests.reason, filter.reason) : undefined))
    .orderBy(desc(returnRequests.requestedAt))
    .limit(200);
}

export async function listReturnsForOrder(orderId: string) {
  const db = await getDb();
  return db.select().from(returnRequests).where(eq(returnRequests.orderId, orderId)).orderBy(desc(returnRequests.requestedAt));
}

export async function getReturn(id: string) {
  const db = await getDb();
  const [r] = await db.select().from(returnRequests).where(eq(returnRequests.id, id));
  if (!r) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, r.orderId));
  const lines = await db
    .select({ line: returnRequestLines, productName: orderItems.productName, productId: orderItems.productId, unitPrice: orderItems.unitPrice, lotNo: lots.lotNo })
    .from(returnRequestLines)
    .innerJoin(orderItems, eq(orderItems.id, returnRequestLines.orderItemId))
    .leftJoin(lots, eq(lots.id, orderItems.lotId))
    .where(eq(returnRequestLines.returnId, id))
    .orderBy(asc(orderItems.productName));
  const replacement = r.replacementOrderId ? (await db.select({ id: orders.id, code: orders.code }).from(orders).where(eq(orders.id, r.replacementOrderId)))[0] : null;
  const accounts = await db.select({ id: cashAccounts.id, code: cashAccounts.code, name: cashAccounts.name }).from(cashAccounts).where(eq(cashAccounts.isActive, true));
  const activeProducts = await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.status, "active"));
  return { r, order: order!, lines, replacement: replacement ?? null, accounts, products: activeProducts };
}

export async function countOpenReturns(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(returnRequests)
    .where(notInArray(returnRequests.status, ["completed", "rejected", "cancelled"]));
  return Number(row?.n ?? 0);
}
