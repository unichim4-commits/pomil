import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listOrders } from "@/modules/production/orders";
import { KIND_LABEL, ORDER_STATUS_LABEL, type ProductionKind, type ProductionStatus } from "@/modules/production/rules";
import { DataList, TapLink } from "../../kho/_components/data-list";
import { Badge, FilterTabs, PageHeader } from "../../_components/ui";
import { ORDER_TONE } from "../_lib/view";

export const metadata: Metadata = { title: "Lệnh sản xuất" };

const TABS: { key: string; label: string }[] = [
  { key: "active", label: "Đang mở" },
  { key: "draft", label: "Nháp" },
  { key: "planned", label: "Chờ duyệt" },
  { key: "approved", label: "Đã duyệt" },
  { key: "in_progress", label: "Đang làm" },
  { key: "qc", label: "Chờ FQC" },
  { key: "completed", label: "Hoàn thành" },
  { key: "cancelled", label: "Đã hủy" },
  { key: "all", label: "Tất cả" },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ "trang-thai"?: string; loai?: string }> }) {
  const [sp, staff] = await Promise.all([searchParams, requireStaff()]);
  const active = TABS.some((t) => t.key === sp["trang-thai"]) ? sp["trang-thai"]! : "active";
  const kind = sp.loai === "in_house" || sp.loai === "outsourced" ? (sp.loai as ProductionKind) : null;
  const rows = await listOrders(await getDb(), { status: active === "all" ? null : (active as ProductionStatus | "active"), kind });
  const href = (k: string) => `/admin/san-xuat/lenh?trang-thai=${k}${kind ? `&loai=${kind}` : ""}`;

  return (
    <>
      <PageHeader
        title="Lệnh sản xuất"
        description="Lệnh tự làm hoặc gia công: định mức, xuất vật tư, công đoạn, sản lượng và giá thành."
        actions={
          can(staff.role, "production.write") ? (
            <Link href="/admin/san-xuat/lenh/moi" className="btn btn-primary min-h-11">
              Tạo lệnh
            </Link>
          ) : undefined
        }
      />
      <FilterTabs items={TABS.map((t) => ({ key: t.key, label: t.label, href: href(t.key) }))} active={active} />
      <div className="mb-4 mt-3 flex flex-wrap gap-2 text-sm">
        {[
          { k: null, label: "Mọi loại" },
          { k: "in_house", label: "Tự làm" },
          { k: "outsourced", label: "Gia công" },
        ].map((o) => (
          <TapLink key={o.label} href={`/admin/san-xuat/lenh?trang-thai=${active}${o.k ? `&loai=${o.k}` : ""}`} className={`px-2 ${kind === o.k ? "underline" : "text-ink-soft"}`}>
            {o.label}
          </TapLink>
        ))}
      </div>
      <DataList
        rows={rows}
        rowKey={(o) => o.id}
        empty="Không có lệnh nào."
        cols={[
          { label: "Lệnh", cell: (o) => <TapLink href={`/admin/san-xuat/lenh/${o.id}`} className="font-mono">{o.code}</TapLink> },
          { label: "Sản phẩm", cell: (o) => o.productName },
          { label: "Loại", cell: (o) => KIND_LABEL[o.kind] + (o.supplierName ? ` · ${o.supplierName}` : "") },
          { label: "Số chai", cell: (o) => `${o.goodUnits !== null ? `${o.goodUnits.toLocaleString("vi-VN")} / ` : ""}${o.plannedUnits.toLocaleString("vi-VN")}`, className: "tabular-nums" },
          { label: "Bắt đầu", cell: (o) => (o.plannedStart ? formatDate(o.plannedStart) : "—") },
          { label: "Lô", cell: (o) => (o.lotNo ? <span className="font-mono">{o.lotNo}</span> : "—") },
          { label: "Trạng thái", cell: (o) => <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge> },
        ]}
      />
    </>
  );
}
