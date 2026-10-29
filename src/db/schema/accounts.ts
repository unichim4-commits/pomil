import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { products } from "./catalog";
import { customers } from "./customers";

// Tài khoản khách trên website: đăng nhập bằng số điện thoại và mật khẩu.
// Mỗi khách (customers) có tối đa một tài khoản.
export const customerAccounts = pgTable(
  "customer_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    // scrypt, cùng định dạng với tài khoản nhân viên (src/modules/auth/password.ts)
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customer_accounts_customer_uq").on(t.customerId)],
);

// Phiên đăng nhập của khách. Chỉ lưu SHA-256 của mã phiên, mã gốc nằm trong cookie.
export const customerSessions = pgTable(
  "customer_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("customer_sessions_account_idx").on(t.accountId)],
);

// new: chờ xem · published: hiện trên trang sản phẩm · hidden: chỉ dùng nội bộ
export const reviewStatus = pgEnum("review_status", ["new", "published", "hidden"]);

// Đánh giá sản phẩm của khách. Mục đích chính là nghe khách để sửa sản phẩm;
// chỉ hiện công khai khi khách đồng ý và nhân viên đã duyệt câu chữ.
export const productReviews = pgTable(
  "product_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    // 1–5 sao
    rating: integer("rating").notNull(),
    // Mùi hương 1–5
    scentRating: integer("scent_rating"),
    // Cảm giác trên da đầu sau khi dùng: diu | binh_thuong | bet | kho | ngua
    scalpFeel: text("scalp_feel"),
    // co | chua_chac | khong
    wouldRebuy: text("would_rebuy"),
    // Đã dùng bao lâu: duoi_1_tuan | 1_4_tuan | tren_1_thang
    usedFor: text("used_for"),
    comment: text("comment").notNull().default(""),
    // Góp ý để Pomil sửa sản phẩm, không bao giờ hiện công khai
    suggestion: text("suggestion").notNull().default(""),
    publishConsent: boolean("publish_consent").notNull().default(false),
    // Đã mua sản phẩm này qua tài khoản và đơn đã giao
    verifiedPurchase: boolean("verified_purchase").notNull().default(false),
    status: reviewStatus("status").notNull().default("new"),
    staffNote: text("staff_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("product_reviews_account_product_uq").on(t.accountId, t.productId),
    index("product_reviews_product_status_idx").on(t.productId, t.status),
  ],
);
