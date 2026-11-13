import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listTransfers } from "@/modules/inventory/admin";
import { Badge, PageHeader } from "../../_components/ui";
import { DataList, TapLink } from "../_components/data-list";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE } from "../_lib/labels";

export const metadata: Metadata = { title: "Điều chuyển" };

export default async function TransfersPage({ searchParams }: { searchParams: Promise<{ tt?: string }> }) {
  const [sp, staff, db] = await Promise.all([searchParams, requireStaff(), getDb()]);
  const status = sp.tt && sp.tt in DOC_STATUS_LABEL ? sp.tt : null;
  const rows = await listTransfers(db, { status });
  return (
    <>
      <PageHeader
        title="Điều chuyển"
        description="Chuyển lô giữa các kho hoặc vị trí. Lô giữ nguyên mã, HSD và giá trị."
        actions={
          can(staff.role, "inventory.write") && (
            <Link href="/admin/kho/dieu-chuyen/moi" className="btn btn-primary">
              Lập phiếu điều chuyển
            </Link>
          )
        }
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="field-label">Trạng thái</span>
          <select name="tt" defaultValue={status ?? ""} className="field">
            <option value="">Mọi trạng thái</option>
            {["draft", "posted", "cancelled"].map((k) => (
              <option key={k} value={k}>
                {DOC_STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-outline">Lọc</button>
      </form>
      <DataList
        rows={rows}
        rowKey={(r) => r.id}
        empty="Chưa có phiếu điều chuyển."
        cols={[
          {
            label: "Phiếu",
            cell: (r) => (
              <TapLink href={`/admin/kho/dieu-chuyen/${r.id}`} className="font-mono">
                {r.code}
              </TapLink>
            ),
          },
          { label: "Từ → đến", cell: (r) => `${r.fromCode} → ${r.toCode}` },
          { label: "Lý do", cell: (r) => r.reason || (r.sourceType ? "Tự động" : "–") },
          { label: "Lúc lập", cell: (r) => formatDateTime(r.createdAt) },
          { label: "Trạng thái", cell: (r) => <Badge tone={DOC_STATUS_TONE[r.status]}>{DOC_STATUS_LABEL[r.status]}</Badge> },
        ]}
      />
    </>
  );
}
