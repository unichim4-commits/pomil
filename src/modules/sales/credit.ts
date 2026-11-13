// Dư nợ đại lý cho hạn mức công nợ (R-BH-9). Chỉ đọc; orders/service và sales/orders gọi.
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { dealers, orders, receivables } from "@/db/schema";
import { UserError } from "@/lib/errors";
import { creditLimitProblem } from "./rules";

// Dư nợ = phải thu còn lại của đại lý + tổng total các đơn credit confirmed/packing/shipping chưa có khoản phải thu
export async function dealerOutstanding(db: Db | Tx, dealerId: string, excludeOrderId?: string | null): Promise<{ receivable: number; openOrders: number; total: number }> {
  const [r] = await db
    .select({ v: sql<string>`coalesce(sum(${receivables.amount} - ${receivables.paidAmount}), 0)` })
    .from(receivables)
    .where(and(eq(receivables.dealerId, dealerId), inArray(receivables.status, ["open", "partial"])));
  const [o] = await db
    .select({ v: sql<string>`coalesce(sum(${orders.total}), 0)` })
    .from(orders)
    .leftJoin(receivables, eq(receivables.orderId, orders.id))
    .where(
      and(
        eq(orders.dealerId, dealerId),
        eq(orders.paymentMethod, "credit"),
        inArray(orders.status, ["confirmed", "packing", "shipping"]),
        isNull(receivables.id),
        excludeOrderId ? ne(orders.id, excludeOrderId) : undefined,
      ),
    );
  const receivable = Number(r?.v ?? 0);
  const openOrders = Number(o?.v ?? 0);
  return { receivable, openOrders, total: receivable + openOrders };
}

// Kiểm hạn mức lúc tạo và lúc xác nhận đơn credit. Khóa dòng đại lý để hai đơn cùng lúc chạy lần lượt.
export async function assertCreditLimit(tx: Tx, dealerId: string, newTotal: number, excludeOrderId?: string | null): Promise<void> {
  const [dealer] = await tx.select({ creditLimit: dealers.creditLimit }).from(dealers).where(eq(dealers.id, dealerId)).for("update");
  if (!dealer) throw new UserError("Không tìm thấy đại lý");
  const outstanding = await dealerOutstanding(tx, dealerId, excludeOrderId);
  const problem = creditLimitProblem({ creditLimit: dealer.creditLimit, outstanding: outstanding.total, newTotal });
  if (problem) throw new UserError(problem);
}
