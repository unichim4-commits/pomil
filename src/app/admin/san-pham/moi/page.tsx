import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { PageHeader } from "../../_components/ui";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Thêm sản phẩm" };

export default async function NewProductPage() {
  const staff = await requireStaff();
  return (
    <>
      <Link href="/admin/san-pham" className="text-sm text-ink-soft hover:text-graphite">
        ← Sản phẩm
      </Link>
      <div className="mt-3">
        <PageHeader title="Thêm sản phẩm" description="Lưu ở trạng thái Nháp trước, kiểm tra trang xem trước rồi mới chuyển sang Đang bán." />
      </div>
      <ProductForm product={null} canWrite={can(staff.role, "products.write")} />
    </>
  );
}
