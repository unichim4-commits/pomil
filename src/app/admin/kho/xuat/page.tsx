import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listIssues } from "@/modules/inventory/admin";
import { Badge, PageHeader } from "../../_components/ui";
import { DataList, TapLink } from "../_components/data-list";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE, ISSUE_KIND_LABEL } from "../_lib/labels";

export const metadata: Metadata = { title: "Xuất kho" };

export default async function IssuesPage({ searchParams }: { searchParams: Promise<{ loai?: string; tt?: string }> }) {
  const [sp, staff, db] = await Promise.all([searchParams, requireStaff(), getDb()]);
  const kind = sp.loai && sp.loai in ISSUE_KIND_LABEL ? sp.loai : null;
  const status = sp.tt && sp.tt in DOC_STATUS_LABEL ? sp.tt : null;
  const rows = await listIssues(db, { kind, status });
  return (
    <>
      <PageHeader
        title="Xuất kho"
        description="Phiếu xuất tay: mẫu tặng, mẫu lưu, hủy, nghiên cứu, trả NCC. Cộng tác viên lập và gửi duyệt; chủ cửa hàng duyệt và ghi sổ. Xuất sản xuất và xuất bán do phân hệ khác tạo."
        actions={
          can(staff.role, "inventory.write") && (
            <Link href="/admin/kho/xuat/moi" className="btn btn-primary">
              Lập phiếu xuất
            </Link>
          )
        }
      />
      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-3 sm:items-end">
        <label className="block">
          <span className="field-label">Loại</span>
          <select name="loai" defaultValue={kind ?? ""} className="field">
            <option value="">Mọi loại</option>
            {Object.entries(ISSUE_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Trạng thái</span>
          <select name="tt" defaultValue={status ?? ""} className="field">
            <option value="">Mọi trạng thái</option>
            {Object.entries(DOC_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-outline">Lọc</button>
      </form>
      <DataList
        rows={rows}
        rowKey={(r) => r.id}
        empty="Chưa có phiếu xuất."
        cols={[
          {
            label: "Phiếu",
            cell: (r) => (
              <TapLink href={`/admin/kho/xuat/${r.id}`} className="font-mono">
                {r.code}
              </TapLink>
            ),
          },
          { label: "Loại", cell: (r) => ISSUE_KIND_LABEL[r.kind] },
          { label: "Mục đích", cell: (r) => r.purpose || "–" },
          { label: "Người lập", cell: (r) => r.requestedName || "–" },
          { label: "Lúc lập", cell: (r) => formatDateTime(r.createdAt) },
          { label: "Dòng", cell: (r) => r.lines, className: "tabular-nums" },
          { label: "Trạng thái", cell: (r) => <Badge tone={DOC_STATUS_TONE[r.status]}>{DOC_STATUS_LABEL[r.status]}</Badge> },
        ]}
      />
    </>
  );
}
