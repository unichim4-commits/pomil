import type { Metadata } from "next";
import { NotFoundView } from "@/components/not-found-view";

export const metadata: Metadata = { title: "Không tìm thấy trang", robots: { index: false } };

// Trang lỗi trong khu cửa hàng: giữ đầu trang và chân trang của cửa hàng.
export default function PublicNotFound() {
  return <NotFoundView />;
}
