CREATE TYPE "public"."review_status" AS ENUM('new', 'published', 'hidden');--> statement-breakpoint
CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"scent_rating" integer,
	"scalp_feel" text,
	"would_rebuy" text,
	"used_for" text,
	"comment" text DEFAULT '' NOT NULL,
	"suggestion" text DEFAULT '' NOT NULL,
	"publish_consent" boolean DEFAULT false NOT NULL,
	"verified_purchase" boolean DEFAULT false NOT NULL,
	"status" "review_status" DEFAULT 'new' NOT NULL,
	"staff_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_customer_uq" ON "customer_accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_sessions_account_idx" ON "customer_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_account_product_uq" ON "product_reviews" USING btree ("account_id","product_id");--> statement-breakpoint
CREATE INDEX "product_reviews_product_status_idx" ON "product_reviews" USING btree ("product_id","status");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_account_idx" ON "orders" USING btree ("account_id","created_at");