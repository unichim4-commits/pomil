-- Bật RLS cho mọi bảng và không tạo policy nào: khóa anon và authenticated của Supabase
-- không đọc ghi được dữ liệu qua API REST. Ứng dụng kết nối bằng DATABASE_URL (vai trò postgres)
-- nên không bị RLS chặn. Khi cần cho trình duyệt truy cập trực tiếp thì thêm policy cụ thể.
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "touchpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cosmetic_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lot_materials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lot_tests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retained_samples" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "complaints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
