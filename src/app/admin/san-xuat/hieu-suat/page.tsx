import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { formatDate, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { addDays } from "@/modules/inventory/rules";
import { getPerformance } from "@/modules/production/performance";
import { formatBp, formatDays, formatHours, formatRecovery, KIND_LABEL, NO_HISTORY, type ProductionKind } from "@/modules/production/rules";
import { Card, PageHeader, Stat } from "../../_components/ui";
import { DataList, TapLink } from "../../kho/_components/data-list";
import { Field } from "../_components/fields";
import { productOptions, supplierOptions } from "../_lib/data";
import { qty, vnToday } from "../_lib/view";

export const metadata: Metadata = { title: "Hiệu suất sản xuất" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

const bp = (v: number | null) => (v === null ? "—" : formatBp(v));

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ tu?: string; den?: string; sp?: string; loai?: string; ncc?: string }> }) {
  const [q, staff] = await Promise.all([searchParams, requireStaff()]);
  const today = vnToday();
  const to = q.den && DATE.test(q.den) ? q.den : today;
  const from = q.tu && DATE.test(q.tu) ? q.tu : addDays(to, -89);
  const productId = q.sp && UUID.test(q.sp) ? q.sp : null;
  const kind = q.loai === "in_house" || q.loai === "outsourced" ? (q.loai as ProductionKind) : null;
  const supplierId = q.ncc && UUID.test(q.ncc) ? q.ncc : null;
  const db = await getDb();
  const [perf, products, factories] = await Promise.all([getPerformance(db, { from, to, productId, kind, supplierId }), productOptions(db), supplierOptions(db, ["factory"])]);
  const s = perf.summary;
  const money = can(staff.role, "finance.view");

  const header = ["Lệnh", "Sản phẩm", "Loại", "Nhà máy", "Lô", "Xong", "Kế hoạch", "Đạt", "Lỗi", "Đạt/kế hoạch", "Tỷ lệ lỗi", "Hao hụt bán thành phẩm", ...(money ? ["Giá thành", "Giá vốn mỗi chai"] : [])];
  const csvRows = perf.orders.map((o) => [
    o.code,
    o.productCode,
    KIND_LABEL[o.kind],
    o.supplierName ?? "",
    o.lotNo ?? "",
    o.finishedAt ? formatDate(o.finishedAt) : "",
    o.plannedUnits,
    o.goodUnits,
    o.rejectedUnits,
    bp(o.metrics.goodVsPlanBp),
    bp(o.metrics.rejectBp),
    bp(o.metrics.bulkLossBp),
    ...(money ? [o.totalCost, o.metrics.unitCost] : []),
  ]);
  const csv = "﻿" + [header, ...csvRows].map((r) => r.map(csvCell).join(",")).join("\n");
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  return (
    <>
      <PageHeader title="Hiệu suất sản xuất" description="Tính trên các lệnh hoàn thành và mẻ chiết hoàn thành trong kỳ." />
      <Card className="mb-6">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <Field label="Từ ngày">
            <input type="date" name="tu" defaultValue={from} className="field min-h-11" />
          </Field>
          <Field label="Đến ngày">
            <input type="date" name="den" defaultValue={to} className="field min-h-11" />
          </Field>
          <Field label="Sản phẩm">
            <select name="sp" defaultValue={productId ?? ""} className="field min-h-11">
              <option value="">Tất cả</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Loại">
            <select name="loai" defaultValue={kind ?? ""} className="field min-h-11">
              <option value="">Tất cả</option>
              <option value="in_house">Tự làm</option>
              <option value="outsourced">Gia công</option>
            </select>
          </Field>
          <Field label="Nhà máy">
            <select name="ncc" defaultValue={supplierId ?? ""} className="field min-h-11">
              <option value="">Tất cả</option>
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex gap-2">
            <button className="btn btn-primary min-h-11">Xem</button>
            {perf.orders.length > 0 && (
              <a href={csvHref} download={`hieu-suat-${from}-${to}.csv`} className="btn btn-outline min-h-11">
                Tải CSV
              </a>
            )}
          </div>
        </form>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lệnh hoàn thành" value={String(s.count)} />
        <Stat label="Đạt / kế hoạch" value={bp(s.goodVsPlanBp)} />
        <Stat label="Tỷ lệ lỗi" value={bp(s.rejectBp)} />
        <Stat label="FQC đạt" value={bp(s.passRateBp)} />
        <Stat label="Hao hụt bán thành phẩm" value={bp(s.bulkLossBp)} hint="Chỉ lệnh tự làm" />
        <Stat label="Giờ mỗi mẻ (tự làm)" value={s.hoursPerBatch === null ? NO_HISTORY : formatHours(s.hoursPerBatch)} />
        <Stat label="Ngày mỗi lệnh gia công" value={s.daysPerOrder === null ? NO_HISTORY : formatDays(s.daysPerOrder)} />
        {money && <Stat label="Giá vốn mỗi chai" value={s.unitCost === null ? "—" : formatVnd(s.unitCost)} hint={s.costPerBatch === null ? undefined : `${formatVnd(s.costPerBatch)} mỗi mẻ`} />}
      </div>

      <div className="space-y-6">
        <Card title="Theo lệnh">
          <DataList
            rows={perf.orders}
            rowKey={(o) => o.id}
            empty="Không có lệnh hoàn thành trong kỳ."
            cols={[
              { label: "Lệnh", cell: (o) => <TapLink href={`/admin/san-xuat/lenh/${o.id}`} className="font-mono">{o.code}</TapLink> },
              { label: "Sản phẩm", cell: (o) => `${o.productCode} · ${KIND_LABEL[o.kind]}${o.supplierName ? ` · ${o.supplierName}` : ""}` },
              { label: "Đạt / kế hoạch", cell: (o) => `${o.goodUnits.toLocaleString("vi-VN")} / ${o.plannedUnits.toLocaleString("vi-VN")} (${bp(o.metrics.goodVsPlanBp)})`, className: "tabular-nums" },
              { label: "Lỗi", cell: (o) => bp(o.metrics.rejectBp), className: "tabular-nums" },
              { label: "Hao hụt", cell: (o) => bp(o.metrics.bulkLossBp), className: "tabular-nums" },
              ...(money ? [{ label: "Giá vốn/chai", cell: (o: (typeof perf.orders)[number]) => (o.metrics.unitCost === null ? "—" : formatVnd(o.metrics.unitCost)), className: "tabular-nums" }] : []),
            ]}
          />
        </Card>

        <Card title="Chênh lệch nguyên vật liệu (Pomil cấp)">
          <DataList
            rows={perf.materials}
            rowKey={(m) => m.id}
            empty="Không có dữ liệu."
            cols={[
              { label: "Hàng", cell: (m) => `${m.code} · ${m.name}` },
              { label: "Kế hoạch", cell: (m) => qty(m.planned, m.baseUom, m.displayUom), className: "tabular-nums" },
              { label: "Xuất ròng", cell: (m) => qty(m.issued, m.baseUom, m.displayUom), className: "tabular-nums" },
              { label: "Chênh lệch", cell: (m) => <span className={m.varianceBp !== null && m.varianceBp > 0 ? "text-danger" : ""}>{bp(m.varianceBp)}</span>, className: "tabular-nums" },
            ]}
          />
        </Card>

        <Card title={`Chiết xuất · thu hồi trung bình ${bp(perf.avgRecoveryBp)}`}>
          <DataList
            rows={perf.equipment}
            rowKey={(e) => e.equipment}
            empty="Không có mẻ chiết hoàn thành trong kỳ."
            cols={[
              { label: "Thiết bị", cell: (e) => e.equipment },
              { label: "Số mẻ", cell: (e) => String(e.runs), className: "tabular-nums" },
              { label: "Giờ chạy", cell: (e) => (Math.round(e.hours * 10) / 10).toLocaleString("vi-VN"), className: "tabular-nums" },
              { label: "Thu hồi TB", cell: (e) => bp(e.avgRecoveryBp), className: "tabular-nums" },
            ]}
          />
          {perf.runs.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              {perf.runs.map((r) => (
                <li key={r.code}>
                  <span className="font-mono">{r.code}</span> · {r.equipment || "—"} · thu hồi {formatRecovery(r.recovery)}
                  {money ? ` · ${formatVnd(r.totalCost)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
