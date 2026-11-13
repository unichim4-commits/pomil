import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listSuppliers } from "@/modules/inventory/admin";
import { Badge, PageHeader } from "../../_components/ui";
import { DataList, TapLink } from "../_components/data-list";
import { SUPPLIER_KIND_LABEL } from "../_lib/labels";

export const metadata: Metadata = { title: "Nhà cung cấp" };

export default async function SuppliersPage() {
  const [staff, db] = await Promise.all([requireStaff(), getDb()]);
  const rows = await listSuppliers(db);
  return (
    <>
      <PageHeader
        title="Nhà cung cấp"
        description="Nhà cung cấp nguyên liệu, bao bì, nhà máy gia công, vườn bưởi. Hạn trả dùng để tính hạn công nợ khi nhập mua."
        actions={
          can(staff.role, "inventory.write") && (
            <Link href="/admin/kho/nha-cung-cap/moi" className="btn btn-primary">
              Thêm nhà cung cấp
            </Link>
          )
        }
      />
      <DataList
        rows={rows}
        rowKey={(r) => r.id}
        empty="Chưa có nhà cung cấp."
        cols={[
          {
            label: "Mã",
            cell: (r) => (
              <TapLink href={`/admin/kho/nha-cung-cap/${r.id}`} className="font-mono">
                {r.code}
              </TapLink>
            ),
          },
          { label: "Tên", cell: (r) => r.name },
          { label: "Loại", cell: (r) => SUPPLIER_KIND_LABEL[r.kind] },
          { label: "Hạn trả", cell: (r) => (r.paymentTermsDays ? `${r.paymentTermsDays} ngày` : "Trả ngay") },
          {
            label: "Trạng thái",
            cell: (r) => (
              <span className="flex flex-wrap gap-1">
                {r.qualified ? <Badge tone="green">Đã đánh giá</Badge> : <Badge tone="amber">Chưa đánh giá</Badge>}
                {!r.isActive && <Badge>Ngừng dùng</Badge>}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
