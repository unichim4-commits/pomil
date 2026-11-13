import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { suppliers } from "./inventory";
import { orders } from "./orders";
import { productionOrders } from "./production";
import { dealers, salesChannels } from "./sales";

// Phân hệ Tài chính (00 mục 3.7). Quản trị nội bộ, không phải sổ kế toán pháp định.

export const cashAccountKind = pgEnum("cash_account_kind", ["cash", "bank", "clearing"]);
export const cashDirection = pgEnum("cash_direction", ["in", "out", "transfer"]);
export const cashTxStatus = pgEnum("cash_tx_status", ["pending_approval", "posted", "cancelled"]);
export const plLine = pgEnum("pl_line", ["none", "capitalized", "selling", "marketing", "admin", "other_income", "other_expense", "tax"]);
export const budgetGroup = pgEnum("budget_group", ["materials", "production", "marketing", "personnel", "operations", "investment", "other"]);
export const budgetPeriod = pgEnum("budget_period", ["month", "quarter", "year"]);
export const budgetStatus = pgEnum("budget_status", ["draft", "active", "closed"]);
export const debtStatus = pgEnum("debt_status", ["open", "partial", "paid", "cancelled"]);
export const arParty = pgEnum("ar_party", ["customer", "dealer", "channel"]);

export const cashAccounts = pgTable("cash_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // TM, NH, COD
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: cashAccountKind("kind").notNull(),
  bankName: text("bank_name"),
  accountNo: text("account_no"),
  openingBalance: integer("opening_balance").notNull().default(0),
  openingOn: date("opening_on").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Hạng mục thu chi (05-tai-chinh.md mục 5.5)
export const financeCategories = pgTable(
  "finance_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    // 'in' | 'out'
    direction: text("direction").notNull(),
    plLine: plLine("pl_line").notNull(),
    // Chỉ chi
    budgetGroup: budgetGroup("budget_group"),
    // Hạng mục hệ thống không xóa/đổi mã
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("finance_categories_direction_chk", sql`${t.direction} in ('in', 'out')`)],
);

// Phiếu thu, phiếu chi, chuyển quỹ
export const cashTransactions = pgTable(
  "cash_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // PT-2611-0001, PC-2611-0001, CQ-2611-001
    code: text("code").notNull().unique(),
    direction: cashDirection("direction").notNull(),
    status: cashTxStatus("status").notNull().default("posted"),
    accountId: uuid("account_id")
      .notNull()
      .references(() => cashAccounts.id),
    toAccountId: uuid("to_account_id").references(() => cashAccounts.id),
    amount: integer("amount").notNull(),
    categoryId: uuid("category_id").references(() => financeCategories.id),
    occurredOn: date("occurred_on").notNull(),
    // customer, dealer, supplier, channel, staff, other
    counterpartyType: text("counterparty_type"),
    counterpartyId: uuid("counterparty_id"),
    counterpartyName: text("counterparty_name").notNull().default(""),
    // Gán chi marketing cho kênh
    channelCode: text("channel_code"),
    // order, receivable, payable, return_request, stock_receipt, production_order, extraction_run, reconciliation, manual
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    sourceCode: text("source_code"),
    // Chống ghi hai lần (R-TC-7)
    idempotencyKey: text("idempotency_key").unique(),
    note: text("note"),
    fileIds: jsonb("file_ids").$type<string[]>().notNull().default([]),
    createdBy: uuid("created_by"),
    approvedBy: uuid("approved_by"),
    cancelledBy: uuid("cancelled_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cash_transactions_account_date_idx").on(t.accountId, t.occurredOn),
    index("cash_transactions_source_idx").on(t.sourceType, t.sourceId),
    index("cash_transactions_category_date_idx").on(t.categoryId, t.occurredOn),
    check("cash_transactions_amount_chk", sql`${t.amount} > 0`),
    check("cash_transactions_transfer_to_chk", sql`(${t.direction} = 'transfer') = (${t.toAccountId} is not null)`),
    check("cash_transactions_transfer_category_chk", sql`(${t.direction} = 'transfer') = (${t.categoryId} is null)`),
  ],
);

