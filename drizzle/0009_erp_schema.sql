CREATE TYPE "public"."base_uom" AS ENUM('mg', 'ul', 'pcs');--> statement-breakpoint
CREATE TYPE "public"."product_dev_stage" AS ENUM('developing', 'testing', 'commercial', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."issue_kind" AS ENUM('production', 'extraction', 'sample', 'qc_sample', 'scrap', 'research', 'supplier_return', 'other');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('raw_material', 'extract', 'packaging', 'wip', 'finished', 'other');--> statement-breakpoint
CREATE TYPE "public"."receipt_kind" AS ENUM('purchase', 'production', 'extraction', 'customer_return', 'production_return', 'opening', 'other');--> statement-breakpoint
CREATE TYPE "public"."stock_doc_status" AS ENUM('draft', 'pending_approval', 'posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stock_doc_type" AS ENUM('receipt', 'issue', 'transfer', 'count', 'order');--> statement-breakpoint
CREATE TYPE "public"."stock_lot_qc_status" AS ENUM('pending', 'released', 'rejected', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."stock_move_type" AS ENUM('opening', 'purchase_receipt', 'production_receipt', 'extraction_receipt', 'return_receipt', 'production_return', 'other_receipt', 'production_issue', 'extraction_issue', 'sale_issue', 'sample_issue', 'qc_sample_issue', 'scrap_issue', 'research_issue', 'supplier_return', 'other_issue', 'transfer_out', 'transfer_in', 'count_adjust', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."supplier_kind" AS ENUM('material', 'packaging', 'factory', 'farm', 'service', 'other');--> statement-breakpoint
CREATE TYPE "public"."warehouse_kind" AS ENUM('raw', 'extract', 'packaging', 'wip', 'finished', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."extraction_method" AS ENUM('steam_distillation', 'cold_press', 'maceration', 'other');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('draft', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."formula_version_status" AS ENUM('draft', 'trial', 'approved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."material_source" AS ENUM('pomil', 'factory');--> statement-breakpoint
CREATE TYPE "public"."plan_period" AS ENUM('day', 'week', 'month');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'confirmed', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."production_kind" AS ENUM('in_house', 'outsourced');--> statement-breakpoint
CREATE TYPE "public"."production_qc_result" AS ENUM('pending', 'pass', 'fail');--> statement-breakpoint
CREATE TYPE "public"."production_status" AS ENUM('draft', 'planned', 'approved', 'in_progress', 'qc', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'in_progress', 'done', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."channel_kind" AS ENUM('own_web', 'marketplace', 'social', 'dealer', 'direct');--> statement-breakpoint
CREATE TYPE "public"."dealer_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."price_list_kind" AS ENUM('retail', 'wholesale', 'dealer', 'promo');--> statement-breakpoint
CREATE TYPE "public"."return_condition" AS ENUM('intact', 'damaged', 'defective');--> statement-breakpoint
CREATE TYPE "public"."return_disposition" AS ENUM('restock', 'quarantine');--> statement-breakpoint
CREATE TYPE "public"."return_reason" AS ENUM('defect', 'wrong_item', 'damaged', 'changed_mind', 'other');--> statement-breakpoint
CREATE TYPE "public"."return_resolution" AS ENUM('refund', 'exchange', 'none');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('requested', 'approved', 'received', 'completed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."voucher_kind" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TYPE "public"."capa_status" AS ENUM('open', 'in_progress', 'verifying', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."capa_type" AS ENUM('corrective', 'preventive');--> statement-breakpoint
CREATE TYPE "public"."inspection_disposition" AS ENUM('accept', 'reject', 'use_as_is', 'return_to_supplier');--> statement-breakpoint
CREATE TYPE "public"."inspection_stage" AS ENUM('iqc', 'ipqc', 'fqc', 'recheck');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('pending', 'passed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ncr_category" AS ENUM('material', 'extract', 'process', 'product', 'packaging', 'supplier', 'customer_complaint', 'other');--> statement-breakpoint
CREATE TYPE "public"."ncr_severity" AS ENUM('minor', 'major', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ncr_status" AS ENUM('open', 'investigating', 'action', 'verifying', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."qc_applies_to" AS ENUM('raw_material', 'extract', 'wip', 'finished', 'packaging');--> statement-breakpoint
CREATE TYPE "public"."qc_param_group" AS ENUM('origin', 'sensory', 'physicochemical', 'composition', 'microbial', 'heavy_metal', 'stability', 'packaging', 'label', 'other');--> statement-breakpoint
CREATE TYPE "public"."qc_param_kind" AS ENUM('range', 'pass_fail', 'text');--> statement-breakpoint
CREATE TYPE "public"."qc_standard_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."recall_contact_status" AS ENUM('pending', 'contacted', 'returned', 'unreachable', 'refused');--> statement-breakpoint
CREATE TYPE "public"."recall_status" AS ENUM('open', 'in_progress', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ar_party" AS ENUM('customer', 'dealer', 'channel');--> statement-breakpoint
CREATE TYPE "public"."budget_group" AS ENUM('materials', 'production', 'marketing', 'personnel', 'operations', 'investment', 'other');--> statement-breakpoint
CREATE TYPE "public"."budget_period" AS ENUM('month', 'quarter', 'year');--> statement-breakpoint
CREATE TYPE "public"."budget_status" AS ENUM('draft', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."cash_account_kind" AS ENUM('cash', 'bank', 'clearing');--> statement-breakpoint
CREATE TYPE "public"."cash_direction" AS ENUM('in', 'out', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."cash_tx_status" AS ENUM('pending_approval', 'posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."debt_status" AS ENUM('open', 'partial', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pl_line" AS ENUM('none', 'capitalized', 'selling', 'marketing', 'admin', 'other_income', 'other_expense', 'tax');--> statement-breakpoint
ALTER TYPE "public"."lot_release_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'cash';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'platform';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'credit';--> statement-breakpoint
CREATE TABLE "doc_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "item_kind" NOT NULL,
	"group_name" text DEFAULT '' NOT NULL,
	"base_uom" "base_uom" NOT NULL,
	"display_uom" text NOT NULL,
	"purchase_uom" text NOT NULL,
	"spec" text DEFAULT '' NOT NULL,
	"ref_unit_price" integer,
	"default_supplier_id" uuid,
	"default_warehouse_id" uuid,
	"shelf_life_days" integer,
	"storage_condition" text DEFAULT '' NOT NULL,
	"min_stock" bigint,
	"requires_iqc" boolean DEFAULT true NOT NULL,
	"density_mg_per_ml" integer,
	"product_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_code_unique" UNIQUE("code"),
	CONSTRAINT "inventory_items_product_id_unique" UNIQUE("product_id"),
	CONSTRAINT "inventory_items_ref_unit_price_chk" CHECK ("inventory_items"."ref_unit_price" is null or "inventory_items"."ref_unit_price" >= 0),
	CONSTRAINT "inventory_items_shelf_life_chk" CHECK ("inventory_items"."shelf_life_days" is null or "inventory_items"."shelf_life_days" > 0),
	CONSTRAINT "inventory_items_min_stock_chk" CHECK ("inventory_items"."min_stock" is null or "inventory_items"."min_stock" >= 0),
	CONSTRAINT "inventory_items_density_chk" CHECK ("inventory_items"."density_mg_per_ml" is null or "inventory_items"."density_mg_per_ml" > 0),
	CONSTRAINT "inventory_items_finished_product_chk" CHECK (("inventory_items"."kind" = 'finished') = ("inventory_items"."product_id" is not null)),
	CONSTRAINT "inventory_items_finished_pcs_chk" CHECK ("inventory_items"."kind" <> 'finished' or "inventory_items"."base_uom" = 'pcs')
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"location_id" uuid NOT NULL,
	"stock_lot_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_location_id_stock_lot_id_pk" PRIMARY KEY("location_id","stock_lot_id"),
	CONSTRAINT "stock_balances_qty_chk" CHECK ("stock_balances"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"stock_lot_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"system_qty" bigint NOT NULL,
	"counted_qty" bigint,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_count_lines_counted_chk" CHECK ("stock_count_lines"."counted_qty" is null or "stock_count_lines"."counted_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "stock_doc_status" DEFAULT 'draft' NOT NULL,
	"counted_on" date NOT NULL,
	"note" text,
	"created_by" uuid,
	"posted_by" uuid,
	"approved_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stock_issue_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"stock_lot_id" uuid,
	"location_id" uuid,
	"qty" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_issue_lines_qty_chk" CHECK ("stock_issue_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "issue_kind" NOT NULL,
	"status" "stock_doc_status" DEFAULT 'draft' NOT NULL,
	"warehouse_id" uuid,
	"production_order_id" uuid,
	"extraction_run_id" uuid,
	"purpose" text,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"requested_by" uuid,
	"approved_by" uuid,
	"posted_by" uuid,
	"approved_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_issues_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"item_id" uuid NOT NULL,
	"product_lot_id" uuid,
	"supplier_id" uuid,
	"supplier_lot_no" text,
	"manufactured_on" date,
	"expires_on" date,
	"received_qty" bigint NOT NULL,
	"received_cost" integer DEFAULT 0 NOT NULL,
	"qc_status" "stock_lot_qc_status",
	"hold_reason" text,
	"source_doc_type" "stock_doc_type" NOT NULL,
	"source_doc_id" uuid NOT NULL,
	"production_order_id" uuid,
	"extraction_run_id" uuid,
	"cost_locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_lots_code_unique" UNIQUE("code"),
	CONSTRAINT "stock_lots_product_lot_id_unique" UNIQUE("product_lot_id"),
	CONSTRAINT "stock_lots_received_qty_chk" CHECK ("stock_lots"."received_qty" > 0),
	CONSTRAINT "stock_lots_received_cost_chk" CHECK ("stock_lots"."received_cost" >= 0),
	CONSTRAINT "stock_lots_qc_status_chk" CHECK (("stock_lots"."product_lot_id" is null) = ("stock_lots"."qc_status" is not null))
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "stock_move_type" NOT NULL,
	"doc_type" "stock_doc_type" NOT NULL,
	"doc_id" uuid NOT NULL,
	"doc_code" text NOT NULL,
	"item_id" uuid NOT NULL,
	"stock_lot_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"qty" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"order_item_id" uuid,
	"production_order_id" uuid,
	"extraction_run_id" uuid,
	"reversal_of" uuid,
	"note" text,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_qty_chk" CHECK ("stock_movements"."qty" <> 0)
);
--> statement-breakpoint
CREATE TABLE "stock_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid,
	"qty" bigint NOT NULL,
	"line_cost" integer DEFAULT 0 NOT NULL,
	"stock_lot_id" uuid,
	"product_lot_id" uuid,
	"supplier_lot_no" text,
	"manufactured_on" date,
	"expires_on" date,
	"qc_required" boolean DEFAULT true NOT NULL,
	"note" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_receipt_lines_qty_chk" CHECK ("stock_receipt_lines"."qty" > 0),
	CONSTRAINT "stock_receipt_lines_cost_chk" CHECK ("stock_receipt_lines"."line_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "receipt_kind" NOT NULL,
	"status" "stock_doc_status" DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"invoice_no" text,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"payment_mode" text DEFAULT 'payable' NOT NULL,
	"pay_account_id" uuid,
	"total_cost" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" uuid,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_receipts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"stock_lot_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"qty" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfer_lines_qty_chk" CHECK ("stock_transfer_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"status" "stock_doc_status" DEFAULT 'draft' NOT NULL,
	"from_warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"created_by" uuid,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "supplier_kind" DEFAULT 'material' NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"tax_code" text,
	"payment_terms_days" integer DEFAULT 0 NOT NULL,
	"qualified" boolean DEFAULT false NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_code_unique" UNIQUE("code"),
	CONSTRAINT "suppliers_payment_terms_chk" CHECK ("suppliers"."payment_terms_days" >= 0 and "suppliers"."payment_terms_days" <= 365)
);
--> statement-breakpoint
CREATE TABLE "warehouse_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "warehouse_kind" NOT NULL,
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "production_kind" DEFAULT 'outsourced' NOT NULL,
	"status" "extraction_status" DEFAULT 'draft' NOT NULL,
	"pomelo_variety" text DEFAULT '' NOT NULL,
	"source_supplier_id" uuid,
	"harvest_on" date,
	"peel_condition" text DEFAULT '' NOT NULL,
	"method" "extraction_method" NOT NULL,
	"equipment" text DEFAULT '' NOT NULL,
	"operator_name" text DEFAULT '' NOT NULL,
	"operator_id" uuid,
	"service_supplier_id" uuid,
	"service_fee" integer DEFAULT 0 NOT NULL,
	"other_cost" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_item_id" uuid NOT NULL,
	"output_qty" bigint,
	"output_stock_lot_id" uuid,
	"total_cost" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_runs_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "formula_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"formula_version_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"ppm" integer DEFAULT 0 NOT NULL,
	"is_balance" boolean DEFAULT false NOT NULL,
	"phase" text DEFAULT '' NOT NULL,
	"note" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "formula_lines_ppm_chk" CHECK ("formula_lines"."ppm" >= 0 and "formula_lines"."ppm" <= 1000000)
);
--> statement-breakpoint
CREATE TABLE "formula_packaging" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"formula_version_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty_per_unit" bigint NOT NULL,
	"note" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "formula_packaging_qty_chk" CHECK ("formula_packaging"."qty_per_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "formula_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"formula_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"label" text NOT NULL,
	"status" "formula_version_status" DEFAULT 'draft' NOT NULL,
	"batch_size" bigint NOT NULL,
	"batch_uom" "base_uom" NOT NULL,
	"bulk_density_mg_per_ml" integer,
	"expected_yield_bp" integer DEFAULT 10000 NOT NULL,
	"process_note" text DEFAULT '' NOT NULL,
	"change_note" text DEFAULT '' NOT NULL,
	"based_on_version_id" uuid,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "formula_versions_version_chk" CHECK ("formula_versions"."version" >= 1),
	CONSTRAINT "formula_versions_batch_size_chk" CHECK ("formula_versions"."batch_size" > 0),
	CONSTRAINT "formula_versions_batch_uom_chk" CHECK ("formula_versions"."batch_uom" in ('mg', 'ul')),
	CONSTRAINT "formula_versions_yield_chk" CHECK ("formula_versions"."expected_yield_bp" >= 1 and "formula_versions"."expected_yield_bp" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "formulas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"product_id" uuid,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "formulas_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "production_order_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"role" text NOT NULL,
	"planned_qty" bigint NOT NULL,
	"supplied_by" "material_source" DEFAULT 'pomil' NOT NULL,
	"note" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_order_materials_qty_chk" CHECK ("production_order_materials"."planned_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_order_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"needs_qc" boolean DEFAULT false NOT NULL,
	"operator_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "production_kind" NOT NULL,
	"status" "production_status" DEFAULT 'draft' NOT NULL,
	"product_id" uuid NOT NULL,
	"formula_version_id" uuid,
	"formula_label" text,
	"plan_line_id" uuid,
	"supplier_id" uuid,
	"outsourcing_unit_price" integer,
	"planned_units" integer NOT NULL,
	"planned_bulk" bigint,
	"batch_count" integer,
	"responsible_id" uuid,
	"planned_start" date,
	"planned_end" date,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"actual_bulk" bigint,
	"good_units" integer,
	"rejected_units" integer DEFAULT 0 NOT NULL,
	"manufactured_on" date,
	"expires_on" date,
	"lot_id" uuid,
	"qc_result" "production_qc_result" DEFAULT 'pending' NOT NULL,
	"material_cost" integer DEFAULT 0 NOT NULL,
	"packaging_cost" integer DEFAULT 0 NOT NULL,
	"labor_cost" integer DEFAULT 0 NOT NULL,
	"overhead_cost" integer DEFAULT 0 NOT NULL,
	"outsourcing_cost" integer DEFAULT 0 NOT NULL,
	"other_cost" integer DEFAULT 0 NOT NULL,
	"total_cost" integer DEFAULT 0 NOT NULL,
	"planned_cost" integer,
	"cost_locked_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"cancel_reason" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_orders_code_unique" UNIQUE("code"),
	CONSTRAINT "production_orders_lot_id_unique" UNIQUE("lot_id"),
	CONSTRAINT "production_orders_unit_price_chk" CHECK ("production_orders"."outsourcing_unit_price" is null or "production_orders"."outsourcing_unit_price" >= 0),
	CONSTRAINT "production_orders_planned_units_chk" CHECK ("production_orders"."planned_units" > 0),
	CONSTRAINT "production_orders_good_units_chk" CHECK ("production_orders"."good_units" is null or "production_orders"."good_units" >= 0),
	CONSTRAINT "production_orders_rejected_units_chk" CHECK ("production_orders"."rejected_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_plan_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"formula_version_id" uuid,
	"target_units" integer NOT NULL,
	"planned_start" date,
	"note" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_plan_lines_target_chk" CHECK ("production_plan_lines"."target_units" > 0)
);
--> statement-breakpoint
CREATE TABLE "production_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"period" "plan_period" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_plans_code_unique" UNIQUE("code"),
	CONSTRAINT "production_plans_period_chk" CHECK ("production_plans"."period_end" >= "production_plans"."period_start")
);
--> statement-breakpoint
CREATE TABLE "dealers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"customer_id" uuid,
	"name" text NOT NULL,
	"tier" text DEFAULT '' NOT NULL,
	"contact_name" text,
	"phone_e164" text,
	"email" text,
	"address" text,
	"tax_code" text,
	"contract_no" text,
	"contract_start" date,
	"contract_end" date,
	"contract_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_list_id" uuid,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"commission_bp" integer DEFAULT 0 NOT NULL,
	"credit_limit" integer DEFAULT 0 NOT NULL,
	"payment_terms_days" integer DEFAULT 0 NOT NULL,
	"status" "dealer_status" DEFAULT 'active' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealers_code_unique" UNIQUE("code"),
	CONSTRAINT "dealers_discount_chk" CHECK ("dealers"."discount_bp" >= 0 and "dealers"."discount_bp" <= 10000),
	CONSTRAINT "dealers_commission_chk" CHECK ("dealers"."commission_bp" >= 0 and "dealers"."commission_bp" <= 10000),
	CONSTRAINT "dealers_credit_limit_chk" CHECK ("dealers"."credit_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_price" integer NOT NULL,
	"min_qty" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_items_price_chk" CHECK ("price_list_items"."unit_price" >= 0),
	CONSTRAINT "price_list_items_min_qty_chk" CHECK ("price_list_items"."min_qty" >= 1)
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "price_list_kind" NOT NULL,
	"channel_code" text,
	"valid_from" date,
	"valid_to" date,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "product_bundle_items" (
	"bundle_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_bundle_items_bundle_id_product_id_pk" PRIMARY KEY("bundle_id","product_id"),
	CONSTRAINT "product_bundle_items_qty_chk" CHECK ("product_bundle_items"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"channel_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_bundles_code_unique" UNIQUE("code"),
	CONSTRAINT "product_bundles_price_chk" CHECK ("product_bundles"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "return_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"condition" "return_condition",
	"disposition" "return_disposition",
	"refund_amount" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_request_lines_qty_chk" CHECK ("return_request_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid,
	"dealer_id" uuid,
	"reason" "return_reason" NOT NULL,
	"reason_note" text DEFAULT '' NOT NULL,
	"status" "return_status" DEFAULT 'requested' NOT NULL,
	"resolution" "return_resolution" DEFAULT 'refund' NOT NULL,
	"refund_amount" integer DEFAULT 0 NOT NULL,
	"extra_cost" integer DEFAULT 0 NOT NULL,
	"refund_account_id" uuid,
	"receipt_id" uuid,
	"replacement_order_id" uuid,
	"complaint_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_requests_code_unique" UNIQUE("code"),
	CONSTRAINT "return_requests_refund_chk" CHECK ("return_requests"."refund_amount" >= 0),
	CONSTRAINT "return_requests_extra_cost_chk" CHECK ("return_requests"."extra_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_channels" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "channel_kind" NOT NULL,
	"fee_rate_bp" integer DEFAULT 0 NOT NULL,
	"payout_days" integer DEFAULT 0 NOT NULL,
	"price_list_id" uuid,
	"api_status" text DEFAULT 'not_connected' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_channels_fee_rate_chk" CHECK ("sales_channels"."fee_rate_bp" >= 0 and "sales_channels"."fee_rate_bp" <= 10000),
	CONSTRAINT "sales_channels_payout_days_chk" CHECK ("sales_channels"."payout_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "voucher_kind" NOT NULL,
	"value" integer NOT NULL,
	"min_order" integer DEFAULT 0 NOT NULL,
	"max_discount" integer,
	"channel_code" text,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"usage_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_code_unique" UNIQUE("code"),
	CONSTRAINT "vouchers_value_chk" CHECK ("vouchers"."value" > 0),
	CONSTRAINT "vouchers_used_count_chk" CHECK ("vouchers"."used_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "capa_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capa_id" uuid NOT NULL,
	"description" text NOT NULL,
	"owner_id" uuid,
	"due_on" date,
	"done_at" timestamp with time zone,
	"result" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"type" "capa_type" NOT NULL,
	"title" text NOT NULL,
	"problem" text NOT NULL,
	"ncr_id" uuid,
	"complaint_id" uuid,
	"lot_id" uuid,
	"root_cause_method" text DEFAULT '' NOT NULL,
	"root_cause" text DEFAULT '' NOT NULL,
	"action_plan" text DEFAULT '' NOT NULL,
	"owner_id" uuid,
	"due_on" date,
	"status" "capa_status" DEFAULT 'open' NOT NULL,
	"effectiveness_criteria" text DEFAULT '' NOT NULL,
	"effectiveness_check_on" date,
	"effectiveness_result" text DEFAULT '' NOT NULL,
	"effective" boolean,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capas_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ncrs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"category" "ncr_category" NOT NULL,
	"severity" "ncr_severity" NOT NULL,
	"status" "ncr_status" DEFAULT 'open' NOT NULL,
	"description" text NOT NULL,
	"containment" text DEFAULT '' NOT NULL,
	"root_cause" text DEFAULT '' NOT NULL,
	"correction" text DEFAULT '' NOT NULL,
	"verification_note" text DEFAULT '' NOT NULL,
	"owner_id" uuid,
	"due_on" date,
	"complaint_id" uuid,
	"lot_id" uuid,
	"stock_lot_id" uuid,
	"production_order_id" uuid,
	"extraction_run_id" uuid,
	"inspection_id" uuid,
	"supplier_id" uuid,
	"return_request_id" uuid,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ncrs_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "qc_inspection_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"param_id" uuid,
	"name" text NOT NULL,
	"param_group" "qc_param_group" NOT NULL,
	"kind" "qc_param_kind" NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"min_milli" bigint,
	"max_milli" bigint,
	"expected_text" text,
	"is_critical" boolean DEFAULT true NOT NULL,
	"value_milli" bigint,
	"value_text" text,
	"passed" boolean,
	"note" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"stage" "inspection_stage" NOT NULL,
	"status" "inspection_status" DEFAULT 'pending' NOT NULL,
	"standard_id" uuid,
	"stock_receipt_id" uuid,
	"stock_receipt_line_id" uuid,
	"stock_lot_id" uuid,
	"lot_id" uuid,
	"production_order_id" uuid,
	"production_step_id" uuid,
	"extraction_run_id" uuid,
	"supplier_id" uuid,
	"complaint_id" uuid,
	"sample_size" text DEFAULT '' NOT NULL,
	"inspected_by" uuid,
	"inspected_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"disposition" "inspection_disposition",
	"decision_note" text,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qc_inspections_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "qc_standard_params" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"standard_id" uuid NOT NULL,
	"name" text NOT NULL,
	"param_group" "qc_param_group" NOT NULL,
	"kind" "qc_param_kind" NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"min_milli" bigint,
	"max_milli" bigint,
	"expected_text" text,
	"method" text DEFAULT '' NOT NULL,
	"lot_test_type" "lot_test_type",
	"is_critical" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"applies_to" "qc_applies_to" NOT NULL,
	"item_id" uuid,
	"product_id" uuid,
	"status" "qc_standard_status" DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recall_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recall_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid,
	"dealer_id" uuid,
	"status" "recall_contact_status" DEFAULT 'pending' NOT NULL,
	"contacted_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recall_lots" (
	"recall_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recall_lots_recall_id_lot_id_pk" PRIMARY KEY("recall_id","lot_id")
);
--> statement-breakpoint
CREATE TABLE "recalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"status" "recall_status" DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"severity" "ncr_severity" NOT NULL,
	"ncr_id" uuid,
	"opened_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recalls_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"budget_group" "budget_group" NOT NULL,
	"category_id" uuid,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_lines_amount_chk" CHECK ("budget_lines"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"period" "budget_period" NOT NULL,
	"period_start" date NOT NULL,
	"status" "budget_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "cash_account_kind" NOT NULL,
	"bank_name" text,
	"account_no" text,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"opening_on" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cash_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"system_balance" integer NOT NULL,
	"actual_balance" integer NOT NULL,
	"difference" integer NOT NULL,
	"adjustment_tx_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"direction" "cash_direction" NOT NULL,
	"status" "cash_tx_status" DEFAULT 'posted' NOT NULL,
	"account_id" uuid NOT NULL,
	"to_account_id" uuid,
	"amount" integer NOT NULL,
	"category_id" uuid,
	"occurred_on" date NOT NULL,
	"counterparty_type" text,
	"counterparty_id" uuid,
	"counterparty_name" text DEFAULT '' NOT NULL,
	"channel_code" text,
	"source_type" text,
	"source_id" uuid,
	"source_code" text,
	"idempotency_key" text,
	"note" text,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"cancelled_by" uuid,
	"approved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_transactions_code_unique" UNIQUE("code"),
	CONSTRAINT "cash_transactions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "cash_transactions_amount_chk" CHECK ("cash_transactions"."amount" > 0),
	CONSTRAINT "cash_transactions_transfer_to_chk" CHECK (("cash_transactions"."direction" = 'transfer') = ("cash_transactions"."to_account_id" is not null)),
	CONSTRAINT "cash_transactions_transfer_category_chk" CHECK (("cash_transactions"."direction" = 'transfer') = ("cash_transactions"."category_id" is null))
);
--> statement-breakpoint
CREATE TABLE "debt_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receivable_id" uuid,
	"payable_id" uuid,
	"amount" integer NOT NULL,
	"paid_on" date NOT NULL,
	"cash_transaction_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debt_payments_amount_chk" CHECK ("debt_payments"."amount" > 0),
	CONSTRAINT "debt_payments_one_debt_chk" CHECK (("debt_payments"."receivable_id" is not null) <> ("debt_payments"."payable_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "finance_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"direction" text NOT NULL,
	"pl_line" "pl_line" NOT NULL,
	"budget_group" "budget_group",
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_categories_code_unique" UNIQUE("code"),
	CONSTRAINT "finance_categories_direction_chk" CHECK ("finance_categories"."direction" in ('in', 'out'))
);
--> statement-breakpoint
CREATE TABLE "overhead_allocation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"production_order_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overhead_allocation_lines_amount_chk" CHECK ("overhead_allocation_lines"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "overhead_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"period_month" date NOT NULL,
	"total_amount" integer NOT NULL,
	"basis" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overhead_allocations_code_unique" UNIQUE("code"),
	CONSTRAINT "overhead_allocations_total_chk" CHECK ("overhead_allocations"."total_amount" > 0),
	CONSTRAINT "overhead_allocations_basis_chk" CHECK ("overhead_allocations"."basis" in ('units', 'bulk'))
);
--> statement-breakpoint
CREATE TABLE "payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"source_code" text,
	"amount" integer NOT NULL,
	"paid_amount" integer DEFAULT 0 NOT NULL,
	"status" "debt_status" DEFAULT 'open' NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"note" text,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payables_code_unique" UNIQUE("code"),
	CONSTRAINT "payables_amount_chk" CHECK ("payables"."amount" > 0),
	CONSTRAINT "payables_paid_chk" CHECK ("payables"."paid_amount" >= 0 and "payables"."paid_amount" <= "payables"."amount")
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"party" "ar_party" NOT NULL,
	"customer_id" uuid,
	"dealer_id" uuid,
	"channel_code" text,
	"order_id" uuid,
	"amount" integer NOT NULL,
	"paid_amount" integer DEFAULT 0 NOT NULL,
	"status" "debt_status" DEFAULT 'open' NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"note" text,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receivables_code_unique" UNIQUE("code"),
	CONSTRAINT "receivables_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "receivables_amount_chk" CHECK ("receivables"."amount" > 0),
	CONSTRAINT "receivables_paid_chk" CHECK ("receivables"."paid_amount" >= 0 and "receivables"."paid_amount" <= "receivables"."amount")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "dev_stage" "product_dev_stage" DEFAULT 'developing' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "net_qty" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "net_uom" "base_uom";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "pack_spec" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "units_per_carton" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "track_inventory" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "retained_samples" ADD COLUMN "stock_issue_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "split_from_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "voucher_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "platform_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "dealer_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stock_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "return_type" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_default_supplier_id_suppliers_id_fk" FOREIGN KEY ("default_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_default_warehouse_id_warehouses_id_fk" FOREIGN KEY ("default_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_warehouse_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_location_id_warehouse_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_issue_id_stock_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."stock_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_location_id_warehouse_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_lot_id_lots_id_fk" FOREIGN KEY ("product_lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_warehouse_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversal_of_stock_movements_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_receipt_id_stock_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_location_id_warehouse_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_product_lot_id_lots_id_fk" FOREIGN KEY ("product_lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_from_location_id_warehouse_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_to_location_id_warehouse_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_source_supplier_id_suppliers_id_fk" FOREIGN KEY ("source_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_service_supplier_id_suppliers_id_fk" FOREIGN KEY ("service_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_output_item_id_inventory_items_id_fk" FOREIGN KEY ("output_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_output_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("output_stock_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_lines" ADD CONSTRAINT "formula_lines_formula_version_id_formula_versions_id_fk" FOREIGN KEY ("formula_version_id") REFERENCES "public"."formula_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_lines" ADD CONSTRAINT "formula_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_packaging" ADD CONSTRAINT "formula_packaging_formula_version_id_formula_versions_id_fk" FOREIGN KEY ("formula_version_id") REFERENCES "public"."formula_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_packaging" ADD CONSTRAINT "formula_packaging_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_versions" ADD CONSTRAINT "formula_versions_formula_id_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."formulas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_versions" ADD CONSTRAINT "formula_versions_based_on_version_id_formula_versions_id_fk" FOREIGN KEY ("based_on_version_id") REFERENCES "public"."formula_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_materials" ADD CONSTRAINT "production_order_materials_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_materials" ADD CONSTRAINT "production_order_materials_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_steps" ADD CONSTRAINT "production_order_steps_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_formula_version_id_formula_versions_id_fk" FOREIGN KEY ("formula_version_id") REFERENCES "public"."formula_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_plan_line_id_production_plan_lines_id_fk" FOREIGN KEY ("plan_line_id") REFERENCES "public"."production_plan_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_plan_id_production_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."production_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_formula_version_id_formula_versions_id_fk" FOREIGN KEY ("formula_version_id") REFERENCES "public"."formula_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_channel_code_sales_channels_code_fk" FOREIGN KEY ("channel_code") REFERENCES "public"."sales_channels"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundle_items" ADD CONSTRAINT "product_bundle_items_bundle_id_product_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."product_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundle_items" ADD CONSTRAINT "product_bundle_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_request_lines" ADD CONSTRAINT "return_request_lines_return_id_return_requests_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."return_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_request_lines" ADD CONSTRAINT "return_request_lines_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_receipt_id_stock_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_replacement_order_id_orders_id_fk" FOREIGN KEY ("replacement_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_capa_id_capas_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_ncr_id_ncrs_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncrs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_inspection_id_qc_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."qc_inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspection_results" ADD CONSTRAINT "qc_inspection_results_inspection_id_qc_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."qc_inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspection_results" ADD CONSTRAINT "qc_inspection_results_param_id_qc_standard_params_id_fk" FOREIGN KEY ("param_id") REFERENCES "public"."qc_standard_params"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_standard_id_qc_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."qc_standards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_stock_receipt_id_stock_receipts_id_fk" FOREIGN KEY ("stock_receipt_id") REFERENCES "public"."stock_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_stock_receipt_line_id_stock_receipt_lines_id_fk" FOREIGN KEY ("stock_receipt_line_id") REFERENCES "public"."stock_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_production_step_id_production_order_steps_id_fk" FOREIGN KEY ("production_step_id") REFERENCES "public"."production_order_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_standard_params" ADD CONSTRAINT "qc_standard_params_standard_id_qc_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."qc_standards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_standards" ADD CONSTRAINT "qc_standards_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_standards" ADD CONSTRAINT "qc_standards_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_contacts" ADD CONSTRAINT "recall_contacts_recall_id_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "public"."recalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_contacts" ADD CONSTRAINT "recall_contacts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_contacts" ADD CONSTRAINT "recall_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_contacts" ADD CONSTRAINT "recall_contacts_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_lots" ADD CONSTRAINT "recall_lots_recall_id_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "public"."recalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_lots" ADD CONSTRAINT "recall_lots_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_ncr_id_ncrs_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncrs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_account_id_cash_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_adjustment_tx_id_cash_transactions_id_fk" FOREIGN KEY ("adjustment_tx_id") REFERENCES "public"."cash_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_account_id_cash_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_to_account_id_cash_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_receivable_id_receivables_id_fk" FOREIGN KEY ("receivable_id") REFERENCES "public"."receivables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_payable_id_payables_id_fk" FOREIGN KEY ("payable_id") REFERENCES "public"."payables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_cash_transaction_id_cash_transactions_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "public"."cash_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_allocation_lines" ADD CONSTRAINT "overhead_allocation_lines_allocation_id_overhead_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."overhead_allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_allocation_lines" ADD CONSTRAINT "overhead_allocation_lines_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_channel_code_sales_channels_code_fk" FOREIGN KEY ("channel_code") REFERENCES "public"."sales_channels"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_balances_item_warehouse_idx" ON "stock_balances" USING btree ("item_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_balances_lot_idx" ON "stock_balances" USING btree ("stock_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_lines_uq" ON "stock_count_lines" USING btree ("count_id","location_id","stock_lot_id");--> statement-breakpoint
CREATE INDEX "stock_issue_lines_issue_idx" ON "stock_issue_lines" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "stock_lots_item_expires_idx" ON "stock_lots" USING btree ("item_id","expires_on");--> statement-breakpoint
CREATE INDEX "stock_movements_item_time_idx" ON "stock_movements" USING btree ("item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movements_lot_time_idx" ON "stock_movements" USING btree ("stock_lot_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movements_doc_idx" ON "stock_movements" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE INDEX "stock_movements_order_item_idx" ON "stock_movements" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "stock_movements_production_order_idx" ON "stock_movements" USING btree ("production_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_reversal_of_uq" ON "stock_movements" USING btree ("reversal_of") WHERE "stock_movements"."reversal_of" is not null;--> statement-breakpoint
CREATE INDEX "stock_receipt_lines_receipt_idx" ON "stock_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_lines_transfer_idx" ON "stock_transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_locations_code_uq" ON "warehouse_locations" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_locations_default_uq" ON "warehouse_locations" USING btree ("warehouse_id") WHERE "warehouse_locations"."is_default";--> statement-breakpoint
CREATE INDEX "formula_lines_version_idx" ON "formula_lines" USING btree ("formula_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "formula_lines_balance_uq" ON "formula_lines" USING btree ("formula_version_id") WHERE "formula_lines"."is_balance";--> statement-breakpoint
CREATE INDEX "formula_packaging_version_idx" ON "formula_packaging" USING btree ("formula_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "formula_versions_version_uq" ON "formula_versions" USING btree ("formula_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "formula_versions_approved_uq" ON "formula_versions" USING btree ("formula_id") WHERE "formula_versions"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "production_order_materials_uq" ON "production_order_materials" USING btree ("production_order_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_order_steps_seq_uq" ON "production_order_steps" USING btree ("production_order_id","seq");--> statement-breakpoint
CREATE INDEX "production_orders_status_start_idx" ON "production_orders" USING btree ("status","planned_start");--> statement-breakpoint
CREATE INDEX "production_orders_product_idx" ON "production_orders" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "production_plan_lines_plan_idx" ON "production_plan_lines" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_uq" ON "price_list_items" USING btree ("price_list_id","product_id","min_qty");--> statement-breakpoint
CREATE INDEX "return_request_lines_return_idx" ON "return_request_lines" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "return_requests_order_idx" ON "return_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "return_requests_status_idx" ON "return_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "capa_actions_capa_idx" ON "capa_actions" USING btree ("capa_id");--> statement-breakpoint
CREATE INDEX "capas_status_idx" ON "capas" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "ncrs_status_idx" ON "ncrs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "qc_inspection_results_inspection_idx" ON "qc_inspection_results" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "qc_inspections_stage_status_idx" ON "qc_inspections" USING btree ("stage","status");--> statement-breakpoint
CREATE UNIQUE INDEX "qc_inspections_pending_stock_lot_uq" ON "qc_inspections" USING btree ("stage","stock_lot_id") WHERE "qc_inspections"."status" = 'pending' and "qc_inspections"."stock_lot_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "qc_inspections_pending_lot_uq" ON "qc_inspections" USING btree ("stage","lot_id") WHERE "qc_inspections"."status" = 'pending' and "qc_inspections"."lot_id" is not null;--> statement-breakpoint
CREATE INDEX "qc_standard_params_standard_idx" ON "qc_standard_params" USING btree ("standard_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qc_standards_code_version_uq" ON "qc_standards" USING btree ("code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "qc_standards_active_uq" ON "qc_standards" USING btree ("code") WHERE "qc_standards"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "recall_contacts_order_uq" ON "recall_contacts" USING btree ("recall_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_uq" ON "budget_lines" USING btree ("budget_id","budget_group",coalesce("category_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_period_uq" ON "budgets" USING btree ("period","period_start");--> statement-breakpoint
CREATE INDEX "cash_transactions_account_date_idx" ON "cash_transactions" USING btree ("account_id","occurred_on");--> statement-breakpoint
CREATE INDEX "cash_transactions_source_idx" ON "cash_transactions" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "cash_transactions_category_date_idx" ON "cash_transactions" USING btree ("category_id","occurred_on");--> statement-breakpoint
CREATE INDEX "debt_payments_receivable_idx" ON "debt_payments" USING btree ("receivable_id");--> statement-breakpoint
CREATE INDEX "debt_payments_payable_idx" ON "debt_payments" USING btree ("payable_id");--> statement-breakpoint
CREATE INDEX "overhead_allocation_lines_po_idx" ON "overhead_allocation_lines" USING btree ("production_order_id");--> statement-breakpoint
CREATE INDEX "payables_status_due_idx" ON "payables" USING btree ("status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "payables_source_uq" ON "payables" USING btree ("source_type","source_id") WHERE "payables"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "receivables_status_due_idx" ON "receivables" USING btree ("status","due_on");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_split_from_id_order_items_id_fk" FOREIGN KEY ("split_from_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_barcode_uq" ON "products" USING btree ("barcode") WHERE "products"."barcode" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_channel_external_ref_uq" ON "orders" USING btree ("channel","external_ref") WHERE "orders"."external_ref" is not null;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_net_qty_uom_chk" CHECK (("products"."net_qty" is null) = ("products"."net_uom" is null));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_net_uom_chk" CHECK ("products"."net_uom" is null or "products"."net_uom" <> 'pcs');--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_units_per_carton_chk" CHECK ("products"."units_per_carton" is null or "products"."units_per_carton" > 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_total_chk" CHECK ("orders"."discount_total" >= 0 and "orders"."discount_total" <= "orders"."subtotal");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_platform_fee_chk" CHECK ("orders"."platform_fee" >= 0);