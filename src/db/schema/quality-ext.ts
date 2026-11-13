import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { products } from "./catalog";
import { customers } from "./customers";
import { inventoryItems, stockLots, stockReceiptLines, stockReceipts, suppliers } from "./inventory";
import { orders } from "./orders";
import { extractionRuns, productionOrderSteps, productionOrders } from "./production";
import { complaints, lotTestType, lots } from "./quality";
import { dealers, returnRequests } from "./sales";

// Phân hệ Chất lượng mở rộng (00 mục 3.6): tiêu chuẩn, phiếu kiểm, NCR, CAPA, thu hồi.

export const qcAppliesTo = pgEnum("qc_applies_to", ["raw_material", "extract", "wip", "finished", "packaging"]);
export const qcStandardStatus = pgEnum("qc_standard_status", ["draft", "active", "archived"]);
export const qcParamKind = pgEnum("qc_param_kind", ["range", "pass_fail", "text"]);
export const qcParamGroup = pgEnum("qc_param_group", ["origin", "sensory", "physicochemical", "composition", "microbial", "heavy_metal", "stability", "packaging", "label", "other"]);
export const inspectionStage = pgEnum("inspection_stage", ["iqc", "ipqc", "fqc", "recheck"]);
export const inspectionStatus = pgEnum("inspection_status", ["pending", "passed", "failed", "cancelled"]);
export const inspectionDisposition = pgEnum("inspection_disposition", ["accept", "reject", "use_as_is", "return_to_supplier"]);
export const ncrCategory = pgEnum("ncr_category", ["material", "extract", "process", "product", "packaging", "supplier", "customer_complaint", "other"]);
export const ncrSeverity = pgEnum("ncr_severity", ["minor", "major", "critical"]);
export const ncrStatus = pgEnum("ncr_status", ["open", "investigating", "action", "verifying", "closed", "cancelled"]);
export const capaType = pgEnum("capa_type", ["corrective", "preventive"]);
export const capaStatus = pgEnum("capa_status", ["open", "in_progress", "verifying", "closed", "cancelled"]);
export const recallStatus = pgEnum("recall_status", ["open", "in_progress", "closed"]);
export const recallContactStatus = pgEnum("recall_contact_status", ["pending", "contacted", "returned", "unreachable", "refused"]);

export const qcStandards = pgTable(
  "qc_standards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // TC-001
    code: text("code").notNull(),
    version: integer("version").notNull().default(1),
    name: text("name").notNull(),
    appliesTo: qcAppliesTo("applies_to").notNull(),
    itemId: uuid("item_id").references(() => inventoryItems.id),
    productId: uuid("product_id").references(() => products.id),
    status: qcStandardStatus("status").notNull().default("draft"),
    effectiveFrom: date("effective_from"),
    fileIds: jsonb("file_ids").$type<string[]>().notNull().default([]),
    note: text("note"),
    createdBy: uuid("created_by"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("qc_standards_code_version_uq").on(t.code, t.version),
    // Một bản active mỗi mã
    uniqueIndex("qc_standards_active_uq").on(t.code).where(sql`${t.status} = 'active'`),
  ],
);

export const qcStandardParams = pgTable(
  "qc_standard_params",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    standardId: uuid("standard_id")
      .notNull()
      .references(() => qcStandards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    paramGroup: qcParamGroup("param_group").notNull(),
    kind: qcParamKind("kind").notNull(),
    unit: text("unit").notNull().default(""),
    // Giá trị × 1000
    minMilli: bigint("min_milli", { mode: "number" }),
    maxMilli: bigint("max_milli", { mode: "number" }),
    expectedText: text("expected_text"),
    method: text("method").notNull().default(""),
    // Nối lot_tests khi FQC
    lotTestType: lotTestType("lot_test_type"),
    isCritical: boolean("is_critical").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("qc_standard_params_standard_idx").on(t.standardId)],
);

// Phiếu kiểm IQC/IPQC/FQC/kiểm lại
export const qcInspections = pgTable(
  "qc_inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // IQC-2611-001, IPQC-…, FQC-…, KTL-…
    code: text("code").notNull().unique(),
    stage: inspectionStage("stage").notNull(),
    status: inspectionStatus("status").notNull().default("pending"),
    standardId: uuid("standard_id").references(() => qcStandards.id),
    stockReceiptId: uuid("stock_receipt_id").references(() => stockReceipts.id),
    stockReceiptLineId: uuid("stock_receipt_line_id").references(() => stockReceiptLines.id),
    stockLotId: uuid("stock_lot_id").references(() => stockLots.id),
    lotId: uuid("lot_id").references(() => lots.id),
    productionOrderId: uuid("production_order_id").references(() => productionOrders.id),
    productionStepId: uuid("production_step_id").references(() => productionOrderSteps.id),
    extractionRunId: uuid("extraction_run_id").references(() => extractionRuns.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    complaintId: uuid("complaint_id").references(() => complaints.id),
    sampleSize: text("sample_size").notNull().default(""),
    inspectedBy: uuid("inspected_by"),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    disposition: inspectionDisposition("disposition"),
    decisionNote: text("decision_note"),
    fileIds: jsonb("file_ids").$type<string[]>().notNull().default([]),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qc_inspections_stage_status_idx").on(t.stage, t.status),
    // Mỗi lô một phiếu đang chờ cho mỗi công đoạn
    uniqueIndex("qc_inspections_pending_stock_lot_uq").on(t.stage, t.stockLotId).where(sql`${t.status} = 'pending' and ${t.stockLotId} is not null`),
    uniqueIndex("qc_inspections_pending_lot_uq").on(t.stage, t.lotId).where(sql`${t.status} = 'pending' and ${t.lotId} is not null`),
  ],
);

