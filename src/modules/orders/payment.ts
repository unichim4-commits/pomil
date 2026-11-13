// Thanh toán đơn (00-tong-quan.md mục 8.6, 04-ban-hang.md R-BH-18).
// Nơi duy nhất ghi orders.payment_status (setPaymentStatus cũ gọi lại hàm này).
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { cashTransactions, orderEvents, orders, returnRequests } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { cancelCashTransaction, recordCashTransaction } from "@/modules/finance/ledger";
import { orderCashAmount } from "@/modules/finance/ledger-rules";
import { vnToday } from "@/modules/numbering";

export type PaymentMethod = "cod" | "bank_transfer" | "cash" | "platform" | "credit";
type PayStatus = "unpaid" | "paid" | "refunded";
type PaySource = "staff" | "cod_delivery" | "receivable" | "return_request";

// Cùng câu với STALE_ORDER ở service.ts (không import để tránh vòng service → payment → service)
const STALE = "Đơn vừa được người khác cập nhật, tải lại trang.";

// bank_transfer→NH, cod→COD, cash→TM, platform/credit→null (đi công nợ)
export function paymentAccountCode(method: PaymentMethod): "NH" | "COD" | "TM" | null {
  switch (method) {
    case "bank_transfer":
      return "NH";
    case "cod":
      return "COD";
    case "cash":
      return "TM";
    default:
      return null;
  }
}

// platform, credit → true
export function usesReceivable(method: PaymentMethod): boolean {
  return method === "platform" || method === "credit";
}

// Kiểm chuyển trạng thái thanh toán (R-BH-18). Trả null nếu được, không thì câu lỗi.
export function paymentTransitionProblem(method: PaymentMethod, from: PayStatus, to: PayStatus, source: PaySource): string | null {
  if (from === to) return null;
  if (usesReceivable(method) && (source === "staff" || source === "cod_delivery")) return "Đơn công nợ: thu tiền ở mục Công nợ";
  if (from === "refunded") return "Đơn đã hoàn tiền, không đổi được trạng thái thanh toán";
  if (from === "unpaid" && to === "refunded") return "Đơn chưa thu tiền, không hoàn được";
  return null;
}

export const orderPaidKey = (orderId: string) => `order-paid:${orderId}`;
export const orderRefundKey = (orderId: string) => `order-refund:${orderId}`;

// Nguồn staff, cod_delivery ghi/hủy phiếu thu chi; receivable, return_request chỉ đổi trạng thái (R-BH-18)
export async function applyOrderPaymentStatus(
  tx: Tx,
  orderId: string,
  to: "unpaid" | "paid" | "refunded",
  actorId: string | null,
  opts: { source: "staff" | "cod_delivery" | "receivable" | "return_request"; expectedFrom?: "unpaid" | "paid" | "refunded" },
): Promise<{ ok: true; changed: boolean } | { ok: false; message: string }> {
  // Khóa dòng đơn: hai lời gọi cùng lúc chạy lần lượt, lời gọi sau thấy trạng thái mới
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) return { ok: false, message: "Không tìm thấy đơn" };
  const from = order.paymentStatus;
  if (opts.expectedFrom && opts.expectedFrom !== from) return { ok: false, message: STALE };
  if (from === to) return { ok: true, changed: false };
  const problem = paymentTransitionProblem(order.paymentMethod, from, to, opts.source);
  if (problem) return { ok: false, message: problem };

  const now = new Date();
  const changed = await tx
    .update(orders)
    .set({ paymentStatus: to, paidAt: to === "paid" ? now : order.paidAt, updatedAt: now })
    .where(and(eq(orders.id, orderId), eq(orders.paymentStatus, from)))
    .returning({ id: orders.id });
  if (changed.length === 0) return { ok: false, message: STALE };

  // Tiền: chỉ nguồn staff và cod_delivery. Lỗi ở đây (ví dụ tiền mặt không đủ để hoàn) ném UserError,
  // người gọi để cả giao dịch hủy, kể cả dòng cập nhật đơn ở trên.
  let cashNote = "";
  if (opts.source === "staff" || opts.source === "cod_delivery") {
    cashNote = await writeOrderCash(tx, order, from, to, actorId);
  }

  const label = { unpaid: "chưa thanh toán", paid: "đã thanh toán", refunded: "đã hoàn tiền" } as const;
  await tx.insert(orderEvents).values({ orderId, type: "payment", note: `Thanh toán: ${label[from]} → ${label[to]}${cashNote}`, actorId });
  await writeAudit(tx, {
    actorId,
    action: "order.payment",
    entity: "orders",
    entityId: orderId,
    before: { paymentStatus: from },
    after: { paymentStatus: to, source: opts.source },
  });
  return { ok: true, changed: true };
}

async function refundedViaReturns(tx: Tx, orderId: string): Promise<number> {
  const [row] = await tx
    .select({ sum: sql<string>`coalesce(sum(${returnRequests.refundAmount}), 0)` })
    .from(returnRequests)
    .where(and(eq(returnRequests.orderId, orderId), eq(returnRequests.status, "completed")));
  return Number(row?.sum ?? 0);
}

async function writeOrderCash(tx: Tx, order: typeof orders.$inferSelect, from: PayStatus, to: PayStatus, actorId: string | null): Promise<string> {
  const counterparty = { type: "customer" as const, id: order.customerId, name: order.recipientName };
  const source = { type: "order", id: order.id, code: order.code };

  if (from === "unpaid" && to === "paid") {
    const accountCode = paymentAccountCode(order.paymentMethod);
    const amount = orderCashAmount(order.total, await refundedViaReturns(tx, order.id));
    if (!accountCode || amount <= 0) return "";
    const cash = await recordCashTransaction(
      tx,
      { direction: "in", accountCode, amount, categoryCode: "THU-BAN-HANG", occurredOn: vnToday(), counterparty, source, idempotencyKey: orderPaidKey(order.id) },
      actorId,
    );
    return ` (phiếu thu ${cash.code})`;
  }

  if (from === "paid" && to === "unpaid") {
    // Sửa nhầm: hủy phiếu thu của đơn (đơn cũ trước khi có sổ quỹ thì không có phiếu)
    const res = await cancelCashTransaction(tx, { idempotencyKey: orderPaidKey(order.id) }, "Sửa nhầm trạng thái thanh toán đơn", actorId);
    return res.cancelled ? " (đã hủy phiếu thu)" : "";
  }

  if (from === "paid" && to === "refunded") {
    const amount = orderCashAmount(order.total, await refundedViaReturns(tx, order.id));
    if (amount <= 0) return "";
    // Cùng tài khoản đã thu; đơn cũ không có phiếu thu thì theo phương thức
    const [receipt] = await tx
      .select({ accountId: cashTransactions.accountId })
      .from(cashTransactions)
      .where(and(eq(cashTransactions.idempotencyKey, orderPaidKey(order.id)), inArray(cashTransactions.status, ["posted", "pending_approval"])));
    const accountCode = paymentAccountCode(order.paymentMethod);
    if (!receipt && !accountCode) throw new UserError("Không xác định được tài khoản để hoàn tiền");
    const cash = await recordCashTransaction(
      tx,
      {
        direction: "out",
        accountId: receipt?.accountId ?? null,
        accountCode: receipt ? null : accountCode,
        amount,
        categoryCode: "CHI-HOAN-TIEN",
        occurredOn: vnToday(),
        counterparty,
        source,
        idempotencyKey: orderRefundKey(order.id),
      },
      actorId,
    );
    return ` (phiếu chi ${cash.code})`;
  }
  return "";
}
