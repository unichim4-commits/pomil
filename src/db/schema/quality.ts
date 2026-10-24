import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { products } from "./catalog";
import { customers } from "./customers";

// Bản tối thiểu của kho hồ sơ (SYS-29), đủ để kiểm tra phiếu công bố khi duyệt lô.
// Kho hồ sơ đầy đủ vẫn ở Notion (POM-101).
export const notifications = pgTable("cosmetic_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  number: text("number").notNull(),
  issuedAt: date("issued_at").notNull(),
  expiresAt: date("expires_at").notNull(),
  fileId: uuid("file_id"),
});

export const lotReleaseStatus = pgEnum("lot_release_status", ["quarantine", "released", "on_hold", "recalled"]);

export const lots = pgTable(
  "lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // PST-YYMMDD-NN, in trên chai và nằm trong địa chỉ trang lô
    lotNo: text("lot_no").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    // Phiên bản công thức dạng PST-vN; sổ công thức đầy đủ vẫn ở Notion (POM-102)
    formulaVersion: text("formula_version").notNull(),
    factory: text("factory"),
    manufacturedOn: date("manufactured_on").notNull(),
    expiresOn: date("expires_on").notNull(),
    unitsProduced: integer("units_produced").notNull(),
    releaseStatus: lotReleaseStatus("release_status").notNull().default("quarantine"),
    releasedBy: uuid("released_by"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    holdReason: text("hold_reason"),
    // Chỉ hiện trên trang lô khi bật
    isPublic: boolean("is_public").notNull().default(false),
    publicInfo: jsonb("public_info").$type<LotPublicInfo>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lots_lot_no_uq").on(t.lotNo)],
);

export type LotPublicInfo = {
  pomeloOrigin?: string;
  harvestSeason?: string;
  oilMainComponents?: { name: string; percent: number }[];
  photos?: string[];
  note?: string;
};

// Nguyên liệu đã dùng cho lô. Sổ vật tư đầy đủ vẫn ở Notion (POM-96), nên ở đây ghi theo mã.
export const lotMaterials = pgTable("lot_materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id")
    .notNull()
    .references(() => lots.id, { onDelete: "cascade" }),
  materialCode: text("material_code").notNull(),
  supplierLotNo: text("supplier_lot_no"),
  coaFileId: uuid("coa_file_id"),
  quantity: text("quantity"),
});

export const lotTestType = pgEnum("lot_test_type", ["microbial", "heavy_metals", "stability", "gc_ms", "irritation", "sensory"]);
export const lotTestResult = pgEnum("lot_test_result", ["pass", "fail", "pending"]);

export const lotTests = pgTable(
  "lot_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    type: lotTestType("type").notNull(),
    result: lotTestResult("result").notNull().default("pending"),
    lab: text("lab"),
    reportNo: text("report_no"),
    fileId: uuid("file_id"),
    // Có hiện phiếu này trên trang lô không
    isPublic: boolean("is_public").notNull().default(true),
    testedOn: date("tested_on"),
  },
  (t) => [index("lot_tests_lot_idx").on(t.lotId)],
);

export const retainedSamples = pgTable("retained_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id")
    .notNull()
    .references(() => lots.id, { onDelete: "cascade" }),
  units: integer("units").notNull(),
  location: text("location").notNull(),
  keepUntil: date("keep_until").notNull(),
});

export const complaintSeverity = pgEnum("complaint_severity", ["mild", "moderate", "severe"]);
export const complaintStatus = pgEnum("complaint_status", ["open", "responded", "investigating", "closed"]);

export const complaints = pgTable(
  "complaints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id),
    lotId: uuid("lot_id").references(() => lots.id),
    // Số lô khách gõ, giữ lại cả khi không khớp lô nào (gõ nhầm, lô chưa nhập) để quản trị hỏi lại
    reportedLotNo: text("reported_lot_no"),
    // Khi đang thử mẫu chưa có lô: mã mẫu mù, ví dụ A, B, C
    sampleCode: text("sample_code"),
    contactPhone: text("contact_phone"),
    startedUsingOn: date("started_using_on"),
    symptoms: text("symptoms").notNull(),
    severity: complaintSeverity("severity").notNull(),
    photoFileIds: jsonb("photo_file_ids").$type<string[]>().notNull().default([]),
    status: complaintStatus("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    rootCause: text("root_cause"),
    correctiveAction: text("corrective_action"),
  },
  (t) => [index("complaints_lot_opened_idx").on(t.lotId, t.openedAt)],
);
