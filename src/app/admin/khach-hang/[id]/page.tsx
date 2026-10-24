import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { displayPhone, formatDateTime, formatVnd } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { hasActiveConsent } from "@/modules/consent/rules";
import { getCustomerDetail, STAGE_LABEL } from "@/modules/customers/admin";
import { ORDER_STATUS_LABEL } from "@/modules/orders/rules";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, ORDER_TONE, Table } from "../../_components/ui";
import { stageAction, withdrawConsentAction } from "../actions";

export const metadata: Metadata = { title: "Hồ sơ khách" };

const PURPOSE: Record<string, string> = {
  marketing_message: "Nhận tin",
  data_processing: "Xử lý dữ liệu để giao hàng",
  photo_use: "Dùng ảnh",
  trial_participation: "Tham gia dùng thử",
};

const TOUCH: Record<string, string> = { waitlist_signup: "Đăng ký chờ", order_placed: "Đặt đơn" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, detail] = await Promise.all([requireStaff(), getCustomerDetail(id)]);
  if (!detail) notFound();
  const { customer: c, orders, consents, timeline } = detail;
  const showPhone = can(staff.role, "customers.view_phone");
  const canWrite = can(staff.role, "customers.write");
  const marketingOn = hasActiveConsent(
    consents.map((x) => ({ purpose: x.purpose, channel: x.channel, granted: x.granted, capturedAt: x.capturedAt, withdrawnAt: x.withdrawnAt })),
    "marketing_message",
    "zalo",
  );
  const spent = orders.filter((o) => o.status !== "cancelled" && o.status !== "returned").reduce((s, o) => s + o.total, 0);

  return (
    <>
      <Link href="/admin/khach-hang" className="text-sm text-ink-soft hover:text-graphite">
        ← Khách hàng
      </Link>
      <div className="mb-8 mt-3 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-light">{c.name || "(chưa có tên)"}</h1>
        <Badge tone={c.lifecycleStage === "repeat_buyer" ? "green" : "neutral"}>{STAGE_LABEL[c.lifecycleStage]}</Badge>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card title={`Đơn hàng · ${orders.length} đơn · ${formatVnd(spent)}`}>
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
              <ActionForm action={stageAction} submitLabel="Đổi" className="mt-4 flex items-center gap-2" submitClassName="btn btn-outline min-h-10 py-1.5" inline>
                <input type="hidden" name="customerId" value={c.id} />
                <select name="stage" defaultValue={c.lifecycleStage} className="field min-h-10 py-1.5 text-sm" aria-label="Giai đoạn">
                  {Object.entries(STAGE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </ActionForm>
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
