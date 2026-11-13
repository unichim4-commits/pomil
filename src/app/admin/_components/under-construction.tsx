import Link from "next/link";
import { Card, PageHeader } from "./ui";

// Trang chờ cho phân hệ ERP chưa có màn hình (T-14a). Dev phân hệ thay bằng trang thật và xóa catch-all [...slug].
export function UnderConstruction({ title, module }: { title: string; module: string }) {
  return (
    <>
      <PageHeader title={title} description={`Phân hệ ${module} đang xây dựng.`} />
      <Card>
        <p className="text-sm text-ink-soft">Màn hình này chưa có. Dữ liệu và quy trình cũ vẫn dùng bình thường.</p>
        <Link href="/admin" className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">
          ← Về Tổng quan
        </Link>
      </Card>
    </>
  );
}
