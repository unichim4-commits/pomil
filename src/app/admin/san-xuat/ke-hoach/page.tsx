import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listPlans } from "@/modules/production/plans";
import { PLAN_STATUS_LABEL } from "@/modules/production/rules";
import { DataList, TapLink } from "../../kho/_components/data-list";
import { Badge, PageHeader } from "../../_components/ui";
import { PLAN_TONE } from "../_lib/view";

export const metadata: Metadata = { title: "Kế hoạch sản xuất" };

const PERIOD = { day: "Ngày", week: "Tuần", month: "Tháng" } as const;

export default async function PlansPage() {
  const staff = await requireStaff();
  const plans = await listPlans(await getDb());
  return (
    <>
      <PageHeader
        title="Kế hoạch sản xuất"
        description="Kế hoạch tính nguyên liệu cần, so tồn khả dụng, và theo dõi tiến độ theo lệnh."
        actions={
          can(staff.role, "production.write") ? (
            <Link href="/admin/san-xuat/ke-hoach/moi" className="btn btn-primary min-h-11">
              Lập kế hoạch
            </Link>
          ) : undefined
        }
      />
      <DataList
        rows={plans}
        rowKey={(p) => p.id}
        empty="Chưa có kế hoạch."
        cols={[
          { label: "Kế hoạch", cell: (p) => <TapLink href={`/admin/san-xuat/ke-hoach/${p.id}`} className="font-mono">{p.code}</TapLink> },
          { label: "Kỳ", cell: (p) => `${PERIOD[p.period]}: ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` },
          { label: "Ghi chú", cell: (p) => p.note ?? "—", hideOnCard: true },
          { label: "Trạng thái", cell: (p) => <Badge tone={PLAN_TONE[p.status]}>{PLAN_STATUS_LABEL[p.status]}</Badge> },
        ]}
      />
    </>
  );
}
