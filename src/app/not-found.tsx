import type { Metadata } from "next";
import { NotFoundView } from "@/components/not-found-view";

export const metadata: Metadata = { title: "Không tìm thấy trang", robots: { index: false } };

// Trang lỗi toàn cục (đường dẫn ngoài khu cửa hàng, ví dụ /admin/…/không-có).
export default function NotFound() {
  return (
    <main className="min-h-screen bg-bone">
      <NotFoundView withLogo />
    </main>
  );
}
