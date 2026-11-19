ALTER TABLE "product_reviews" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "lot_id" uuid;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "reported_lot_no" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "age_range" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "scalp_type" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "concerns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "habits" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "usage_frequency" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "compared_before" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "scent_intensity" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "aspect_ratings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "nps" integer;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "follow_up_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "issue_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "action_status" text DEFAULT 'chua_xu_ly' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "action_taken" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_reviews_lot_idx" ON "product_reviews" USING btree ("lot_id");