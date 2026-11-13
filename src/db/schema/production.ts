import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { products } from "./catalog";
import { baseUom } from "./enums";
import { inventoryItems, stockLots, suppliers } from "./inventory";
import { lots } from "./quality";

// Phân hệ Sản xuất (00 mục 3.4)

export const formulaVersionStatus = pgEnum("formula_version_status", ["draft", "trial", "approved", "archived"]);
export const productionKind = pgEnum("production_kind", ["in_house", "outsourced"]);
export const productionStatus = pgEnum("production_status", ["draft", "planned", "approved", "in_progress", "qc", "completed", "cancelled"]);
export const productionQcResult = pgEnum("production_qc_result", ["pending", "pass", "fail"]);
export const planPeriod = pgEnum("plan_period", ["day", "week", "month"]);
export const planStatus = pgEnum("plan_status", ["draft", "confirmed", "closed", "cancelled"]);
export const stepStatus = pgEnum("step_status", ["pending", "in_progress", "done", "skipped"]);
export const materialSource = pgEnum("material_source", ["pomil", "factory"]);
export const extractionMethod = pgEnum("extraction_method", ["steam_distillation", "cold_press", "maceration", "other"]);
export const extractionStatus = pgEnum("extraction_status", ["draft", "in_progress", "completed", "cancelled"]);