// Kết quả từng chỉ tiêu; các cột tiêu chuẩn chụp lại lúc tạo phiếu
export const qcInspectionResults = pgTable(
  "qc_inspection_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inspectionId: uuid("inspection_id")
      .notNull()
      .references(() => qcInspections.id, { onDelete: "cascade" }),
    paramId: uuid("param_id").references(() => qcStandardParams.id),
    name: text("name").notNull(),
    paramGroup: qcParamGroup("param_group").notNull(),
    kind: qcParamKind("kind").notNull(),
    unit: text("unit").notNull().default(""),
    minMilli: bigint("min_milli", { mode: "number" }),
    maxMilli: bigint("max_milli", { mode: "number" }),
    expectedText: text("expected_text"),
    isCritical: boolean("is_critical").notNull().default(true),
    valueMilli: bigint("value_milli", { mode: "number" }),
    valueText: text("value_text"),
    passed: boolean("passed"),
    note: text("note"),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("qc_inspection_results_inspection_idx").on(t.inspectionId)],
);

// Phiếu sai lỗi
export const ncrs = pgTable(
  "ncrs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NCR-2611-001
    code: text("code").notNull().unique(),
    title: text("title").notNull(),
    category: ncrCategory("category").notNull(),
    severity: ncrSeverity("severity").notNull(),
    status: ncrStatus("status").notNull().default("open"),
    description: text("description").notNull(),
    // Biện pháp tức thời
    containment: text("containment").notNull().default(""),
    rootCause: text("root_cause").notNull().default(""),
    correction: text("correction").notNull().default(""),
    verificationNote: text("verification_note").notNull().default(""),
    ownerId: uuid("owner_id"),
    dueOn: date("due_on"),
    complaintId: uuid("complaint_id").references(() => complaints.id),
    lotId: uuid("lot_id").references(() => lots.id),
    stockLotId: uuid("stock_lot_id").references(() => stockLots.id),
    productionOrderId: uuid("production_order_id").references(() => productionOrders.id),
    extractionRunId: uuid("extraction_run_id").references(() => extractionRuns.id),
    inspectionId: uuid("inspection_id").references(() => qcInspections.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    returnRequestId: uuid("return_request_id").references(() => returnRequests.id),
    closedBy: uuid("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ncrs_status_idx").on(t.status, t.createdAt)],
);

export const capas = pgTable(
  "capas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // CAPA-2611-001
    code: text("code").notNull().unique(),
    type: capaType("type").notNull(),
    title: text("title").notNull(),
    problem: text("problem").notNull(),
    ncrId: uuid("ncr_id").references(() => ncrs.id),
    complaintId: uuid("complaint_id").references(() => complaints.id),
    lotId: uuid("lot_id").references(() => lots.id),
    rootCauseMethod: text("root_cause_method").notNull().default(""),
    rootCause: text("root_cause").notNull().default(""),
    actionPlan: text("action_plan").notNull().default(""),
    ownerId: uuid("owner_id"),
    dueOn: date("due_on"),
    status: capaStatus("status").notNull().default("open"),
    effectivenessCriteria: text("effectiveness_criteria").notNull().default(""),
    effectivenessCheckOn: date("effectiveness_check_on"),
    effectivenessResult: text("effectiveness_result").notNull().default(""),
    effective: boolean("effective"),
    closedBy: uuid("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("capas_status_idx").on(t.status, t.dueOn)],
);

export const capaActions = pgTable(
  "capa_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    capaId: uuid("capa_id")
      .notNull()
      .references(() => capas.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    ownerId: uuid("owner_id"),
    dueOn: date("due_on"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    result: text("result").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("capa_actions_capa_idx").on(t.capaId)],
);

export const recalls = pgTable("recalls", {
  id: uuid("id").primaryKey().defaultRandom(),
  // TH-2611-01
  code: text("code").notNull().unique(),
  status: recallStatus("status").notNull().default("open"),
  reason: text("reason").notNull(),
  severity: ncrSeverity("severity").notNull(),
  ncrId: uuid("ncr_id").references(() => ncrs.id),
  openedBy: uuid("opened_by"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedBy: uuid("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recallLots = pgTable(
  "recall_lots",
  {
    recallId: uuid("recall_id")
      .notNull()
      .references(() => recalls.id, { onDelete: "cascade" }),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.recallId, t.lotId] })],
);

export const recallContacts = pgTable(
  "recall_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recallId: uuid("recall_id")
      .notNull()
      .references(() => recalls.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    customerId: uuid("customer_id").references(() => customers.id),
    dealerId: uuid("dealer_id").references(() => dealers.id),
    status: recallContactStatus("status").notNull().default("pending"),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recall_contacts_order_uq").on(t.recallId, t.orderId)],
);
