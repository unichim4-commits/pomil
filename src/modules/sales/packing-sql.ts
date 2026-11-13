// Điều kiện SQL "đã gói" / "chờ đóng gói" dùng chung cho danh sách đóng gói và cảnh báo.
// Cùng nghĩa với isOrderPacked / awaitsPacking trong orders/rules.ts (R-BH-13); đổi điều kiện thì đổi cả hai.
import { and, eq, inArray, not, or, sql, type SQL } from "drizzle-orm";
import { orderEvents, orders } from "@/db/schema";

const hasPackedEvent: SQL = sql`exists (select 1 from ${orderEvents} where ${orderEvents.orderId} = ${orders.id} and ${orderEvents.type} = 'packed')`;

// Đã gói: "Đang đóng gói" và đã có sự kiện "packed" hoặc đã xuất kho
export const orderPackedSql: SQL = and(eq(orders.status, "packing"), or(sql`${orders.stockIssuedAt} is not null`, hasPackedEvent))!;

// Chờ đóng gói: đã xác nhận, hoặc "Đang đóng gói" mà chưa gói thật
export const awaitsPackingSql: SQL = and(inArray(orders.status, ["confirmed", "packing"]), not(orderPackedSql))!;
