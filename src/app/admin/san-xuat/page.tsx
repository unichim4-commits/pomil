import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getAlerts } from "@/modules/production/alerts";
import { listRuns } from "@/modules/production/extraction";
import { listOrders } from "@/modules/production/orders";
import { KIND_LABEL, ORDER_STATUS_LABEL } from "@/modules/production/rules";
import { DataList, TapLink } from "../kho/_components/data-list";
import { Badge, Card, PageHeader, Stat } from "../_components/ui";
import { ORDER_TONE } from "./_lib/view";

export const metadata: Metadata = { title: "Tổng quan sản xuất" };

export default async function ProductionHome() {
  const staff = await requireStaff();
  const db = await getDb();
  const [active, alerts, runs] = await Promise.all([listOrders(db, { status: "active" }), getAlerts(staff.role), listRuns(db, "in_progress")]);
  const count = (s: string) => active.filter((o) => o.status === s).length;
  const canWrite = can(staff.role, "production.write");

  return (
    <>
      <PageHeader
        title="Tổng quan sản xuất"
        description="Lệnh đang chạy, việc chờ kiểm và cảnh báo của phân hệ Sản xuất."
        actions={
          canWrite ? (
            <>
              <Link href="/admin/san-xuat/lenh/moi" className="btn btn-primary min-h-11">
                Tạo lệnh
              </Link>
              <Link href="/admin/san-xuat/ke-hoach/moi" className="btn btn-outline min-h-11">
                Lập kế hoạch
              </Link>
            </>
          ) : undefined
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Chờ duyệt" value={String(count("planned"))} href="/admin/san-xuat/lenh?trang-thai=planned" />
        <Stat label="Đã duyệt" value={String(count("approved"))} href="/admin/san-xuat/lenh?trang-thai=approved" />
        <Stat label="Đang làm" value={String(count("in_progress"))} href="/admin/san-xuat/lenh?trang-thai=in_progress" />
        <Stat label="Chờ FQC" value={String(count("qc"))} href="/admin/san-xuat/lenh?trang-thai=qc" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div>
          <h2 className="eyebrow mb-3 text-[0.68rem]">Lệnh đang mở</h2>
          <DataList
            rows={active}
            rowKey={(o) => o.id}
            empty="Không có lệnh đang mở."
            cols={[
              { label: "Lệnh", cell: (o) => <TapLink href={`/admin/san-xuat/lenh/${o.id}`} className="font-mono">{o.code}</TapLink> },
              { label: "Sản phẩm", cell: (o) => o.productName },
              { label: "Loại", cell: (o) => KIND_LABEL[o.kind] + (o.supplierName ? ` · ${o.supplierName}` : "") },
              { label: "Số chai", cell: (o) => o.plannedUnits.toLocaleString("vi-VN"), className: "tabular-nums" },
              { label: "Bắt đầu", cell: (o) => (o.plannedStart ? formatDate(o.plannedStart) : "—") },
              { label: "Trạng thái", cell: (o) => <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge> },
            ]}
          />
        </div>
        <div className="space-y-6">
          <Card title="Cảnh báo">
            {alerts.length === 0 ? (
              <p className="text-sm text-ink-soft">Không có cảnh báo.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {alerts.map((a) => (
                  <li key={a.href + a.text}>
                    <TapLink href={a.href} className={a.level === "danger" ? "text-danger" : ""}>
                      {a.text}
                    </TapLink>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Mẻ chiết đang chạy">
            {runs.length === 0 ? (
              <p className="text-sm text-ink-soft">Không có mẻ đang chạy.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {runs.map((r) => (
                  <li key={r.id}>
                    <TapLink href={`/admin/san-xuat/chiet-xuat/${r.id}`} className="font-mono">
                      {r.code}
                    </TapLink>
                    <span className="ml-2 text-ink-soft">{r.equipment || r.outputCode}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
