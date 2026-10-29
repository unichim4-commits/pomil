import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getProduct } from "@/modules/catalog/service";
import { Card, PageHeader } from "../../_components/ui";
import { StockAdjustForm } from "../stock-adjust-form";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Sửa sản phẩm" };

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ moi?: string }> }) {
  const [{ id }, { moi }] = await Promise.all([params, searchParams]);
  const [staff, product] = await Promise.all([requireStaff(), getProduct(id)]);
  if (!product) notFound();
  const visible = product.status === "active" || product.status === "coming_soon";

  return (
    <>
      <Link href="/admin/san-pham" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Sản phẩm
      </Link>
      <div className="mt-3">
        <PageHeader
          title={product.name}
          description={`Mã ${product.code} · /san-pham/${product.slug}`}
          actions={
            visible && (
              <Link href={`/san-pham/${product.slug}`} target="_blank" className="btn btn-outline">
                Xem trên web ↗
              </Link>
            )
          }
        />
      </div>
      {moi && <p className="mb-6 border border-rind/40 bg-rind/10 p-3 text-sm">Đã tạo sản phẩm.</p>}
      {can(staff.role, "products.write") && (
        <div id="ton-kho" className="mb-6 max-w-2xl scroll-mt-20">
          <Card title="Điều chỉnh tồn kho">
            <StockAdjustForm productId={product.id} productName={product.name} stock={product.stock} />
          </Card>
        </div>
      )}
      <ProductForm product={product} canWrite={can(staff.role, "products.write")} />
    </>
  );
}
