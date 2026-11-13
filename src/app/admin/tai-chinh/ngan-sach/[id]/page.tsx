import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { BUDGET_STATUS_LABEL, getBudgetReport } from "@/modules/finance/budgets";
import { listCategories } from "@/modules/finance/cash";
import { addDaysIso, BUDGET_GROUP_LABEL, periodLabel, type BudgetGroup } from "@/modules/finance/rules";
import { getErpSettings } from "@/modules/settings/service";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, Empty, PageHeader, Table, type BadgeTone } from "../../../_components/ui";
import { advanceBudgetAction, deleteBudgetLineAction, setBudgetLineAction } from "../../actions";
import { LegalNotice, Money, TONE_OF, requireFinanceView } from "../../_shared";

export const metadata: Metadata = { title: "Ngân sách" };

const STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", active: "green", closed: "dark" };

export default async function BudgetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireFinanceView();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const cfg = await getErpSettings();
  const report = await getBudgetReport(db, id, cfg.budgetWarnBp);
  if (!report) notFound();
  const { budget: b } = report;
  const canWrite = can(me.role, "finance.write");
  const editable = canWrite && b.status !== "closed";
  const categories = editable ? await listCategories(db, { activeOnly: true, direction: "out" }) : [];

  return (
    <>
      <PageHeader
        title={`Ngân sách ${periodLabel(b.period, b.periodStart)}`}
        description={`${b.name} · ${formatDate(report.from)} – ${formatDate(addDaysIso(report.to, -1))}`}
        actions={
          <>
            <Link href="/admin/tai-chinh/ngan-sach" className="btn btn-outline min-h-11">
              ← Ngân sách
            </Link>
            {canWrite && b.status !== "closed" && (
              <ActionForm action={advanceBudgetAction} submitLabel={b.status === "draft" ? "Kích hoạt" : "Đóng ngân sách"} inline submitClassName="btn btn-primary min-h-11" confirm={b.status === "active" ? "Đóng ngân sách? Sau khi đóng không sửa được dòng." : undefined}>
                <input type="hidden" name="budgetId" value={b.id} />
                <input type="hidden" name="from" value={b.status} />
              </ActionForm>
            )}
          </>
        }
      />
      <LegalNotice />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={STATUS_TONE[b.status]}>{BUDGET_STATUS_LABEL[b.status]}</Badge>
        <span>
          Tổng ngân sách <Money value={report.totalBudget} /> · thực tế <Money value={report.totalActual} />
        </span>
      </div>

      {report.lines.length === 0 ? (
        <Empty>Chưa có dòng nào. Thêm dòng theo nhóm hoặc theo hạng mục bên dưới.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Dòng</th>
              <th className="text-right">Ngân sách</th>
              <th className="text-right">Thực tế</th>
              <th>%</th>
              <th className="text-right">Vượt</th>
              {editable && <th></th>}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.categoryName ? (
                    <>
                      {l.categoryName} <span className="text-xs text-ink-soft">hạng mục riêng</span>
                    </>
                  ) : (
                    <>
                      {BUDGET_GROUP_LABEL[l.group]} <span className="text-xs text-ink-soft">cả nhóm</span>
                    </>
                  )}
                </td>
                <td className="text-right">
                  <Money value={l.amount} />
                </td>
                <td className="text-right">
                  <Money value={l.actual} />
                </td>
                <td>
                  <Badge tone={TONE_OF[l.tone]}>{l.ratioBp === null ? (l.actual > 0 ? "Vượt" : "—") : `${Math.round(l.ratioBp / 100)}%`}</Badge>
                </td>
                <td className="text-right">{l.over > 0 ? <Money value={l.over} className="text-danger" /> : "—"}</td>
                {editable && (
                  <td>
                    <ActionForm action={deleteBudgetLineAction} submitLabel="Xóa" inline confirm="Xóa dòng ngân sách này?" submitClassName="btn btn-outline min-h-11 text-xs">
                      <input type="hidden" name="budgetId" value={b.id} />
                      <input type="hidden" name="lineId" value={l.id} />
                    </ActionForm>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-2 text-xs text-ink-soft">Dòng theo hạng mục riêng không cộng vào dòng của cả nhóm.</p>

      {editable && (
        <Card title="Thêm hoặc sửa dòng" className="mt-6 max-w-2xl">
          <ActionForm action={setBudgetLineAction} submitLabel="Lưu dòng" submitClassName="btn btn-primary min-h-11" resetOnSuccess>
            <input type="hidden" name="budgetId" value={b.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="field-label">Nhóm</span>
                <select name="group" defaultValue="marketing" className="field min-h-11 w-full">
                  {(Object.keys(BUDGET_GROUP_LABEL) as BudgetGroup[]).map((g) => (
                    <option key={g} value={g}>
                      {BUDGET_GROUP_LABEL[g]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="field-label">Hạng mục riêng (tùy chọn)</span>
                <select name="categoryId" defaultValue="" className="field min-h-11 w-full">
                  <option value="">Cả nhóm</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="field-label">Số tiền (đồng)</span>
                <input name="amount" required inputMode="numeric" className="field min-h-11 w-full" />
              </label>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
