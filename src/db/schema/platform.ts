import { boolean, customType, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  },
});

// owner: toàn quyền, quản lý nhân viên và cài đặt · collaborator: đơn, sản phẩm, nội dung, lô
// viewer: chỉ xem, số điện thoại bị che
export const staffRole = pgEnum("staff_role", ["owner", "collaborator", "viewer"]);

export const staffUsers = pgTable("staff_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  role: staffRole("role").notNull().default("viewer"),
  // scrypt, dạng scrypt$N$r$p$salt$hash (xem src/modules/auth/password.ts)
  passwordHash: text("password_hash").notNull(),
  // Khóa TOTP base32. Có totpEnabledAt thì bắt buộc nhập mã khi đăng nhập.
  totpSecret: text("totp_secret"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Phiên đăng nhập quản trị. Chỉ lưu SHA-256 của mã phiên, mã gốc nằm trong cookie.
export const staffSessions = pgTable(
  "staff_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    // false khi đã qua mật khẩu nhưng chưa nhập mã 2 lớp
    mfaPassed: boolean("mfa_passed").notNull().default(false),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("staff_sessions_staff_idx").on(t.staffId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null khi hệ thống tự làm (ví dụ ngưỡng phản ánh giữ lô) hoặc khách tự thao tác
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_at_idx").on(t.at)],
);

// Tệp tải lên (ảnh sản phẩm, ảnh bài viết). Ở quy mô hiện tại lưu thẳng trong cơ sở dữ liệu
// để chạy được mọi nơi; khi nhiều ảnh thì chuyển sang kho tệp và để data = null.
export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  storagePath: text("storage_path"),
  data: bytea("data"),
  originalName: text("original_name"),
  size: integer("size"),
  sha256: text("sha256").notNull(),
  contentType: text("content_type").notNull(),
  uploadedBy: uuid("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

// Nhật ký gửi thông báo cho chủ cửa hàng (đơn mới, phản ánh, giữ lô). Giữ nội dung để gửi lại khi lỗi.
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event: text("event").notNull(),
    entityId: uuid("entity_id"),
    // email | zalo
    channel: text("channel").notNull(),
    recipient: text("recipient").notNull(),
    // sent | failed | skipped
    status: text("status").notNull(),
    error: text("error"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    attempts: integer("attempts").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("notification_log_created_idx").on(t.createdAt), index("notification_log_status_idx").on(t.status)],
);
