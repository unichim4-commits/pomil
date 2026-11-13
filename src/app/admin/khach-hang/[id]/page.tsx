import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { displayPhone, formatDateTime, formatVnd } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { hasActiveConsent } from "@/modules/consent/rules";
import { getCustomerCrm, getCustomerDetail, STAGE_LABEL } from "@/modules/customers/admin";
import { RETURN_STATUS_LABEL, type ReturnStatus } from "@/modules/sales/rules";
import { ORDER_STATUS_LABEL } from "@/modules/orders/rules";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, ORDER_TONE, Stat, Table } from "../../_components/ui";
import { accountForCustomer } from "@/modules/accounts/service";
import { addTagAction, careNoteAction, removeTagAction, resetCustomerPasswordAction, stageAction, withdrawConsentAction } from "../actions";

export const metadata: Metadata = { title: "Hồ sơ khách" };

const PURPOSE: Record<string, string> = {
  marketing_message: "Nhận tin",
  data_processing: "Xử lý dữ liệu để giao hàng",
  photo_use: "Dùng ảnh",
  trial_participation: "Tham gia dùng thử",
};

const TOUCH: Record<string, string> = { waitlist_signup: "Đăng ký chờ", order_placed: "Đặt đơn", account_created: "Tạo tài khoản" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, detail, crm] = await Promise.all([requireStaff(), getCustomerDetail(id), getCustomerCrm(id)]);
  if (!detail || !crm) notFound();
  const canCare = can(staff.role, "sales.write");
  const m = crm.metrics;
  const { customer: c, orders, consents, timeline } = detail;
  const account = await accountForCustomer(c.id);
  const showPhone = can(staff.role, "customers.view_phone");
  const canWrite = can(staff.role, "customers.write");
  const marketingOn = hasActiveConsent(
    consents.map((x) => ({ purpose: x.purpose, channel: x.channel, granted: x.granted, capturedAt: x.capturedAt, withdrawnAt: x.withdrawnAt })),
    "marketing_message",
    "zalo",
  );

  return (
    <>
      <Link href="/admin/khach-hang" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Khách hàng
      </Link>
      <div className="mb-8 mt-3 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-light">{c.name || "(chưa có tên)"}</h1>
        <Badge tone={c.lifecycleStage === "repeat_buyer" ? "green" : "neutral"}>{STAGE_LABEL[c.lifecycleStage]}</Badge>
        {(c.tags ?? []).map((t) => (
          <Badge key={t} tone="dark">
            {t}
          </Badge>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Đã chi (trừ hoàn)" value={formatVnd(m.spent)} hint={`${m.orderCount} đơn`} />
        <Stat label="Giá trị đơn trung bình" value={formatVnd(m.aov)} />
        <Stat label="Tần suất mua" value={m.frequencyDays === null ? "—" : `${m.frequencyDays} ngày/lần`} />
        <Stat label="Đơn gần nhất" value={m.lastOrderAt ? formatDateTime(m.lastOrderAt) : "—"} hint={m.topProducts.map((p) => `${p.name} ×${p.qty}`).join(", ") || undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card title={`Đơn hàng · ${orders.length} đơn`}>
            {orders.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa mua lần nào.</p>
            ) : (
              <Table>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/admin/don-hang/${o.id}`} className="font-mono hover:underline">
                          {o.code}
                        </Link>
                      </td>
                      <td className="tabular-nums">{formatVnd(o.total)}</td>
                      <td>
                        <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                      </td>
                      <td className="text-ink-soft">{formatDateTime(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title="Ghi chú chăm sóc">
            {canCare && (
              <ActionForm action={careNoteAction} submitLabel="Lưu ghi chú" className="mb-4 space-y-3" resetOnSuccess>
                <input type="hidden" name="customerId" value={c.id} />
                <textarea name="text" rows={2} maxLength={1000} required placeholder="Đã gọi hỏi cảm nhận sau 2 tuần dùng…" className="field" aria-label="Ghi chú chăm sóc" />
              </ActionForm>
            )}
            {crm.notes.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa có ghi chú.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {crm.notes.map((n) => (
                  <li key={n.id} className="flex gap-4">
                    <span className="w-32 shrink-0 text-ink-soft">{formatDateTime(n.occurredAt)}</span>
                    <span className="whitespace-pre-line">{typeof n.payload.text === "string" ? n.payload.text : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {crm.returns.length > 0 && (
            <Card title="Đổi trả">
              <ul className="divide-y divide-line text-sm">
                {crm.returns.map(({ r, orderCode }) => (
                  <li key={r.id}>
                    <Link href={`/admin/ban-hang/doi-tra/${r.id}`} className="flex min-h-11 flex-wrap items-center gap-3">
                      <span className="font-mono">{r.code}</span>
                      <span className="text-ink-soft">đơn {orderCode}</span>
                      <span className="ml-auto">
                        <Badge tone={r.status === "completed" ? "green" : "neutral"}>{RETURN_STATUS_LABEL[r.status as ReturnStatus]}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {crm.complaints.length > 0 && (
            <Card title="Phản ánh">
              <ul className="divide-y divide-line text-sm">
                {crm.complaints.map((x) => (
                  <li key={x.id} className="flex min-h-11 flex-wrap items-center gap-3 py-2">
                    <span className="text-ink-soft">{formatDateTime(x.openedAt)}</span>
                    <span className="min-w-0 flex-1 truncate">{x.symptoms}</span>
                    <Badge tone={x.status === "closed" ? "neutral" : "amber"}>{x.status === "closed" ? "Đã đóng" : "Đang xử lý"}</Badge>
                  </li>
                ))}
              </ul>
              <Link href="/admin/phan-anh" className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4">
                Mở mục Phản ánh
              </Link>
            </Card>
          )}

          <Card title="Dòng thời gian">
            <ol className="space-y-2 text-sm">
              {timeline.map((t) => (
                <li key={t.id} className="flex gap-4">
                  <span className="w-32 shrink-0 text-ink-soft">{formatDateTime(t.occurredAt)}</span>
                  <span>
                    {TOUCH[t.type] ?? t.type}
                    {typeof t.payload.orderCode === "string" && <span className="ml-2 font-mono text-xs">{t.payload.orderCode}</span>}
                    {typeof t.payload.interest === "string" && <span className="ml-2 text-ink-soft">quan tâm {t.payload.interest}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Nhãn">
            {(c.tags ?? []).length === 0 && <p className="text-sm text-ink-soft">Chưa gắn nhãn.</p>}
            <ul className="flex flex-wrap gap-2">
              {(c.tags ?? []).map((t) => (
                <li key={t} className="flex items-center gap-1 border border-line pl-3">
                  <span className="text-sm">{t}</span>
                  {canCare && (
                    <ActionForm action={removeTagAction} submitLabel="×" pendingLabel="…" className="flex items-center" submitClassName="min-h-11 min-w-11 text-ink-soft hover:text-danger" inline>
                      <input type="hidden" name="customerId" value={c.id} />
                      <input type="hidden" name="tag" value={t} />
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
            {canCare && (
              <ActionForm action={addTagAction} submitLabel="Gắn" className="mt-3 flex flex-wrap items-center gap-2" submitClassName="btn btn-outline min-h-11" inline resetOnSuccess>
                <input type="hidden" name="customerId" value={c.id} />
                <input name="tag" maxLength={30} required placeholder="vip, đại lý tiềm năng…" className="field min-h-11 min-w-0 flex-1 text-sm" aria-label="Nhãn mới" />
              </ActionForm>
            )}
          </Card>

          <Card title="Liên hệ">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Điện thoại</dt>
                <dd>{c.phoneE164 ? (showPhone ? displayPhone(c.phoneE164) : maskPhone(c.phoneE164)) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Mã giới thiệu</dt>
                <dd className="font-mono">{c.referralCode}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Nguồn đầu tiên</dt>
                <dd>{[c.firstTouchUtm?.utm_source, c.firstTouchUtm?.utm_campaign].filter(Boolean).join(" / ") || "Trực tiếp"}</dd>
              </div>
              {c.landingVariant && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">Phiên bản trang đích</dt>
                  <dd>{c.landingVariant}</dd>
                </div>
              )}
              {c.scalpProfile.concerns && c.scalpProfile.concerns.length > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">Vấn đề da đầu</dt>
                  <dd>{c.scalpProfile.concerns.join(", ")}</dd>
                </div>
              )}
            </dl>
            {canWrite && (
              <ActionForm action={stageAction} submitLabel="Đổi" className="mt-4 flex items-center gap-2" submitClassName="btn btn-outline min-h-11" inline>
                <input type="hidden" name="customerId" value={c.id} />
                <select name="stage" defaultValue={c.lifecycleStage} className="field min-h-11 text-sm" aria-label="Giai đoạn">
                  {Object.entries(STAGE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </ActionForm>
            )}
          </Card>

          <Card title="Tài khoản website">
            {account ? (
              <>
                <p className="text-sm">
                  Có tài khoản từ {formatDateTime(account.createdAt)}. Đăng nhập gần nhất: {account.lastLoginAt ? formatDateTime(account.lastLoginAt) : "chưa"}.
                </p>
                {canWrite && (
                  <ActionForm
                    action={resetCustomerPasswordAction}
                    submitLabel="Đặt mật khẩu tạm"
                    className="mt-4"
                    submitClassName="btn btn-outline min-h-11"
                    confirm="Chỉ làm khi khách nhắn từ đúng số đã đăng ký. Đặt mật khẩu tạm và đăng xuất khách khỏi mọi máy?"
                  >
                    <input type="hidden" name="customerId" value={c.id} />
                  </ActionForm>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-soft">Khách chưa tạo tài khoản, mua dạng khách vãng lai.</p>
            )}
          </Card>

          <Card title="Đồng ý (bằng chứng)">
            <p className="mb-4 text-sm">
              Nhận tin: <Badge tone={marketingOn ? "green" : "neutral"}>{marketingOn ? "Đang đồng ý" : "Không gửi"}</Badge>
            </p>
            <ul className="space-y-2 text-xs">
              {consents.map((x) => (
                <li key={x.id} className="border-t border-line pt-2">
                  <span className={x.granted && !x.withdrawnAt ? "text-ok" : "text-ink-soft"}>
                    {x.granted ? (x.withdrawnAt ? "Đã rút" : "Đồng ý") : "Không đồng ý"}
                  </span>{" "}
                  · {PURPOSE[x.purpose] ?? x.purpose} · {x.source} · {formatDateTime(x.capturedAt)} · bản {x.policyVersion}
                </li>
              ))}
            </ul>
            {canWrite && marketingOn && (
              <ActionForm action={withdrawConsentAction} submitLabel="Khách yêu cầu dừng nhận tin" submitClassName="btn btn-outline mt-4 text-xs" confirm="Ghi nhận khách dừng nhận tin?">
                <input type="hidden" name="customerId" value={c.id} />
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
