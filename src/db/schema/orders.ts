import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Utm } from "@/lib/utm";
import { products } from "./catalog";
import { customerAccounts } from "./accounts";
import { customers } from "./customers";
import { lots } from "./quality";

export const orderStatus = pgEnum("order_status", ["pending", "confirmed", "packing", "shipping", "delivered", "cancelled", "returned"]);
export const paymentMethod = pgEnum("payment_method", ["cod", "bank_transfer"]);
export const paymentStatus = pgEnum("payment_status", ["unpaid", "paid", "refunded"]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // KÊNH-YYMM-NNNN, ví dụ WEB-2711-0001
    code: text("code").notNull().unique(),
    channel: text("channel").notNull().default("WEB"),
    customerId: uuid("customer_id").references(() => customers.id),
    // Đặt khi khách đang đăng nhập: đơn hiện trong trang Tài khoản. Đơn khách vãng lai để null.
    accountId: uuid("account_id").references(() => customerAccounts.id, { onDelete: "set null" }),
    status: orderStatus("status").notNull().default("pending"),
    paymentMethod: paymentMethod("payment_method").notNull(),
    paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
    recipientName: text("recipient_name").notNull(),
    phoneE164: text("phone_e164").notNull(),
    email: text("email"),
    province: text("province").notNull(),
    ward: text("ward").notNull(),
    addressLine: text("address_line").notNull(),
    customerNote: text("customer_note"),
    subtotal: integer("subtotal").notNull(),
    shippingFee: integer("shipping_fee").notNull(),
    total: integer("total").notNull(),
    utm: jsonb("utm").$type<Utm>(),
    // Mã bí mật để khách xem đơn qua đường dẫn, không cần đăng nhập
    accessToken: text("access_token").notNull(),
    carrier: text("carrier"),
    trackingNo: text("tracking_no"),
    internalNote: text("internal_note"),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [index("orders_status_created_idx").on(t.status, t.createdAt), index("orders_phone_idx").on(t.phoneE164), index("orders_account_idx").on(t.accountId, t.createdAt)],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    // Chụp lại tên và giá lúc đặt để sổ sách không đổi khi sửa sản phẩm
    productName: text("product_name").notNull(),
    unitPrice: integer("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotal: integer("line_total").notNull(),
    // Gán khi đóng gói để truy được chai nào thuộc lô nào
    lotId: uuid("lot_id").references(() => lots.id),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

// Dòng thời gian của đơn: đổi trạng thái, ghi chú, thanh toán
export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    actorId: uuid("actor_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.at)],
);
