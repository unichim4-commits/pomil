import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { products } from "./catalog";
import { customers } from "./customers";
import { stockReceipts } from "./inventory";
import { orderItems, orders } from "./orders";
import { complaints } from "./quality";

// Phân hệ Bán hàng (00 mục 3.5). orders.channel giữ kiểu text, không FK tới sales_channels.

export const channelKind = pgEnum("channel_kind", ["own_web", "marketplace", "social", "dealer", "direct"]);
export const priceListKind = pgEnum("price_list_kind", ["retail", "wholesale", "dealer", "promo"]);
export const dealerStatus = pgEnum("dealer_status", ["active", "paused", "ended"]);
export const voucherKind = pgEnum("voucher_kind", ["percent", "amount"]);
export const returnReason = pgEnum("return_reason", ["defect", "wrong_item", "damaged", "changed_mind", "other"]);
export const returnStatus = pgEnum("return_status", ["requested", "approved", "received", "completed", "rejected", "cancelled"]);
export const returnResolution = pgEnum("return_resolution", ["refund", "exchange", "none"]);
export const returnCondition = pgEnum("return_condition", ["intact", "damaged", "defective"]);
export const returnDisposition = pgEnum("return_disposition", ["restock", "quarantine"]);

export const salesChannels = pgTable(
  "sales_channels",
  {
    // WEB, SHP, TTS, FB, ZL, DL, TT; là tiền tố mã đơn
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    kind: channelKind("kind").notNull(),
    // Phí nền tảng mặc định (bp)
    feeRateBp: integer("fee_rate_bp").notNull().default(0),
    // Số ngày sàn trả tiền sau giao
    payoutDays: integer("payout_days").notNull().default(0),
    priceListId: uuid("price_list_id").references((): AnyPgColumn => priceLists.id),
    // P1 chỉ hiển thị
    apiStatus: text("api_status").notNull().default("not_connected"),
    // WEB không tắt được
    isActive: boolean("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("sales_channels_fee_rate_chk", sql`${t.feeRateBp} >= 0 and ${t.feeRateBp} <= 10000`),
    check("sales_channels_payout_days_chk", sql`${t.payoutDays} >= 0`),
  ],
);

export const priceLists = pgTable("price_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: priceListKind("kind").notNull(),
  channelCode: text("channel_code").references(() => salesChannels.code),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  priority: integer("priority").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const priceListItems = pgTable(
  "price_list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    unitPrice: integer("unit_price").notNull(),
    minQty: integer("min_qty").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("price_list_items_uq").on(t.priceListId, t.productId, t.minQty),
    check("price_list_items_price_chk", sql`${t.unitPrice} >= 0`),
    check("price_list_items_min_qty_chk", sql`${t.minQty} >= 1`),
  ],
);

export const productBundles = pgTable(
  "product_bundles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    channelCode: text("channel_code"),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("product_bundles_price_chk", sql`${t.price} >= 0`)],
);

export const productBundleItems = pgTable(
  "product_bundle_items",
  {
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => productBundles.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    qty: integer("qty").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.bundleId, t.productId] }), check("product_bundle_items_qty_chk", sql`${t.qty} > 0`)],
);

export const vouchers = pgTable(
  "vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Chữ hoa
    code: text("code").notNull().unique(),
    kind: voucherKind("kind").notNull(),
    // percent: bp; amount: đồng
    value: integer("value").notNull(),
    minOrder: integer("min_order").notNull().default(0),
    maxDiscount: integer("max_discount"),
    channelCode: text("channel_code"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    usageLimit: integer("usage_limit"),
    usedCount: integer("used_count").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("vouchers_value_chk", sql`${t.value} > 0`), check("vouchers_used_count_chk", sql`${t.usedCount} >= 0`)],
);

// Đại lý, nhà phân phối, salon
export const dealers = pgTable(
  "dealers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // DL-001
    code: text("code").notNull().unique(),
    // Liên hệ chính, để gom lịch sử đơn
    customerId: uuid("customer_id").references(() => customers.id),
    name: text("name").notNull(),
    tier: text("tier").notNull().default(""),
    contactName: text("contact_name"),
    phoneE164: text("phone_e164"),
    email: text("email"),
    address: text("address"),
    taxCode: text("tax_code"),
    contractNo: text("contract_no"),
    contractStart: date("contract_start"),
    contractEnd: date("contract_end"),
    contractFileIds: jsonb("contract_file_ids").$type<string[]>().notNull().default([]),
    priceListId: uuid("price_list_id").references(() => priceLists.id),
    discountBp: integer("discount_bp").notNull().default(0),
    commissionBp: integer("commission_bp").notNull().default(0),
    // 0 = không cho mua chịu
    creditLimit: integer("credit_limit").notNull().default(0),
    paymentTermsDays: integer("payment_terms_days").notNull().default(0),
    status: dealerStatus("status").notNull().default("active"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("dealers_discount_chk", sql`${t.discountBp} >= 0 and ${t.discountBp} <= 10000`),
    check("dealers_commission_chk", sql`${t.commissionBp} >= 0 and ${t.commissionBp} <= 10000`),
    check("dealers_credit_limit_chk", sql`${t.creditLimit} >= 0`),
  ],
);

// Đổi trả
export const returnRequests = pgTable(
  "return_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // DT-2611-001
    code: text("code").notNull().unique(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    customerId: uuid("customer_id").references(() => customers.id),
    dealerId: uuid("dealer_id").references(() => dealers.id),
    reason: returnReason("reason").notNull(),
    reasonNote: text("reason_note").notNull().default(""),
    status: returnStatus("status").notNull().default("requested"),
    resolution: returnResolution("resolution").notNull().default("refund"),
    // Tiền hàng hoàn
    refundAmount: integer("refund_amount").notNull().default(0),
    // Chi phí phát sinh (ship hoàn)
    extraCost: integer("extra_cost").notNull().default(0),
    // → cash_accounts (không FK)
    refundAccountId: uuid("refund_account_id"),
    // Phiếu nhập hàng trả
    receiptId: uuid("receipt_id").references(() => stockReceipts.id),
    replacementOrderId: uuid("replacement_order_id").references(() => orders.id),
    complaintId: uuid("complaint_id").references(() => complaints.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("return_requests_order_idx").on(t.orderId),
    index("return_requests_status_idx").on(t.status, t.requestedAt),
    check("return_requests_refund_chk", sql`${t.refundAmount} >= 0`),
    check("return_requests_extra_cost_chk", sql`${t.extraCost} >= 0`),
  ],
);

export const returnRequestLines = pgTable(
  "return_request_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => returnRequests.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id),
    qty: integer("qty").notNull(),
    condition: returnCondition("condition"),
    disposition: returnDisposition("disposition"),
    refundAmount: integer("refund_amount").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("return_request_lines_return_idx").on(t.returnId), check("return_request_lines_qty_chk", sql`${t.qty} > 0`)],
);
