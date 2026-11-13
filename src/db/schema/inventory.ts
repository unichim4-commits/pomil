import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { products } from "./catalog";
import { baseUom } from "./enums";
import { orderItems } from "./orders";
import { lots } from "./quality";

// Phân hệ Kho (00 mục 3.3). Số lượng là bigint theo đơn vị cơ sở (R-CHUNG-1); tiền là integer đồng.

export const warehouseKind = pgEnum("warehouse_kind", ["raw", "extract", "packaging", "wip", "finished", "rejected"]);
export const itemKind = pgEnum("item_kind", ["raw_material", "extract", "packaging", "wip", "finished", "other"]);
export const supplierKind = pgEnum("supplier_kind", ["material", "packaging", "factory", "farm", "service", "other"]);
export const stockLotQcStatus = pgEnum("stock_lot_qc_status", ["pending", "released", "rejected", "on_hold"]);
export const stockMoveType = pgEnum("stock_move_type", [
  "opening",
  "purchase_receipt",
  "production_receipt",
  "extraction_receipt",
  "return_receipt",
  "production_return",
  "other_receipt",
  "production_issue",
  "extraction_issue",
  "sale_issue",
  "sample_issue",
  "qc_sample_issue",
  "scrap_issue",
  "research_issue",
  "supplier_return",
  "other_issue",
  "transfer_out",
  "transfer_in",
  "count_adjust",
  "reversal",
]);
export const stockDocType = pgEnum("stock_doc_type", ["receipt", "issue", "transfer", "count", "order"]);
export const receiptKind = pgEnum("receipt_kind", ["purchase", "production", "extraction", "customer_return", "production_return", "opening", "other"]);
export const issueKind = pgEnum("issue_kind", ["production", "extraction", "sample", "qc_sample", "scrap", "research", "supplier_return", "other"]);
export const stockDocStatus = pgEnum("stock_doc_status", ["draft", "pending_approval", "posted", "cancelled"]);

// Nhà cung cấp, nhà máy gia công, vườn bưởi, lò chưng thuê
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: supplierKind("kind").notNull().default("material"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    taxCode: text("tax_code"),
    // Hạn trả mặc định (ngày)
    paymentTermsDays: integer("payment_terms_days").notNull().default(0),
    // Đã đánh giá đạt (IQC cảnh báo nếu false)
    qualified: boolean("qualified").notNull().default(false),
    note: text("note"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("suppliers_payment_terms_chk", sql`${t.paymentTermsDays} >= 0 and ${t.paymentTermsDays} <= 365`)],
);

export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey().defaultRandom(),
  // RAW, EXT, PKG, WIP, FG, REJ; kho tự tạo: 2–10 ký tự hoa/số
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: warehouseKind("kind").notNull(),
  address: text("address"),
  isActive: boolean("is_active").notNull().default(true),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Kệ/ngăn trong kho; mỗi kho đúng một vị trí mặc định "CHUNG"
export const warehouseLocations = pgTable(
  "warehouse_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    code: text("code").notNull(),
    name: text("name").notNull().default(""),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("warehouse_locations_code_uq").on(t.warehouseId, t.code),
    uniqueIndex("warehouse_locations_default_uq").on(t.warehouseId).where(sql`${t.isDefault}`),
  ],
);

// Danh mục hàng hóa: NL-001, TD-001, BB-001, BTP-001; thành phẩm = products.code
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: itemKind("kind").notNull(),
    groupName: text("group_name").notNull().default(""),
    // Không đổi khi đã có biến động
    baseUom: baseUom("base_uom").notNull(),
    // Phải hợp với base_uom (R-KHO-2)
    displayUom: text("display_uom").notNull(),
    // Đơn vị tính giá nhập (kg, l, cái)
    purchaseUom: text("purchase_uom").notNull(),
    spec: text("spec").notNull().default(""),
    // Giá nhập tham chiếu, đồng / 1 purchase_uom
    refUnitPrice: integer("ref_unit_price"),
    defaultSupplierId: uuid("default_supplier_id").references(() => suppliers.id),
    defaultWarehouseId: uuid("default_warehouse_id").references(() => warehouses.id),
    shelfLifeDays: integer("shelf_life_days"),
    storageCondition: text("storage_condition").notNull().default(""),
    // Ngưỡng tồn tối thiểu (đơn vị cơ sở)
    minStock: bigint("min_stock", { mode: "number" }),
    requiresIqc: boolean("requires_iqc").notNull().default(true),
    // Khối lượng riêng để đổi mg ↔ ul
    densityMgPerMl: integer("density_mg_per_ml"),
    // Chỉ hàng thành phẩm
    productId: uuid("product_id")
      .unique()
      .references(() => products.id),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("inventory_items_ref_unit_price_chk", sql`${t.refUnitPrice} is null or ${t.refUnitPrice} >= 0`),
    check("inventory_items_shelf_life_chk", sql`${t.shelfLifeDays} is null or ${t.shelfLifeDays} > 0`),
    check("inventory_items_min_stock_chk", sql`${t.minStock} is null or ${t.minStock} >= 0`),
    check("inventory_items_density_chk", sql`${t.densityMgPerMl} is null or ${t.densityMgPerMl} > 0`),
    check("inventory_items_finished_product_chk", sql`(${t.kind} = 'finished') = (${t.productId} is not null)`),
    check("inventory_items_finished_pcs_chk", sql`${t.kind} <> 'finished' or ${t.baseUom} = 'pcs'`),
  ],
);