export const formulas = pgTable("formulas", {
  id: uuid("id").primaryKey().defaultRandom(),
  // FORM-001
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  productId: uuid("product_id").references(() => products.id),
  note: text("note"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const formulaVersions = pgTable(
  "formula_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formulaId: uuid("formula_id")
      .notNull()
      .references(() => formulas.id),
    version: integer("version").notNull(),
    // PST-v2 (mã SP) hoặc FORM-001-v2 khi chưa gắn SP; ghi vào lots.formula_version
    label: text("label").notNull(),
    status: formulaVersionStatus("status").notNull().default("draft"),
    // Cỡ mẻ chuẩn theo batch_uom (mg hoặc ul)
    batchSize: bigint("batch_size", { mode: "number" }).notNull(),
    batchUom: baseUom("batch_uom").notNull(),
    bulkDensityMgPerMl: integer("bulk_density_mg_per_ml"),
    // Hiệu suất dự kiến (bp)
    expectedYieldBp: integer("expected_yield_bp").notNull().default(10000),
    processNote: text("process_note").notNull().default(""),
    // Bắt buộc khi version > 1
    changeNote: text("change_note").notNull().default(""),
    basedOnVersionId: uuid("based_on_version_id").references((): AnyPgColumn => formulaVersions.id),
    createdBy: uuid("created_by"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("formula_versions_version_uq").on(t.formulaId, t.version),
    uniqueIndex("formula_versions_approved_uq").on(t.formulaId).where(sql`${t.status} = 'approved'`),
    check("formula_versions_version_chk", sql`${t.version} >= 1`),
    check("formula_versions_batch_size_chk", sql`${t.batchSize} > 0`),
    check("formula_versions_batch_uom_chk", sql`${t.batchUom} in ('mg', 'ul')`),
    check("formula_versions_yield_chk", sql`${t.expectedYieldBp} >= 1 and ${t.expectedYieldBp} <= 10000`),
  ],
);

export const formulaLines = pgTable(
  "formula_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formulaVersionId: uuid("formula_version_id")
      .notNull()
      .references(() => formulaVersions.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    // Phần triệu (R-CHUNG-3)
    ppm: integer("ppm").notNull().default(0),
    // Một dòng cân bằng mỗi phiên bản
    isBalance: boolean("is_balance").notNull().default(false),
    phase: text("phase").notNull().default(""),
    note: text("note"),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("formula_lines_version_idx").on(t.formulaVersionId),
    uniqueIndex("formula_lines_balance_uq").on(t.formulaVersionId).where(sql`${t.isBalance}`),
    check("formula_lines_ppm_chk", sql`${t.ppm} >= 0 and ${t.ppm} <= 1000000`),
  ],
);

export const formulaPackaging = pgTable(
  "formula_packaging",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formulaVersionId: uuid("formula_version_id")
      .notNull()
      .references(() => formulaVersions.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    qtyPerUnit: bigint("qty_per_unit", { mode: "number" }).notNull(),
    note: text("note"),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("formula_packaging_version_idx").on(t.formulaVersionId), check("formula_packaging_qty_chk", sql`${t.qtyPerUnit} > 0`)],
);

export const productionPlans = pgTable(
  "production_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // KH-2611-001
    code: text("code").notNull().unique(),
    period: planPeriod("period").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: planStatus("status").notNull().default("draft"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("production_plans_period_chk", sql`${t.periodEnd} >= ${t.periodStart}`)],
);

export const productionPlanLines = pgTable(
  "production_plan_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => productionPlans.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    // null = bản approved hiện hành
    formulaVersionId: uuid("formula_version_id").references(() => formulaVersions.id),
    targetUnits: integer("target_units").notNull(),
    plannedStart: date("planned_start"),
    note: text("note"),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("production_plan_lines_plan_idx").on(t.planId), check("production_plan_lines_target_chk", sql`${t.targetUnits} > 0`)],
);

// Lệnh sản xuất
export const productionOrders = pgTable(
  "production_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // LSX-2611-001
    code: text("code").notNull().unique(),
    kind: productionKind("kind").notNull(),
    status: productionStatus("status").notNull().default("draft"),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    // Bắt buộc với in_house
    formulaVersionId: uuid("formula_version_id").references(() => formulaVersions.id),
    // Gia công không có công thức trong sổ: nhãn công thức của nhà máy
    formulaLabel: text("formula_label"),
    planLineId: uuid("plan_line_id").references(() => productionPlanLines.id),
    // Nhà máy, bắt buộc với outsourced
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    // Đơn giá gia công / chai
    outsourcingUnitPrice: integer("outsourcing_unit_price"),
    plannedUnits: integer("planned_units").notNull(),
    // Theo batch_uom của công thức
    plannedBulk: bigint("planned_bulk", { mode: "number" }),
    batchCount: integer("batch_count"),
    responsibleId: uuid("responsible_id"),
    plannedStart: date("planned_start"),
    plannedEnd: date("planned_end"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    actualBulk: bigint("actual_bulk", { mode: "number" }),
    goodUnits: integer("good_units"),
    rejectedUnits: integer("rejected_units").notNull().default(0),
    manufacturedOn: date("manufactured_on"),
    expiresOn: date("expires_on"),
    // Lô thành phẩm tạo ra
    lotId: uuid("lot_id")
      .unique()
      .references(() => lots.id),
    qcResult: productionQcResult("qc_result").notNull().default("pending"),
    materialCost: integer("material_cost").notNull().default(0),
    packagingCost: integer("packaging_cost").notNull().default(0),
    laborCost: integer("labor_cost").notNull().default(0),
    // Phần nhập tay; phần phân bổ đọc overhead_allocation_lines
    overheadCost: integer("overhead_cost").notNull().default(0),
    outsourcingCost: integer("outsourcing_cost").notNull().default(0),
    otherCost: integer("other_cost").notNull().default(0),
    // Chỉ recalcProductionCost ghi
    totalCost: integer("total_cost").notNull().default(0),
    // Chụp lúc duyệt
    plannedCost: integer("planned_cost"),
    costLockedAt: timestamp("cost_locked_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("production_orders_status_start_idx").on(t.status, t.plannedStart),
    index("production_orders_product_idx").on(t.productId),
    check("production_orders_unit_price_chk", sql`${t.outsourcingUnitPrice} is null or ${t.outsourcingUnitPrice} >= 0`),
    check("production_orders_planned_units_chk", sql`${t.plannedUnits} > 0`),
    check("production_orders_good_units_chk", sql`${t.goodUnits} is null or ${t.goodUnits} >= 0`),
    check("production_orders_rejected_units_chk", sql`${t.rejectedUnits} >= 0`),
  ],
);

export const productionOrderMaterials = pgTable(
  "production_order_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productionOrderId: uuid("production_order_id")
      .notNull()
      .references(() => productionOrders.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    // 'formula' | 'packaging' | 'extra'
    role: text("role").notNull(),
    plannedQty: bigint("planned_qty", { mode: "number" }).notNull(),
    suppliedBy: materialSource("supplied_by").notNull().default("pomil"),
    note: text("note"),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("production_order_materials_uq").on(t.productionOrderId, t.itemId),
    check("production_order_materials_qty_chk", sql`${t.plannedQty} >= 0`),
  ],
);

export const productionOrderSteps = pgTable(
  "production_order_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productionOrderId: uuid("production_order_id")
      .notNull()
      .references(() => productionOrders.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    status: stepStatus("status").notNull().default("pending"),
    needsQc: boolean("needs_qc").notNull().default(false),
    operatorId: uuid("operator_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("production_order_steps_seq_uq").on(t.productionOrderId, t.seq)],
);

export type ExtractionParam = { name: string; valueMilli: number; unit: string };

// Mẻ chiết xuất. Lượng vỏ đầu vào = tổng xuất extraction_issue trừ trả lại (một nguồn).
export const extractionRuns = pgTable("extraction_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // CX-2611-001
  code: text("code").notNull().unique(),
  // in_house = tự chưng; outsourced = thuê lò
  kind: productionKind("kind").notNull().default("outsourced"),
  status: extractionStatus("status").notNull().default("draft"),
  pomeloVariety: text("pomelo_variety").notNull().default(""),
  sourceSupplierId: uuid("source_supplier_id").references(() => suppliers.id),
  harvestOn: date("harvest_on"),
  peelCondition: text("peel_condition").notNull().default(""),
  method: extractionMethod("method").notNull(),
  equipment: text("equipment").notNull().default(""),
  operatorName: text("operator_name").notNull().default(""),
  operatorId: uuid("operator_id"),
  // Lò chưng thuê
  serviceSupplierId: uuid("service_supplier_id").references(() => suppliers.id),
  serviceFee: integer("service_fee").notNull().default(0),
  otherCost: integer("other_cost").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  params: jsonb("params").$type<ExtractionParam[]>().notNull().default([]),
  // Hàng kind extract
  outputItemId: uuid("output_item_id")
    .notNull()
    .references(() => inventoryItems.id),
  outputQty: bigint("output_qty", { mode: "number" }),
  outputStockLotId: uuid("output_stock_lot_id").references(() => stockLots.id),
  totalCost: integer("total_cost").notNull().default(0),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
