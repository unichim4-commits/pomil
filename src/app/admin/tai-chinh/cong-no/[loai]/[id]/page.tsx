import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { listAccountsWithBalance } from "@/modules/finance/cash";
import { DEBT_KIND_SLUG, debtKindFromSlug, getDebt } from "@/modules/finance/debts";
import { AGING_LABEL, CASH_STATUS_LABEL, DEBT_STATUS_LABEL } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";
import { ActionForm } from "../../../../_components/action-form";
import { Badge, Card, PageHeader, Table, type BadgeTone } from "../../../../_components/ui";
import { adjustDebtAction, cancelDebtAction, cancelPaymentAction, payDebtAction } from "../../../actions";
import { LegalNotice, Money, requireFinanceView } from "../../../_shared";

export const metadata: Metadata = { title: "Khoản công nợ" };

const STATUS_TONE: Record<string, BadgeTone> = { open: "amber", partial: "amber", paid: "green", cancelled: "neutral" };

export default async function DebtDetailPage({ params }: { params: Promise<{ loai: string; id: string }> }) {
  const me = await requireFinanceView();
  const { loai, id } = await params;
  const kind = debtKindFromSlug(loai);
  if (!kind || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const today = vnToday();
  const debt = await getDebt(db, kind, id, today);
  if (!debt) notFound();
  const canWrite = can(me.role, "finance.write");
  const canApprove = can(me.role, "finance.approve");
  const isOpen = debt.status === "open" || debt.status === "partial";
  const accounts = canWrite && isOpen ? await listAccountsWithBalance(db, { activeOnly: true }) : [];
  const kindLabel = kind === "receivable" ? "Phải thu" : "Phải trả";

  const info: [string, React.ReactNode][] = [
    [kind === "receivable" ? "Khách / đại lý" : "Nhà cung cấp", debt.partyName],
    [
      "Nguồn",
      debt.sourceHref ? (
        <Link key="s" href={debt.sourceHref} className="underline underline-offset-4">
          {debt.sourceLabel}
        </Link>
      ) : (
        debt.sourceLabel
      ),
    ],
    ["Hạng mục", debt.categoryName ?? "—"],
    ["Ngày ghi nợ", formatDate(debt.issuedOn)],
    ["Hạn", `${formatDate(debt.dueOn)}${debt.overdueDays > 0 ? ` · quá ${debt.overdueDays} ngày` : debt.dueSoon ? " · sắp đến hạn" : ""}`],
    ["Tuổi nợ", debt.bucket ? AGING_LABEL[debt.bucket] : "—"],
    ["Số nợ", <Money key="a" value={debt.amount} />],
    ["Đã trả", <Money key="p" value={debt.paidAmount} />],
    ["Còn lại", <Money key="r" value={debt.remaining} />],
    ["Ghi chú", debt.note || "—"],
  ];
  if (debt.status === "cancelled") info.push(["Lý do hủy", debt.cancelReason ?? "—"]);

  return (
    <>
      <PageHeader
        title={`${kindLabel} ${debt.code}`}
        actions={
          <Link href={`/admin/tai-chinh/cong-no?the=${DEBT_KIND_SLUG[kind]}`} className="btn btn-outline min-h-11">
            ← Công nợ
          </Link>
        }
      />
      <LegalNotice />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card title="Chi tiết" actions={<Badge tone={debt.overdueDays > 0 ? "red" : STATUS_TONE[debt.status]}>{DEBT_STATUS_LABEL[debt.status]}</Badge>}>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
              {info.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-soft">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Lịch sử thanh toán">
            {debt.payments.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa có lần thanh toán nào.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Phiếu</th>
                    <th>Tài khoản</th>
                    <th className="text-right">Số tiền</th>
                    <th>Trạng thái</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {debt.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">{formatDate(p.paidOn)}</td>
                      <td>
                        <Link href={`/admin/tai-chinh/thu-chi/${p.cashTxId}`} className="inline-flex min-h-11 items-center font-mono underline-offset-4 hover:underline">
                          {p.cashCode}
                        </Link>
                      </td>
                      <td>{p.accountName}</td>
                      <td className="text-right">
                        <Money value={p.amount} />
                      </td>
                      <td>
                        <Badge tone={p.cashStatus === "cancelled" ? "neutral" : "green"}>{CASH_STATUS_LABEL[p.cashStatus]}</Badge>
                        {p.cancelReason && <span className="ml-1 text-xs text-ink-soft">{p.cancelReason}</span>}
                      </td>
                      <td>
                        {canApprove && p.cashStatus === "posted" && (
                          <ActionForm action={cancelPaymentAction} submitLabel="Hủy thanh toán" inline className="flex flex-wrap items-center gap-2" confirm="Hủy lần thanh toán này? Phiếu thu chi đi kèm cũng bị hủy." submitClassName="btn btn-outline min-h-11 text-xs">
                            <input type="hidden" name="kind" value={kind} />
                            <input type="hidden" name="debtId" value={debt.id} />
                            <input type="hidden" name="paymentId" value={p.id} />
                            <input name="reason" required placeholder="Lý do" className="field min-h-11 w-32 text-sm" />
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        {canWrite && isOpen && (
          <div className="space-y-6">
            <Card title={kind === "receivable" ? "Ghi tiền thu" : "Ghi tiền trả"}>
              <ActionForm action={payDebtAction} submitLabel="Ghi thanh toán" submitClassName="btn btn-primary min-h-11" resetOnSuccess>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="debtId" value={debt.id} />
                <input type="hidden" name="expectedPaidAmount" value={String(debt.paidAmount)} />
                <label className="block text-sm">
                  <span className="field-label">Số tiền (còn {debt.remaining.toLocaleString("vi-VN")}đ)</span>
                  <input name="amount" required inputMode="numeric" defaultValue={String(debt.remaining)} className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Tài khoản</span>
                  <select name="accountId" required className="field min-h-11 w-full">
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · còn {a.balance.toLocaleString("vi-VN")}đ
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Ngày</span>
                  <input type="date" name="paidOn" required defaultValue={today} max={today} className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Ghi chú</span>
                  <input name="note" className="field min-h-11 w-full" />
                </label>
              </ActionForm>
            </Card>

            <Card title="Điều chỉnh số nợ">
              <ActionForm action={adjustDebtAction} submitLabel="Điều chỉnh" submitClassName="btn btn-outline min-h-11">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="debtId" value={debt.id} />
                <label className="block text-sm">
                  <span className="field-label">Số nợ mới (không nhỏ hơn số đã trả)</span>
                  <input name="newAmount" required inputMode="numeric" defaultValue={String(debt.amount)} className="field min-h-11 w-full" />
                </label>
                <input name="reason" required placeholder="Lý do" className="field min-h-11 w-full" />
              </ActionForm>
            </Card>

            {debt.paidAmount === 0 && (
              <Card title="Hủy khoản nợ">
                <ActionForm action={cancelDebtAction} submitLabel="Hủy khoản nợ" confirm={`Hủy ${debt.code}?`} submitClassName="btn btn-outline min-h-11">
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="debtId" value={debt.id} />
                  <input name="reason" required placeholder="Lý do hủy" className="field min-h-11 w-full" />
                </ActionForm>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
