import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listRuns } from "@/modules/production/extraction";
import { EXTRACTION_METHOD_LABEL, EXTRACTION_STATUS_LABEL, KIND_LABEL } from "@/modules/production/rules";
import { DataList, TapLink } from "../../kho/_components/data-list";
import { Badge, PageHeader } from "../../_components/ui";
import { qty, RUN_TONE } from "../_lib/view";

export const metadata: Metadata = { title: "Chiết xuất" };

export default async function RunsPage() {
  const staff = await requireStaff();
  const runs = await listRuns(await getDb());
  return (
    <>
      <PageHeader
        title="Chiết xuất"
        description="Mỗi mẻ chiết: xuất vỏ bưởi, ghi thông số, nhập tinh dầu vào kho chiết xuất ở trạng thái chờ IPQC."
        actions={
          can(staff.role, "production.write") ? (
            <Link href="/admin/san-xuat/chiet-xuat/moi" className="btn btn-primary min-h-11">
              Tạo mẻ chiết
            </Link>
          ) : undefined
        }
      />
      <DataList
        rows={runs}
        rowKey={(r) => r.id}
        empty="Chưa có mẻ chiết."
        cols={[
          { label: "Mẻ", cell: (r) => <TapLink href={`/admin/san-xuat/chiet-xuat/${r.id}`} className="font-mono">{r.code}</TapLink> },
          { label: "Phương pháp", cell: (r) => `${EXTRACTION_METHOD_LABEL[r.method]} · ${KIND_LABEL[r.kind]}` },
          { label: "Thiết bị", cell: (r) => r.equipment || "—" },
          { label: "Giống bưởi", cell: (r) => r.pomeloVariety || "—", hideOnCard: true },
          { label: "Đầu ra", cell: (r) => `${r.outputCode}${r.outputQty ? ` · ${qty(r.outputQty, r.outputUom, r.outputDisplayUom)}` : ""}` },
          { label: "Tạo", cell: (r) => formatDate(r.createdAt), hideOnCard: true },
          { label: "Trạng thái", cell: (r) => <Badge tone={RUN_TONE[r.status]}>{EXTRACTION_STATUS_LABEL[r.status]}</Badge> },
        ]}
      />
    </>
  );
}
