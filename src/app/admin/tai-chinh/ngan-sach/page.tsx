import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { BUDGET_STATUS_LABEL, getBudgetReport, listBudgets } from "@/modules/finance/budgets";
import { periodLabel } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";
import { getErpSettings } from "@/modules/settings/service";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, Empty, PageHeader, Table, type BadgeTone } from "../../_components/ui";
import { createBudgetAction } from "../actions";
import { LegalNotice, Money, requireFinanceView } from "../_shared";

export const metadata: Metadata = { title: "Ngân sách" };

const STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", active: "green", closed: "dark" };

export default async function BudgetsPage() {
  const me = await requireFinanceView();
  const db = await getDb();
  const cfg = await getErpSettings();
  const list = await listBudgets(db);
  const reports = await Promise.all(list.map((b) => getBudgetReport(db, b.id, cfg.budgetWarnBp)));

  return (
    <>
      <PageHeader title="Ngân sách" description={`Đặt mức chi theo tháng, quý, năm. Dòng chuyển vàng khi đạt ${Math.round(cfg.budgetWarnBp / 100)}%, đỏ khi vượt.`} />
      <LegalNotice />

      {list.length === 0 ? (
        <Empty>Chưa có ngân sách nào.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Kỳ</th>
              <th>Tên</th>
              <th className="text-right">Ngân sách</th>
              <th className="text-right">Thực tế</th>
              <th>Dòng vượt / sắp vượt</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b, i) => {
              const r = reports[i];
              const red = r?.lines.filter((l) => l.tone === "red").length ?? 0;
              const amber = r?.lines.filter((l) => l.tone === "amber").length ?? 0;
              return (
                <tr key={b.id}>
                  <td>
                    <Link href={`/admin/tai-chinh/ngan-sach/${b.id}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                      {periodLabel(b.period, b.periodStart)}
                    </Link>
                  </td>
                  <td>{b.name}</td>
                  <td className="text-right">
                    <Money value={r?.totalBudget ?? 0} />
                  </td>
                  <td className="text-right">
                    <Money value={r?.totalActual ?? 0} />
                  </td>
                  <td>
                    {red > 0 && <Badge tone="red">{red} vượt</Badge>} {amber > 0 && <Badge tone="amber">{amber} sắp vượt</Badge>}
                    {red === 0 && amber === 0 && <span className="text-xs text-ink-soft">—</span>}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[b.status]}>{BUDGET_STATUS_LABEL[b.status]}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {can(me.role, "finance.write") && (
        <Card title="Tạo ngân sách" className="mt-6 max-w-2xl">
          <ActionForm action={createBudgetAction} submitLabel="Tạo" submitClassName="btn btn-primary min-h-11">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="field-label">Kỳ</span>
                <select name="period" defaultValue="month" className="field min-h-11 w-full">
                  <option value="month">Tháng</option>
                  <option value="quarter">Quý</option>
                  <option value="year">Năm</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="field-label">Một ngày trong kỳ</span>
                <input type="date" name="start" required defaultValue={vnToday()} className="field min-h-11 w-full" />
              </label>
              <label className="block text-sm">
                <span className="field-label">Tên (tùy chọn)</span>
                <input name="name" className="field min-h-11 w-full" />
              </label>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
