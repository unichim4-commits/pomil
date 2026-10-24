import type { Metadata } from "next";
import Link from "next/link";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listAllProducts } from "@/modules/catalog/service";
import { Badge, PageHeader, Table, type BadgeTone } from "../_components/ui";
import { StockAdjustForm } from "./stock-adjust-form";

export const metadata: Metadata = { title: "Sản phẩm" };

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Nháp", tone: "neutral" },
  coming_soon: { label: "Sắp ra mắt", tone: "amber" },
  active: { label: "Đang bán", tone: "green" },
  archived: { label: "Ngừng bán", tone: "red" },
};

export default async function ProductsAdminPage() {
  const [staff, products] = await Promise.all([requireStaff(), listAllProducts()]);
  const canWrite = can(staff.role, "products.write");

  return (
    <>
      <PageHeader
        title="Sản phẩm"
        description="Giá, tồn kho và nội dung hiển thị trên web. Tồn kho tự trừ khi khách đặt và tự cộng lại khi hủy đơn. Nhập hàng hoặc hỏng: chọn Nhập thêm hoặc Bớt đi, ghi số chai và lý do."
        actions={
          canWrite && (
            <Link href="/admin/san-pham/moi" className="btn btn-primary">
              Thêm sản phẩm
            </Link>
          )
        }
      />
      {/* Điện thoại (< 640 px): thẻ dọc, thấy tồn kho không phải kéo ngang; điều chỉnh ở trang sửa */}
      <ul className="space-y-3 sm:hidden">
        {products.map((p) => (
          <li key={p.id} className="border border-line bg-paper p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/admin/san-pham/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                {p.name}
              </Link>
              <Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status]?.label}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              <span className="font-mono">{p.code}</span> · {p.size} · {formatVnd(p.price)}
              {p.featured && " · chủ lực"}
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-sm">
                Tồn kho: <span className="whitespace-nowrap tabular-nums">{p.stock} chai</span>
              </p>
              {canWrite && (
                <Link href={`/admin/san-pham/${p.id}#ton-kho`} className="btn btn-outline whitespace-nowrap px-4 text-sm" aria-label={`Điều chỉnh tồn kho ${p.name}`}>
                  Điều chỉnh
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table>
          <thead>
            <tr>
              <th>Sản phẩm</th>
              <th>Mã</th>
              <th>Giá</th>
              <th>Tồn kho</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-bone">
                <td>
                  <Link href={`/admin/san-pham/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                    {p.name}
                  </Link>
                  <span className="block text-xs text-ink-soft">
                    {p.size} {p.featured && "· chủ lực"}
                  </span>
                </td>
                <td className="font-mono text-xs">{p.code}</td>
                <td className="tabular-nums">{formatVnd(p.price)}</td>
                <td>
                  {canWrite ? (
                    <StockAdjustForm productId={p.id} productName={p.name} stock={p.stock} compact />
                  ) : (
                    <span className="whitespace-nowrap tabular-nums">{p.stock} chai</span>
                  )}
                </td>
                <td>
                  <Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status]?.label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}
