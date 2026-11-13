import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { formatVnd } from "@/lib/format";
import { cashFlowActual, cashForecast, workingCapitalReport } from "@/modules/finance/reports";
import { shortageText, shortDate } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";
import { getErpSettings } from "@/modules/settings/service";
import { Card, PageHeader, Stat, Table } from "../../_components/ui";
import { CsvLink, LegalNotice, Money, PeriodPicker, readPeriod, requireFinanceView } from "../_shared";

export const metadata: Metadata = { title: "Dòng tiền" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireFinanceView();
  const sp = await searchParams;
  const p = readPeriod({ ky: one(sp.ky), ngay: one(sp.ngay) });
  const db = await getDb();
  const cfg = await getErpSettings();
  const [flows, forecast, wc] = await Promise.all([
    cashFlowActual(db, { from: p.from, to: p.to }),
    cashForecast(db, { today: vnToday(), weeks: cfg.forecastWeeks, minCash: cfg.minCashAlert }),
    workingCapitalReport(db),
  ]);
  const total = (f: (a: (typeof flows)[number]) => number) => flows.reduce((s, a) => s + f(a), 0);
  const sumOf = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const csv = (bang: string) => `/admin/tai-chinh/dong-tien/csv?bang=${bang}&ky=${p.period}&ngay=${p.start}`;

  return (
    <>
      <PageHeader title={`Dòng tiền · ${p.label}`} description="Tiền thực vào, ra theo tài khoản; dự báo các tuần tới từ công nợ và đề nghị chờ duyệt." actions={<CsvLink href={csv("thuc-te")} />} />
      <LegalNotice />
      <PeriodPicker basePath="/admin/tai-chinh/dong-tien" period={p.period} start={p.start} prevStart={p.prevStart} nextStart={p.to} />

      <Card title="Thực tế theo tài khoản" className="mb-6">
        <Table>
          <thead>
            <tr>
              <th>Tài khoản</th>
              <th className="text-right">Đầu kỳ</th>
              <th className="text-right">Thu</th>
              <th className="text-right">Chi</th>
              <th className="text-right">Chuyển vào</th>
              <th className="text-right">Chuyển ra</th>
              <th className="text-right">Cuối kỳ</th>
            </tr>
          </thead>
          <tbody>
            {flows.map((a) => (
              <tr key={a.accountId}>
                <td>
                  {a.name}
                  {(a.inflows.length > 0 || a.outflows.length > 0) && (
                    <details className="mt-1 text-xs text-ink-soft">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center">Theo hạng mục</summary>
                      <ul className="space-y-0.5">
                        {a.inflows.map((x) => (
                          <li key={`in-${x.category}`}>+ {x.category || "Khác"}: {formatVnd(x.amount)}</li>
                        ))}
                        {a.outflows.map((x) => (
                          <li key={`out-${x.category}`}>− {x.category || "Khác"}: {formatVnd(x.amount)}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="text-right"><Money value={a.opening} /></td>
                <td className="text-right"><Money value={sumOf(a.inflows)} /></td>
                <td className="text-right"><Money value={-sumOf(a.outflows)} /></td>
                <td className="text-right"><Money value={a.transferIn} /></td>
                <td className="text-right"><Money value={-a.transferOut} /></td>
                <td className="text-right"><Money value={a.closing} /></td>
              </tr>
            ))}
            <tr className="bg-bone">
              <td className="font-medium">Tổng</td>
              <td className="text-right"><Money value={total((a) => a.opening)} /></td>
              <td className="text-right"><Money value={total((a) => sumOf(a.inflows))} /></td>
              <td className="text-right"><Money value={-total((a) => sumOf(a.outflows))} /></td>
              <td className="text-right"><Money value={total((a) => a.transferIn)} /></td>
              <td className="text-right"><Money value={-total((a) => a.transferOut)} /></td>
              <td className="text-right"><Money value={total((a) => a.closing)} className="font-medium" /></td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <Card title={`Dự báo ${cfg.forecastWeeks} tuần`} className="mb-6" actions={<CsvLink href={csv("du-bao")} />}>
        {forecast.shortages.length > 0 && (
          <ul className="mb-4 space-y-1 text-sm text-danger">
            {forecast.shortages.map((s) => (
              <li key={s.week}>{shortageText(s)} (mức tối thiểu {formatVnd(cfg.minCashAlert)})</li>
            ))}
          </ul>
        )}
        <Table>
          <thead>
            <tr>
              <th>Tuần</th>
              <th className="text-right">Đầu tuần</th>
              <th className="text-right">Dự thu</th>
              <th className="text-right">Dự chi</th>
              <th className="text-right">Cuối tuần</th>
            </tr>
          </thead>
          <tbody>
            {forecast.weeks.map((w) => (
              <tr key={w.week}>
                <td>
                  Tuần {w.week} <span className="text-xs text-ink-soft">{shortDate(w.from)} – {shortDate(w.to)}</span>
                </td>
                <td className="text-right"><Money value={w.opening} /></td>
                <td className="text-right"><Money value={w.inflow} /></td>
                <td className="text-right"><Money value={-w.outflow} /></td>
                <td className="text-right"><Money value={w.closing} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-ink-soft">Phải thu quá hạn và đề nghị chi chờ duyệt dồn vào tuần 1.</p>
      </Card>

      <h2 className="eyebrow mb-3 text-[0.68rem]">Vốn lưu động</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Giá trị tồn kho" value={formatVnd(wc.stockValue)} />
        <Stat label="Phải thu" value={formatVnd(wc.receivables)} />
        <Stat label="Phải trả" value={formatVnd(wc.payables)} />
        <Stat label="Vốn lưu động" value={formatVnd(wc.workingCapital)} hint="Tồn + phải thu − phải trả" />
        <Stat label="Tiền hiện có" value={formatVnd(wc.cash)} />
      </div>
    </>
  );
}