// Lô của mọi hàng trong kho. Lô thành phẩm trỏ lots, không tạo lô thành phẩm thứ hai.
export const stockLots = pgTable(
  "stock_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // VT-2611-0001, EX-2611-001; lô thành phẩm = lots.lot_no
    code: text("code").notNull().unique(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    productLotId: uuid("product_lot_id")
      .unique()
      .references(() => lots.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    supplierLotNo: text("supplier_lot_no"),
    manufacturedOn: date("manufactured_on"),
    expiresOn: date("expires_on"),
    // Số nhận lần đầu (mẫu số giá vốn)
    receivedQty: bigint("received_qty", { mode: "number" }).notNull(),
    // Tổng giá trị lô (đồng)
    receivedCost: integer("received_cost").notNull().default(0),
    // Lô thành phẩm để null, đọc lots.release_status
    qcStatus: stockLotQcStatus("qc_status"),
    holdReason: text("hold_reason"),
    sourceDocType: stockDocType("source_doc_type").notNull(),
    sourceDocId: uuid("source_doc_id").notNull(),
    productionOrderId: uuid("production_order_id"),
    extractionRunId: uuid("extraction_run_id"),
    costLockedAt: timestamp("cost_locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_lots_item_expires_idx").on(t.itemId, t.expiresOn),
    check("stock_lots_received_qty_chk", sql`${t.receivedQty} > 0`),
    check("stock_lots_received_cost_chk", sql`${t.receivedCost} >= 0`),
    check("stock_lots_qc_status_chk", sql`(${t.productLotId} is null) = (${t.qcStatus} is not null)`),
  ],
);

// Số dư theo (vị trí, lô). Chỉ postMovements ghi bảng này.
export const stockBalances = pgTable(
  "stock_balances",
  {
    locationId: uuid("location_id")
      .notNull()
      .references(() => warehouseLocations.id),
    stockLotId: uuid("stock_lot_id")
      .notNull()
      .references(() => stockLots.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    qty: bigint("qty", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.locationId, t.stockLotId] }),
    index("stock_balances_item_warehouse_idx").on(t.itemId, t.warehouseId),
    index("stock_balances_lot_idx").on(t.stockLotId),
    check("stock_balances_qty_chk", sql`${t.qty} >= 0`),
  ],
);

// Sổ biến động, chỉ ghi thêm (R-KHO-7)
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: stockMoveType("type").notNull(),
    docType: stockDocType("doc_type").notNull(),
    docId: uuid("doc_id").notNull(),
    docCode: text("doc_code").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    stockLotId: uuid("stock_lot_id")
      .notNull()
      .references(() => stockLots.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => warehouseLocations.id),
    // Có dấu
    qty: bigint("qty", { mode: "number" }).notNull(),
    // Số dư (vị trí, lô) sau dòng này
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    orderItemId: uuid("order_item_id").references(() => orderItems.id),
    productionOrderId: uuid("production_order_id"),
    extractionRunId: uuid("extraction_run_id"),
    reversalOf: uuid("reversal_of").references((): AnyPgColumn => stockMovements.id),
    note: text("note"),
    actorId: uuid("actor_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_movements_item_time_idx").on(t.itemId, t.occurredAt),
    index("stock_movements_lot_time_idx").on(t.stockLotId, t.occurredAt),
    index("stock_movements_doc_idx").on(t.docType, t.docId),
    index("stock_movements_order_item_idx").on(t.orderItemId),
    index("stock_movements_production_order_idx").on(t.productionOrderId),
    uniqueIndex("stock_movements_reversal_of_uq").on(t.reversalOf).where(sql`${t.reversalOf} is not null`),
    check("stock_movements_qty_chk", sql`${t.qty} <> 0`),
  ],
);

