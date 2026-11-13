import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listFormulas } from "@/modules/production/formulas";
import { VERSION_STATUS_LABEL } from "@/modules/production/rules";
import { DataList, TapLink } from "../../kho/_components/data-list";
import { Badge, PageHeader } from "../../_components/ui";
import { actorOf } from "../_lib/data";
import { VERSION_TONE } from "../_lib/view";

export const metadata: Metadata = { title: "Công thức" };

export default async function FormulasPage() {
  const staff = await requireStaff();
  // R-SX-10: không có formulas.view thì không thấy tỷ lệ công thức
  if (!can(staff.role, "formulas.view")) notFound();
  const db = await getDb();
  const rows = await listFormulas(db, actorOf(staff));

  return (
    <>
      <PageHeader
        title="Công thức"
        description="Mỗi công thức có nhiều phiên bản. Chỉ bản nháp sửa được; bản đã duyệt dùng cho lệnh tự làm."
        actions={
          can(staff.role, "formulas.write") ? (
            <Link href="/admin/san-xuat/cong-thuc/moi" className="btn btn-primary min-h-11">
              Tạo công thức
            </Link>
          ) : undefined
        }
      />
      <DataList
        rows={rows}
        rowKey={(r) => r.id}
        empty="Chưa có công thức nào."
        cols={[
          { label: "Công thức", cell: (r) => <TapLink href={`/admin/san-xuat/cong-thuc/${r.id}`}>{r.name}</TapLink> },
          { label: "Mã", cell: (r) => <span className="font-mono">{r.code}</span> },
          { label: "Sản phẩm", cell: (r) => r.productName ?? "—" },
          { label: "Bản hiện hành", cell: (r) => (r.current ? <Badge tone="green">{r.current.label}</Badge> : <span className="text-ink-soft">Chưa duyệt</span>) },
          { label: "Bản mới nhất", cell: (r) => (r.latest ? <Badge tone={VERSION_TONE[r.latest.status]}>{`${r.latest.label} · ${VERSION_STATUS_LABEL[r.latest.status]}`}</Badge> : "—") },
          { label: "Cập nhật", cell: (r) => formatDate(r.updatedAt), hideOnCard: true },
        ]}
      />
    </>
  );
}
