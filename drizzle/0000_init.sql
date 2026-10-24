CREATE TYPE "public"."consent_channel" AS ENUM('zalo', 'sms', 'email', 'any');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('marketing_message', 'photo_use', 'trial_participation', 'data_processing');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_stage" AS ENUM('lead', 'tester', 'first_buyer', 'repeat_buyer', 'ambassador', 'churned');--> statement-breakpoint
CREATE TYPE "public"."complaint_severity" AS ENUM('mild', 'moderate', 'severe');--> statement-breakpoint
CREATE TYPE "public"."complaint_status" AS ENUM('open', 'responded', 'investigating', 'closed');--> statement-breakpoint
CREATE TYPE "public"."lot_release_status" AS ENUM('quarantine', 'released', 'on_hold', 'recalled');--> statement-breakpoint
CREATE TYPE "public"."lot_test_result" AS ENUM('pass', 'fail', 'pending');--> statement-breakpoint
CREATE TYPE "public"."lot_test_type" AS ENUM('microbial', 'heavy_metals', 'stability', 'gc_ms', 'irritation', 'sensory');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('owner', 'collaborator', 'viewer');--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"channel" "consent_channel" DEFAULT 'any' NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"source" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text,
	"zalo_user_id" text,
	"name" text,
	"lifecycle_stage" "lifecycle_stage" DEFAULT 'lead' NOT NULL,
	"scalp_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_touch_utm" jsonb,
	"last_touch_utm" jsonb,
	"landing_variant" text,
	"referral_code" text NOT NULL,
	"referred_by_customer_id" uuid,
	"koc_id" uuid,
	"expected_runout_date" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "touchpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"lot_id" uuid,
	"sample_code" text,
	"contact_phone" text,
	"started_using_on" date,
	"symptoms" text NOT NULL,
	"severity" "complaint_severity" NOT NULL,
	"photo_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "complaint_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_response_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"root_cause" text,
	"corrective_action" text
);
--> statement-breakpoint
CREATE TABLE "lot_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"material_code" text NOT NULL,
	"supplier_lot_no" text,
	"coa_file_id" uuid,
	"quantity" text
);
--> statement-breakpoint
CREATE TABLE "lot_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"type" "lot_test_type" NOT NULL,
	"result" "lot_test_result" DEFAULT 'pending' NOT NULL,
	"lab" text,
	"report_no" text,
	"file_id" uuid,
	"is_public" boolean DEFAULT true NOT NULL,
	"tested_on" date
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_no" text NOT NULL,
	"product_id" uuid NOT NULL,
	"formula_version" text NOT NULL,
	"factory" text,
	"manufactured_on" date NOT NULL,
	"expires_on" date NOT NULL,
	"units_produced" integer NOT NULL,
	"release_status" "lot_release_status" DEFAULT 'quarantine' NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"hold_reason" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cosmetic_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_at" date NOT NULL,
	"expires_at" date NOT NULL,
	"file_id" uuid
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "retained_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"units" integer NOT NULL,
	"location" text NOT NULL,
	"keep_until" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" "staff_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_materials" ADD CONSTRAINT "lot_materials_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_tests" ADD CONSTRAINT "lot_tests_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmetic_notifications" ADD CONSTRAINT "cosmetic_notifications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retained_samples" ADD CONSTRAINT "retained_samples_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_customer_purpose_idx" ON "consents" USING btree ("customer_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_uq" ON "customers" USING btree ("phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_zalo_uq" ON "customers" USING btree ("zalo_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_referral_code_uq" ON "customers" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "customers_stage_idx" ON "customers" USING btree ("lifecycle_stage");--> statement-breakpoint
CREATE INDEX "touchpoints_customer_idx" ON "touchpoints" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "complaints_lot_opened_idx" ON "complaints" USING btree ("lot_id","opened_at");--> statement-breakpoint
CREATE INDEX "lot_tests_lot_idx" ON "lot_tests" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lots_lot_no_uq" ON "lots" USING btree ("lot_no");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");