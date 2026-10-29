-- Bảng tài khoản khách và đánh giá: bật RLS giống 0001, không policy nào.
ALTER TABLE "customer_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_reviews" ENABLE ROW LEVEL SECURITY;
