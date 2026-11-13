import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDate, formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getCashTransaction, listAccountsWithBalance, sourceHref } from "@/modules/finance/cash";
import { fileUrl } from "@/modules/files/service";
import { ACCOUNT_KIND_LABEL, CASH_STATUS_LABEL, manualCancelProblem, PL_LINE_LABEL, SOURCE_LABEL } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader, type BadgeTone } from "../../../_components/ui";
import { approveCashAction, cancelCashAction, rejectCashAction } from "../../actions";
import { LegalNotice, Money } from "../../_shared";

export const metadata: Metadata = { title: "Phiếu thu chi" };

const STATUS_TONE: Record<string, BadgeTone> = { pending_approval: "amber", posted: "green", cancelled: "red" };
const DIR_LABEL = { in: "Phiếu thu", out: "Phiếu chi", transfer: "Chuyển quỹ" } as const;

export default async function CashDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireStaff();
  const canView = can(me.role, "finance.view");
  if (!canView && !can(me.role, "finance.request")) redirect("/admin");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const row = await getCashTransaction(db, id);
  if (!row) notFound();
  const t = row.tx;
  // Cộng tác viên chỉ xem đề nghị của mình
  if (!canView && t.createdBy !== me.id) redirect("/admin/tai-chinh/thu-chi?cua-toi=1");
  const canApprove = can(me.role, "finance.approve");
  const accounts = canApprove && t.status === "pending_approval" ? await listAccountsWithBalance(db, { activeOnly: true }) : [];
  const href = sourceHref(t.sourceType, t.sourceId);
  const cancelProblem = manualCancelProblem({ status: t.status, sourceType: t.sourceType, idempotencyKey: t.idempotencyKey });
  const today = vnToday();

  const rows: [string, React.ReactNode][] = [
    ["Ngày", formatDate(t.occurredOn)],
    ["Số tiền", <Money key="m" value={t.amount} />],
    ["Tài khoản", t.direction === "transfer" ? `${row.accountName} → ${row.toAccountName ?? ""}` : `${row.accountName} · ${ACCOUNT_KIND_LABEL[row.accountKind]}`],
    ["Hạng mục", row.categoryName ? `${row.categoryName} (${row.categoryCode})` : "—"],
    ["Dòng lãi lỗ", row.plLine ? PL_LINE_LABEL[row.plLine] : "—"],
    ["Đối tượng", t.counterpartyName || "—"],
    ["Kênh", t.channelCode ?? "—"],
    [
      "Nguồn",
      href ? (
        <Link key="s" href={href} className="underline underline-offset-4">
          {SOURCE_LABEL[t.sourceType ?? ""] ?? t.sourceType} {t.sourceCode ?? ""}
        </Link>
      ) : (
        "Phiếu tay"
      ),
    ],
    ["Người lập", `${row.creatorName ?? "Hệ thống"} · ${formatDateTime(t.createdAt)}`],
    ["Người duyệt", row.approverName ? `${row.approverName} · ${formatDateTime(t.approvedAt)}` : "—"],
    ["Ghi chú", t.note || "—"],
  ];
  if (t.status === "cancelled") rows.push(["Lý do hủy", `${t.cancelReason ?? "—"} · ${formatDateTime(t.cancelledAt)}`]);

  return (
    <>
      <PageHeader
        title={`${DIR_LABEL[t.direction]} ${t.code}`}
        actions={
          <Link href={canView ? "/admin/tai-chinh/thu-chi" : "/admin/tai-chinh/thu-chi?cua-toi=1"} className="btn btn-outline min-h-11">
            ← Danh sách
          </Link>
        }
      />
      <LegalNotice />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card title="Chi tiết" actions={<Badge tone={STATUS_TONE[t.status]}>{CASH_STATUS_LABEL[t.status]}</Badge>}>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-soft">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {t.fileIds.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {t.fileIds.map((f) => (
                <a key={f} href={fileUrl(f)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center border border-line px-3 text-sm hover:border-graphite">
                  Ảnh chứng từ
                </a>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          {canApprove && t.status === "pending_approval" && (
            <>
              <Card title="Duyệt đề nghị">
                <ActionForm action={approveCashAction} submitLabel="Duyệt và ghi sổ" submitClassName="btn btn-primary min-h-11">
                  <input type="hidden" name="id" value={t.id} />
                  <label className="block text-sm">
                    <span className="field-label">Chi từ tài khoản</span>
                    <select name="accountId" defaultValue={t.accountId} className="field min-h-11 w-full">
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · còn {a.balance.toLocaleString("vi-VN")}đ
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="field-label">Ngày chi</span>
                    <input type="date" name="occurredOn" defaultValue={t.occurredOn} max={today} className="field min-h-11 w-full" />
                  </label>
                </ActionForm>
              </Card>
              <Card title="Từ chối">
                <ActionForm action={rejectCashAction} submitLabel="Từ chối" submitClassName="btn btn-outline min-h-11">
                  <input type="hidden" name="id" value={t.id} />
                  <input name="reason" required placeholder="Lý do từ chối" className="field min-h-11 w-full" />
                </ActionForm>
              </Card>
            </>
          )}

          {canApprove && t.status === "posted" && (
            <Card title="Hủy phiếu">
              {cancelProblem ? (
                <p className="text-sm text-ink-soft">
                  {cancelProblem}
                  {href && (
                    <>
                      {" "}
                      <Link href={href} className="underline underline-offset-4">
                        Mở chứng từ gốc
                      </Link>
                    </>
                  )}
                </p>
              ) : (
                <ActionForm action={cancelCashAction} submitLabel="Hủy phiếu" confirm={`Hủy ${t.code}? Số dư tài khoản sẽ trở lại như trước.`} submitClassName="btn btn-outline min-h-11">
                  <input type="hidden" name="id" value={t.id} />
                  <input name="reason" required placeholder="Lý do hủy" className="field min-h-11 w-full" />
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