export const cashReconciliations = pgTable("cash_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => cashAccounts.id),
  asOf: date("as_of").notNull(),
  systemBalance: integer("system_balance").notNull(),
  actualBalance: integer("actual_balance").notNull(),
  difference: integer("difference").notNull(),
  adjustmentTxId: uuid("adjustment_tx_id").references(() => cashTransactions.id),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    period: budgetPeriod("period").notNull(),
    // Đầu tháng/quý/năm
    periodStart: date("period_start").notNull(),
    status: budgetStatus("status").notNull().default("draft"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("budgets_period_uq").on(t.period, t.periodStart)],
);

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    budgetGroup: budgetGroup("budget_group").notNull(),
    categoryId: uuid("category_id").references(() => financeCategories.id),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT không có ở mọi bản PG; dòng không hạng mục dùng coalesce
    uniqueIndex("budget_lines_uq").on(t.budgetId, t.budgetGroup, sql`coalesce(${t.categoryId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    check("budget_lines_amount_chk", sql`${t.amount} >= 0`),
  ],
);

// Công nợ phải thu
export const receivables = pgTable(
  "receivables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // CNT-2611-0001
    code: text("code").notNull().unique(),
    party: arParty("party").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    dealerId: uuid("dealer_id").references(() => dealers.id),
    channelCode: text("channel_code").references(() => salesChannels.code),
    // Mỗi đơn tối đa một khoản phải thu
    orderId: uuid("order_id")
      .unique()
      .references(() => orders.id),
    amount: integer("amount").notNull(),
    // Chỉ applyDebtPayment ghi
    paidAmount: integer("paid_amount").notNull().default(0),
    status: debtStatus("status").notNull().default("open"),
    issuedOn: date("issued_on").notNull(),
    dueOn: date("due_on").notNull(),
    note: text("note"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("receivables_status_due_idx").on(t.status, t.dueOn),
    check("receivables_amount_chk", sql`${t.amount} > 0`),
    check("receivables_paid_chk", sql`${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.amount}`),
  ],
);

// Công nợ phải trả
export const payables = pgTable(
  "payables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // CNP-2611-0001
    code: text("code").notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    // Hạng mục chi khi trả (cho ngân sách)
    categoryId: uuid("category_id")
      .notNull()
      .references(() => financeCategories.id),
    // 'stock_receipt' | 'production_order' | 'extraction_run' | 'manual'
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    sourceCode: text("source_code"),
    amount: integer("amount").notNull(),
    paidAmount: integer("paid_amount").notNull().default(0),
    status: debtStatus("status").notNull().default("open"),
    issuedOn: date("issued_on").notNull(),
    dueOn: date("due_on").notNull(),
    note: text("note"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payables_status_due_idx").on(t.status, t.dueOn),
    uniqueIndex("payables_source_uq").on(t.sourceType, t.sourceId).where(sql`${t.sourceId} is not null`),
    check("payables_amount_chk", sql`${t.amount} > 0`),
    check("payables_paid_chk", sql`${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.amount}`),
  ],
);

export const debtPayments = pgTable(
  "debt_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receivableId: uuid("receivable_id").references(() => receivables.id),
    payableId: uuid("payable_id").references(() => payables.id),
    amount: integer("amount").notNull(),
    paidOn: date("paid_on").notNull(),
    cashTransactionId: uuid("cash_transaction_id")
      .notNull()
      .references(() => cashTransactions.id),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("debt_payments_receivable_idx").on(t.receivableId),
    index("debt_payments_payable_idx").on(t.payableId),
    check("debt_payments_amount_chk", sql`${t.amount} > 0`),
    check("debt_payments_one_debt_chk", sql`(${t.receivableId} is not null) <> (${t.payableId} is not null)`),
  ],
);

export const overheadAllocations = pgTable(
  "overhead_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // PB-2611-01
    code: text("code").notNull().unique(),
    // Ngày 1 của tháng
    periodMonth: date("period_month").notNull(),
    totalAmount: integer("total_amount").notNull(),
    // 'units' | 'bulk'
    basis: text("basis").notNull(),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("overhead_allocations_total_chk", sql`${t.totalAmount} > 0`), check("overhead_allocations_basis_chk", sql`${t.basis} in ('units', 'bulk')`)],
);

export const overheadAllocationLines = pgTable(
  "overhead_allocation_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    allocationId: uuid("allocation_id")
      .notNull()
      .references(() => overheadAllocations.id, { onDelete: "cascade" }),
    productionOrderId: uuid("production_order_id")
      .notNull()
      .references(() => productionOrders.id),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("overhead_allocation_lines_po_idx").on(t.productionOrderId), check("overhead_allocation_lines_amount_chk", sql`${t.amount} >= 0`)],
);
