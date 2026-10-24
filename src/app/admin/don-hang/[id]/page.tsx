import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { displayPhone, formatDateTime, formatVnd } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { ORDER_STATUS_LABEL, ORDER_TRANSITIONS } from "@/modules/orders/rules";
import { getOrderDetail } from "@/modules/orders/service";
import { lotNotPublicWarning } from "@/modules/quality/rules";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, ORDER_TONE } from "../../_components/ui";
import { assignLotAction, changeStatusAction, paymentAction, shippingAction } from "../actions";

export const metadata: Metadata = { title: "Chi tiết đơn" };

const NEXT_LABEL: Record<string, string> = {
  confirmed: "Xác nhận đơn",
  packing: "Bắt đầu đóng gói",
  shipping: "Đã giao cho vận chuyển",
  delivered: "Khách đã nhận",
  cancelled: "Hủy đơn",
  returned: "Ghi nhận hoàn trả",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, detail] = await Promise.all([requireStaff(), getOrderDetail(id)]);
  if (!detail) notFound();
  const { order, items, events, availableLots } = detail;
  const canWrite = can(staff.role, "orders.write");
  const showPhone = can(staff.role, "customers.view_phone");
  const nextStatuses = ORDER_TRANSITIONS[order.status];
  const forward = nextStatuses.filter((s) => s !== "cancelled" && s !== "returned");
  const backward = nextStatuses.filter((s) => s === "cancelled" || s === "returned");

  return (
    <>
      <Link href="/admin/don-hang" className="text-sm text-ink-soft hover:text-graphite">
        ← Đơn hàng
      </Link>
      <div className="mb-8 mt-3 flex flex-wrap items-center gap-4">
        <h1 className="font-mono text-2xl">{order.code}</h1>
        <Badge tone={ORDER_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
        <span className="text-sm text-ink-soft">Đặt lúc {formatDateTime(order.createdAt)}</span>
        <Link href={`/don-hang/${order.code}?t=${order.accessToken}`} target="_blank" className="ml-auto text-sm underline underline-offset-4">
          Trang khách xem ↗
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card title="Sản phẩm và số lô">
            <ul className="divide-y divide-line">
              {items.map((item) => {
                const lots = availableLots.filter((l) => l.productId === item.productId);
                const lotWarning = item.lotId && item.lotReleaseStatus ? lotNotPublicWarning({ isPublic: !!item.lotIsPublic, releaseStatus: item.lotReleaseStatus }) : null;
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-4 py-3 first:pt-0">
                    <div className="min-w-48 flex-1">
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-sm text-ink-soft">
                        {item.quantity} × {formatVnd(item.unitPrice)} = {formatVnd(item.lineTotal)}
                      </p>
                    </div>
                    {canWrite ? (
                      <ActionForm action={assignLotAction} submitLabel="Gán" pendingLabel="…" className="flex w-full flex-wrap items-center gap-2 sm:w-auto" submitClassName="btn btn-outline px-4 text-sm" inline>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="orderId" value={order.id} />
                        <select name="lotId" defaultValue={item.lotId ?? ""} className="field min-w-0 flex-1 sm:w-60 sm:flex-none" aria-label="Số lô">
                          <option value="">Chưa gán lô</option>
                          {lots.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.isPublic ? l.lotNo : `${l.lotNo} (chưa công khai)`}
                            </option>
                          ))}
                        </select>
                      </ActionForm>
                    ) : (
                      <span className="font-mono text-sm">{item.lotNo ?? "Chưa gán lô"}</span>
                    )}
                    {lotWarning && (
                      <p className="basis-full bg-[#f1e2c4] px-3 py-1 text-sm text-[#6b4e12]" role="status">
                        {lotWarning}{" "}
                        {item.lotId && (
                          <Link href={`/admin/lo/${item.lotId}`} className="inline-flex min-h-11 items-center px-1 underline underline-offset-4">
                            Mở lô
                          </Link>
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {availableLots.length === 0 && <p className="mt-3 text-xs text-ink-soft">Chưa có lô nào được duyệt xuất kho cho các sản phẩm này. Duyệt lô ở mục Lô và kiểm nghiệm.</p>}
            <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Tạm tính</dt>
                <dd>{formatVnd(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Phí giao</dt>
                <dd>{formatVnd(order.shippingFee)}</dd>
              </div>
              <div className="flex justify-between text-base font-medium">
                <dt>Tổng</dt>
                <dd>{formatVnd(order.total)}</dd>
              </div>
            </dl>
          </Card>

          {canWrite && (forward.length > 0 || backward.length > 0) && (
            <Card title="Xử lý đơn">
              <div className="space-y-5">
                {forward.map((to) => (
                  <ActionForm key={to} action={changeStatusAction} submitLabel={NEXT_LABEL[to] ?? ORDER_STATUS_LABEL[to]} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="to" value={to} />
                    <input name="note" placeholder="Ghi chú (không bắt buộc)" className="field min-h-11 max-w-xs py-1.5 text-sm" />
                  </ActionForm>
                ))}
                {backward.map((to) => (
                  <details key={to} className="border-t border-line pt-4">
                    <summary className="cursor-pointer text-sm text-danger">{NEXT_LABEL[to]}…</summary>
                    <ActionForm
                      action={changeStatusAction}
                      submitLabel={NEXT_LABEL[to]}
                      submitClassName="btn border-danger bg-danger text-bone"
                      confirm={`${NEXT_LABEL[to]} ${order.code}? Hàng sẽ được cộng lại vào kho.`}
                      className="mt-3 flex flex-wrap items-center gap-3"
                    >
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="to" value={to} />
                      <input name="note" required placeholder="Lý do (bắt buộc)" className="field min-h-11 max-w-xs py-1.5 text-sm" />
                    </ActionForm>
                  </details>
                ))}
              </div>
            </Card>
          )}

          <Card title="Lịch sử">
            <ol className="space-y-3 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex gap-4">
                  <span className="w-32 shrink-0 text-ink-soft">{formatDateTime(e.at)}</span>
                  <span>
                    {e.toStatus && e.type === "status" ? (
                      <>
                        {e.fromStatus ? ORDER_STATUS_LABEL[e.fromStatus as keyof typeof ORDER_STATUS_LABEL] : ""} → <strong className="font-medium">{ORDER_STATUS_LABEL[e.toStatus as keyof typeof ORDER_STATUS_LABEL]}</strong>
                      </>
                    ) : null}
                    {e.note && <span className={e.type === "status" ? "ml-2 text-ink-soft" : ""}>{e.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Khách và địa chỉ">
            <p className="font-medium">{order.recipientName}</p>
            <p className="text-sm">{showPhone ? displayPhone(order.phoneE164) : maskPhone(order.phoneE164)}</p>
            {order.email && showPhone && <p className="text-sm text-ink-soft">{order.email}</p>}
            <p className="mt-3 text-sm text-ink-soft">
              {order.addressLine}, {order.ward}, {order.province}
            </p>
            {order.customerNote && <p className="mt-3 bg-pith p-3 text-sm">Khách ghi: {order.customerNote}</p>}
            {order.customerId && (
              <Link href={`/admin/khach-hang/${order.customerId}`} className="mt-3 inline-block text-sm underline underline-offset-4">
                Hồ sơ khách
              </Link>
            )}
            {order.utm && (order.utm.utm_source || order.utm.ref) && (
              <p className="mt-3 text-xs text-ink-soft">
                Nguồn: {[order.utm.utm_source, order.utm.utm_medium, order.utm.utm_campaign].filter(Boolean).join(" / ")}
                {order.utm.ref && ` · giới thiệu ${order.utm.ref}`}
              </p>
            )}
          </Card>

          <Card title="Thanh toán">
            <p className="text-sm">
              {order.paymentMethod === "cod" ? "Thu tiền khi giao (COD)" : "Chuyển khoản"} ·{" "}
              <Badge tone={order.paymentStatus === "paid" ? "green" : order.paymentStatus === "refunded" ? "red" : "amber"}>
                {order.paymentStatus === "paid" ? "Đã thanh toán" : order.paymentStatus === "refunded" ? "Đã hoàn tiền" : "Chưa thanh toán"}
              </Badge>
            </p>
            {order.paidAt && <p className="mt-1 text-xs text-ink-soft">Lúc {formatDateTime(order.paidAt)}</p>}
            {canWrite && (
              <ActionForm action={paymentAction} submitLabel="Cập nhật" className="mt-4 flex items-center gap-2" submitClassName="btn btn-outline min-h-11 py-1.5" inline>
                <input type="hidden" name="orderId" value={order.id} />
                <select name="paymentStatus" defaultValue={order.paymentStatus} className="field min-h-11 py-1.5 text-sm">
                  <option value="unpaid">Chưa thanh toán</option>
                  <option value="paid">Đã thanh toán</option>
                  <option value="refunded">Đã hoàn tiền</option>
                </select>
              </ActionForm>
            )}
          </Card>

          <Card title="Vận chuyển và ghi chú nội bộ">
            {canWrite ? (
              <ActionForm action={shippingAction}>
                <input type="hidden" name="orderId" value={order.id} />
                <label className="block">
                  <span className="field-label">Đơn vị vận chuyển</span>
                  <input name="carrier" defaultValue={order.carrier ?? ""} placeholder="GHN, GHTK, Viettel Post…" className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Mã vận đơn</span>
                  <input name="trackingNo" defaultValue={order.trackingNo ?? ""} className="field font-mono" />
                </label>
                <label className="block">
                  <span className="field-label">Ghi chú nội bộ (khách không thấy)</span>
                  <textarea name="internalNote" defaultValue={order.internalNote ?? ""} rows={3} className="field" />
                </label>
              </ActionForm>
            ) : (
              <div className="text-sm">
                <p>
                  {order.carrier ?? "—"} {order.trackingNo && <span className="font-mono">· {order.trackingNo}</span>}
                </p>
                {order.internalNote && <p className="mt-2 text-ink-soft">{order.internalNote}</p>}
              </div>
            )}
            {order.cancelReason && <p className="mt-4 text-sm text-danger">Lý do hủy: {order.cancelReason}</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
