import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Utm } from "@/lib/utm";

// Vòng đời khách (SYS-2)
export const lifecycleStage = pgEnum("lifecycle_stage", [
  "lead",
  "tester",
  "first_buyer",
  "repeat_buyer",
  "ambassador",
  "churned",
]);

// Mục đích đồng ý (SYS-20). Mỗi mục đích một dòng riêng trong consents.
export const consentPurpose = pgEnum("consent_purpose", [
  "marketing_message",
  "photo_use",
  "trial_participation",
  "data_processing",
]);

export const consentChannel = pgEnum("consent_channel", ["zalo", "sms", "email", "any"]);

export type ScalpProfile = {
  concerns?: string[];
  washFrequency?: string;
  dailyHelmet?: boolean;
  sensitive?: boolean;
};

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Khóa chính nghiệp vụ: số điện thoại dạng 84xxxxxxxxx
    phoneE164: text("phone_e164"),
    zaloUserId: text("zalo_user_id"),
    name: text("name"),
    lifecycleStage: lifecycleStage("lifecycle_stage").notNull().default("lead"),
    scalpProfile: jsonb("scalp_profile").$type<ScalpProfile>().notNull().default({}),
    firstTouchUtm: jsonb("first_touch_utm").$type<Utm>(),
    lastTouchUtm: jsonb("last_touch_utm").$type<Utm>(),
    landingVariant: text("landing_variant"),
    referralCode: text("referral_code").notNull(),
    referredByCustomerId: uuid("referred_by_customer_id"),
    kocId: uuid("koc_id"),
    expectedRunoutDate: timestamp("expected_runout_date", { withTimezone: true }),
    // Ẩn danh hóa khi khách yêu cầu xóa: giữ dòng để sổ sách còn đúng
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customers_phone_uq").on(t.phoneE164),
    uniqueIndex("customers_zalo_uq").on(t.zaloUserId),
    uniqueIndex("customers_referral_code_uq").on(t.referralCode),
    index("customers_stage_idx").on(t.lifecycleStage),
  ],
);

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    purpose: consentPurpose("purpose").notNull(),
    channel: consentChannel("channel").notNull().default("any"),
    granted: boolean("granted").notNull(),
    policyVersion: text("policy_version").notNull(),
    // Nơi thu: waitlist, lot_page, trial_form, admin...
    source: text("source").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    // Bằng chứng: câu chữ hiển thị, IP rút gọn, user agent
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("consents_customer_purpose_idx").on(t.customerId, t.purpose)],
);

// Dòng thời gian tương tác của khách
export const touchpoints = pgTable(
  "touchpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("touchpoints_customer_idx").on(t.customerId, t.occurredAt)],
);
