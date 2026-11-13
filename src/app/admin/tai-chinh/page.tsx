import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatDate, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { computeFinanceAlerts } from "@/modules/finance/alerts";
import { activeBudgetsOn, getBudgetReport } from "@/modules/finance/budgets";
import { listAccountsWithBalance, listPendingRequests } from "@/modules/finance/cash";
import { listPayables, listReceivables } from "@/modules/finance/debts";
import { cashForecast, inOutTotals } from "@/modules/finance/reports";
import { ACCOUNT_KIND_LABEL, BUDGET_GROUP_LABEL, periodBounds, shortDate } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";
import { getErpSettings } from "@/modules/settings/service";
import { ActionForm } from "../_components/action-form";
import { Badge, Card, Empty, PageHeader, Stat, Table } from "../_components/ui";
import { approveCashAction, rejectCashAction } from "./actions";
import { LegalNotice, Money, requireFinanceView, TONE_OF } from "./_shared";

export const metadata: Metadata = { title: "Tổng quan tài chính" };

export default async function FinanceHome() {
  const me = await requireFinanceView();
  const db = await getDb();
  const today = vnToday();
  const cfg = await getErpSettings();
  const month = periodBounds("month", today);
  const [accounts, io, recs, pays, pending, forecast, budgets, alerts] = await Promise.all([
    listAccountsWithBalance(db, { activeOnly: true }),
    inOutTotals(db, month),
    listReceivables(db, { today, dueSoonDays: cfg.debtDueSoonDays, status: "open_all" }),
    listPayables(db, { today, dueSoonDays: cfg.debtDueSoonDays, status: "open_all" }),
    listPendingRequests(db),
    cashForecast(db, { today, weeks: cfg.forecastWeeks, minCash: cfg.minCashAlert }),
    activeBudgetsOn(db, today),
    computeFinanceAlerts(db, me.role, today),
  ]);
  const monthBudget = budgets.find((b) => b.period === "month");
  const budgetReport = monthBudget ? await getBudgetReport(db, monthBudget.id, cfg.budgetWarnBp) : null;
  const totalCash = accounts.reduce((a, x) => a + x.balance, 0);
  const sum = (rows: { remaining: number }[]) => rows.reduce((a, r) => a + r.remaining, 0);
  const canApprove = can(me.role, "finance.approve");

  return (
    <>
      <PageHeader
        title="Tổng quan tài chính"
        description="Tiền ở đâu, ai nợ mình, mình nợ ai, tuần nào có thể thiếu tiền."
        actions={
          can(me.role, "finance.write") ? (
            <>
              <Link href="/admin/tai-chinh/thu-chi/moi?loai=thu" className="btn btn-outline min-h-11">
                Phiếu thu
              </Link>
              <Link href="/admin/tai-chinh/thu-chi/moi?loai=chi" className="btn btn-outline min-h-11">
                Phiếu chi
              </Link>
              <Link href="/admin/tai-chinh/thu-chi/moi?loai=chuyen" className="btn btn-primary min-h-11">
                Chuyển quỹ
              </Link>
            </>
          ) : null
        }
      />
      <LegalNotice />

      {alerts.length > 0 && (
        <ul className="mb-6 space-y-2" aria-label="Cảnh báo tài chính">
          {alerts.map((a, i) => (
            <li key={i}>
              <Link href={a.href} className={`flex min-h-11 items-center border px-3 text-sm ${a.level === "danger" ? "border-danger/40 bg-danger/5 text-danger" : a.level === "warn" ? "border-[#e3cf9f] bg-[#f1e2c4] text-[#6b4e12]" : "border-line bg-paper"}`}>
                {a.text}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Tiền hiện có" value={formatVnd(totalCash)} hint={`${accounts.length} tài khoản`} href="/admin/tai-chinh/dong-tien" />
        <Stat label="Thu / chi tháng này" value={formatVnd(io.in - io.out)} hint={`Thu ${formatVnd(io.in)} · chi ${formatVnd(io.out)}`} href="/admin/tai-chinh/thu-chi" />
        <Stat label="Phải thu còn lại" value={formatVnd(sum(recs))} hint={`Quá hạn ${formatVnd(sum(recs.filter((r) => r.overdueDays > 0)))}`} href="/admin/tai-chinh/cong-no?the=phai-thu" />
        <Stat label="Phải trả còn lại" value={formatVnd(sum(pays))} hint={`Sắp đến hạn ${formatVnd(sum(pays.filter((p) => p.dueSoon)))} · quá hạn ${formatVnd(sum(pays.filter((p) => p.overdueDays > 0)))}`} href="/admin/tai-chinh/cong-no?the=phai-tra" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Số dư từng tài khoản">
          <ul className="divide-y divide-line text-sm">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {a.name} <span className="text-xs text-ink-soft">{ACCOUNT_KIND_LABEL[a.kind]}</span>
                </span>
                <Money value={a.balance} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title={`Dự báo ${cfg.forecastWeeks} tuần`} actions={<Link href="/admin/tai-chinh/dong-tien" className="text-xs underline">Chi tiết</Link>}>
          <ul className="divide-y divide-line text-sm">
            {forecast.weeks.map((w) => (
              <li key={w.week} className="flex items-center justify-between gap-3 py-2">
                <span>
                  Tuần {w.week} <span className="text-xs text-ink-soft">từ {shortDate(w.from)}</span>
                </span>
                <span className="text-xs text-ink-soft">
                  +{formatVnd(w.inflow)} / −{formatVnd(w.outflow)}
                </span>
                <Money value={w.closing} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title={`Đề nghị chi chờ duyệt · ${pending.length}`}>
          {pending.length === 0 ? (
            <p className="text-sm text-ink-soft">Không có đề nghị nào.</p>
          ) : (
            <ul className="space-y-4 text-sm">
              {pending.map((p) => (
                <li key={p.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/admin/tai-chinh/thu-chi/${p.id}`} className="font-mono underline-offset-4 hover:underline">
                      {p.code}
                    </Link>
                    <Money value={p.amount} />
                  </div>
                  <p className="text-ink-soft">
                    {p.categoryName} · {formatDate(p.occurredOn)} · {p.requesterName || "Cộng tác viên"}
                    {p.note ? ` · ${p.note}` : ""}
                  </p>
                  {canApprove && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      <ActionForm action={approveCashAction} submitLabel="Duyệt" inline submitClassName="btn btn-primary min-h-11">
                        <input type="hidden" name="id" value={p.id} />
                      </ActionForm>
                      <ActionForm action={rejectCashAction} submitLabel="Từ chối" inline className="flex flex-wrap items-center gap-2" submitClassName="btn btn-outline min-h-11">
                        <input type="hidden" name="id" value={p.id} />
                        <input name="reason" required placeholder="Lý do từ chối" className="field min-h-11 w-48 text-sm" />
                      </ActionForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Ngân sách tháng" actions={<Link href="/admin/tai-chinh/ngan-sach" className="text-xs underline">Ngân sách</Link>}>
          {!budgetReport ? (
            <Empty>Chưa có ngân sách tháng đang dùng.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Dòng</th>
                  <th>Ngân sách</th>
                  <th>Thực tế</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {budgetReport.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.categoryName ?? BUDGET_GROUP_LABEL[l.group]}</td>
                    <td><Money value={l.amount} /></td>
                    <td><Money value={l.actual} /></td>
                    <td>
                      <Badge tone={TONE_OF[l.tone]}>{l.ratioBp === null ? (l.actual > 0 ? "Vượt" : "—") : `${Math.round(l.ratioBp / 100)}%`}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
