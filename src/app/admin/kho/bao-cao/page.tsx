import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { reportExpiry, reportSlowMoving, reportValuation, type LotReportRow } from "@/modules/inventory/admin";
import { vnToday } from "@/modules/numbering/rules";
import { getErpSettings } from "@/modules/settings/service";
import { Card, PageHeader, Stat } from "../../_components/ui";
import { DataList, TapLink, type Col } from "../_components/data-list";
import { q, viDate } from "../_lib/fmt";
import { ITEM_KIND_LABEL } from "../_lib/labels";

export const metadata: Metadata = { title: "Báo cáo kho" };

function lotCols(showValue: boolean, daysLabel: string, days: (r: LotReportRow) => string): Col<LotReportRow>[] {
  return [
    {
      label: "Lô",
      cell: (r) => (
        <TapLink href={`/admin/kho/lo/${r.stockLotId}`} className="font-mono">
          {r.lotCode}
        </TapLink>
      ),
    },
    { label: "Hàng", cell: (r) => `${r.itemCode} · ${r.itemName}` },
    { label: "Số dư", cell: (r) => q(r.qty, r), className: "tabular-nums" },
    { label: "HSD", cell: (r) => viDate(r.expiresOn) || "–" },
    { label: daysLabel, cell: days, className: "tabular-nums" },
    ...(showValue ? [{ label: "Giá trị", cell: (r: LotReportRow) => formatVnd(r.value), className: "tabular-nums" }] : []),
  ];
}

function CsvLink({ kind }: { kind: string }) {
  return (
    <a href={`/admin/kho/bao-cao/csv?bc=${kind}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
      Tải CSV
    </a>
  );
}

export default async function InventoryReportsPage() {
  const [staff, db, erp] = await Promise.all([requireStaff(), getDb(), getErpSettings()]);
  const today = vnToday();
  const showValue = can(staff.role, "finance.view");
  const [expiry, slow, valuation] = await Promise.all([
    reportExpiry(db, today, erp.expiryWarnDays),
    reportSlowMoving(db, today, erp.slowMovingDays),
    showValue ? reportValuation(db) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title="Báo cáo kho" description={`Sắp hết hạn trong ${erp.expiryWarnDays} ngày, tồn lâu từ ${erp.slowMovingDays} ngày (đổi ở Cài đặt > Vận hành).`} />

      {valuation && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="eyebrow text-[0.68rem]">Giá trị tồn</h2>
            <CsvLink kind="gia-tri" />
          </div>
          <div className="stagger mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Tổng giá trị tồn" value={formatVnd(valuation.total)} />
            {valuation.byWarehouse.slice(0, 3).map((w) => (
              <Stat key={w.code} label={`Kho ${w.code}`} value={formatVnd(w.value)} hint={w.name} />
            ))}
          </div>
          <Card title="Theo nhóm hàng" className="mb-8">
            {valuation.byGroup.length ? (
              <ul className="divide-y divide-line text-sm">
                {valuation.byGroup.map((g) => (
                  <li key={`${g.kind}|${g.group}`} className="flex justify-between gap-3 py-2">
                    <span>
                      {ITEM_KIND_LABEL[g.kind]}
                      {g.group ? ` · ${g.group}` : ""}
                    </span>
                    <span className="tabular-nums">{formatVnd(g.value)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">Chưa có tồn.</p>
            )}
          </Card>
        </>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="eyebrow text-[0.68rem]">Đã hết hạn ({expiry.expired.length})</h2>
        <CsvLink kind="het-han" />
      </div>
      <DataList rows={expiry.expired} rowKey={(r) => r.stockLotId} empty="Không có lô hết hạn còn tồn." cols={lotCols(showValue, "Quá hạn", (r) => `${-r.days} ngày`)} />

      <div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="eyebrow text-[0.68rem]">Sắp hết hạn ({expiry.expiring.length})</h2>
        <CsvLink kind="sap-het-han" />
      </div>
      <DataList rows={expiry.expiring} rowKey={(r) => r.stockLotId} empty="Không có lô sắp hết hạn." cols={lotCols(showValue, "Còn", (r) => `${r.days} ngày`)} />

      <div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="eyebrow text-[0.68rem]">Tồn lâu ({slow.length})</h2>
        <CsvLink kind="ton-lau" />
      </div>
      <DataList rows={slow} rowKey={(r) => r.stockLotId} empty="Không có lô tồn lâu." cols={lotCols(showValue, "Không xuất", (r) => `${r.days} ngày`)} />
    </>
  );
}