// Phiếu nhập
export const stockReceipts = pgTable("stock_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // PN-2611-0001
  code: text("code").notNull().unique(),
  kind: receiptKind("kind").notNull(),
  status: stockDocStatus("status").notNull().default("draft"),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  receivedOn: date("received_on").notNull(),
  invoiceNo: text("invoice_no"),
  fileIds: jsonb("file_ids").$type<string[]>().notNull().default([]),
  // 'production_order' | 'extraction_run' | 'order' | 'return_request' | 'recall'
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  // 'payable' (ghi công nợ) | 'paid_now' (phiếu chi ngay) | 'none'
  paymentMode: text("payment_mode").notNull().default("payable"),
  // → cash_accounts (không FK)
  payAccountId: uuid("pay_account_id"),
  // Tổng dòng, ghi lúc ghi sổ
  totalCost: integer("total_cost").notNull().default(0),
  note: text("note"),
  createdBy: uuid("created_by"),
  postedBy: uuid("posted_by"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stockReceiptLines = pgTable(
  "stock_receipt_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => stockReceipts.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    // null = vị trí mặc định
    locationId: uuid("location_id").references(() => warehouseLocations.id),
    qty: bigint("qty", { mode: "number" }).notNull(),
    lineCost: integer("line_cost").notNull().default(0),
    // Đặt trước = nhập vào lô có sẵn; null = tạo lô mới lúc ghi sổ rồi ghi id vào đây
    stockLotId: uuid("stock_lot_id").references(() => stockLots.id),
    // Nhập thành phẩm cho một lô lots có sẵn
    productLotId: uuid("product_lot_id").references(() => lots.id),
    supplierLotNo: text("supplier_lot_no"),
    manufacturedOn: date("manufactured_on"),
    expiresOn: date("expires_on"),
    // Chép từ requires_iqc lúc thêm dòng
    qcRequired: boolean("qc_required").notNull().default(true),
    note: text("note"),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_receipt_lines_receipt_idx").on(t.receiptId),
    check("stock_receipt_lines_qty_chk", sql`${t.qty} > 0`),
    check("stock_receipt_lines_cost_chk", sql`${t.lineCost} >= 0`),
  ],
);

// Phiếu xuất (không dùng cho xuất bán: xuất bán ghi theo đơn)
export const stockIssues = pgTable("stock_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  // PX-2611-0001
  code: text("code").notNull().unique(),
  kind: issueKind("kind").notNull(),
  status: stockDocStatus("status").notNull().default("draft"),
  // null = chọn theo FEFO trên nhiều kho đúng loại
  warehouseId: uuid("warehouse_id").references(() => warehouses.id),
  productionOrderId: uuid("production_order_id"),
  extractionRunId: uuid("extraction_run_id"),
  purpose: text("purpose"),
  fileIds: jsonb("file_ids").$type<string[]>().notNull().default([]),
  note: text("note"),
  requestedBy: uuid("requested_by"),
  approvedBy: uuid("approved_by"),
  postedBy: uuid("posted_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stockIssueLines = pgTable(
  "stock_issue_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => stockIssues.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    // null = FEFO lúc ghi sổ; khi FEFO tách nhiều lô thì tách dòng
    stockLotId: uuid("stock_lot_id").references(() => stockLots.id),
    locationId: uuid("location_id").references(() => warehouseLocations.id),
    qty: bigint("qty", { mode: "number" }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_issue_lines_issue_idx").on(t.issueId), check("stock_issue_lines_qty_chk", sql`${t.qty} > 0`)],
);

// Điều chuyển
export const stockTransfers = pgTable("stock_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  // DCK-2611-001
  code: text("code").notNull().unique(),
  status: stockDocStatus("status").notNull().default("draft"),
  fromWarehouseId: uuid("from_warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  toWarehouseId: uuid("to_warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  reason: text("reason").notNull().default(""),
  // 'inspection' khi QMS chuyển lô không đạt sang REJ
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  createdBy: uuid("created_by"),
  postedBy: uuid("posted_by"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stockTransferLines = pgTable(
  "stock_transfer_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => stockTransfers.id, { onDelete: "cascade" }),
    stockLotId: uuid("stock_lot_id")
      .notNull()
      .references(() => stockLots.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    fromLocationId: uuid("from_location_id")
      .notNull()
      .references(() => warehouseLocations.id),
    toLocationId: uuid("to_location_id")
      .notNull()
      .references(() => warehouseLocations.id),
    qty: bigint("qty", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_transfer_lines_transfer_idx").on(t.transferId), check("stock_transfer_lines_qty_chk", sql`${t.qty} > 0`)],
);

// Kiểm kê (draft = đang đếm)
export const stockCounts = pgTable("stock_counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // KK-2611-001
  code: text("code").notNull().unique(),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  status: stockDocStatus("status").notNull().default("draft"),
  countedOn: date("counted_on").notNull(),
  note: text("note"),
  createdBy: uuid("created_by"),
  postedBy: uuid("posted_by"),
  approvedBy: uuid("approved_by"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countId: uuid("count_id")
      .notNull()
      .references(() => stockCounts.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    stockLotId: uuid("stock_lot_id")
      .notNull()
      .references(() => stockLots.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => warehouseLocations.id),
    // Chụp lúc tạo phiếu
    systemQty: bigint("system_qty", { mode: "number" }).notNull(),
    // null = chưa đếm
    countedQty: bigint("counted_qty", { mode: "number" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_count_lines_uq").on(t.countId, t.locationId, t.stockLotId),
    check("stock_count_lines_counted_chk", sql`${t.countedQty} is null or ${t.countedQty} >= 0`),
  ],
);
