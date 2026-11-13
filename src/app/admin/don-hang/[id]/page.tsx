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
import { listReturnsForOrder } from "@/modules/sales/returns";
import { PAYMENT_METHOD_LABEL, RETURN_STATUS_LABEL, type PaymentMethod, type ReturnStatus } from "@/modules/sales/rules";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, ORDER_TONE } from "../../_components/ui";
import { assignLotAction, changeStatusAction, deliverOnSpotAction, deliveryFailedAction, paymentAction, platformFeeAction, shippingAction } from "../actions";

export const metadata: Metadata = { title: "Chi tiết đơn" };

const NEXT_LABEL: Record<string, string> = {
  confirmed: "Xác nhận đơn",
  packing: "Bắt đầu đóng gói",
  shipping: "Đã giao cho vận chuyển",
  delivered: "Khách đã nhận",
  cancelled: "Hủy đơn",
  returned: "Ghi nhận hoàn về",
};

const linkCls = "inline-flex min-h-11 items-center text-sm underline underline-offset-4";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, detail, returns] = await Promise.all([requireStaff(), getOrderDetail(id), listReturnsForOrder(id)]);
  if (!detail) notFound();
  const { order, items, events, availableLots } = detail;
  const canWrite = can(staff.role, "orders.write");
  const showPhone = can(staff.role, "customers.view_phone");
  const nextStatuses = ORDER_TRANSITIONS[order.status];
  const forward = nextStatuses.filter((s) => s !== "cancelled" && s !== "returned");
  const backward = nextStatuses.filter((s) => s === "cancelled" || s === "returned");
  const anyTracked = items.some((i) => i.trackInventory);
  // Hàng quản lý kho: xuất kho FEFO ở màn Đóng gói (R-BH-13)
  const needsPacking = anyTracked && !order.stockIssuedAt && (order.status === "confirmed" || order.status === "packing");
  const usesDebt = order.paymentMethod === "credit" || order.paymentMethod === "platform";
  const isDirect = order.channel !== "WEB" && (order.paymentMethod === "cash" || order.paymentMethod === "bank_transfer") && ["pending", "confirmed", "packing"].includes(order.status);
  const methodLabel = PAYMENT_METHOD_LABEL[order.paymentMethod as PaymentMethod] ?? order.paymentMethod;

  return (
    <>
      <Link href="/admin/don-hang" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Đơn hàng
      </Link>
      <div className="mb-8 mt-3 flex flex-wrap items-center gap-4">
        <h1 className="font-mono text-2xl">{order.code}</h1>
        <Badge tone={ORDER_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
        <span className="text-sm text-ink-soft">Đặt lúc {formatDateTime(order.createdAt)}</span>
        <span className="text-sm text-ink-soft">
          Kênh {order.channel}
          {order.externalRef ? ` · mã ngoài ${order.externalRef}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-x-4">
          {canWrite && needsPacking && (
            <Link href={`/admin/ban-hang/dong-goi/${order.id}`} className={linkCls}>
              Đóng gói
            </Link>
          )}
          {(order.stockIssuedAt || ["packing", "shipping"].includes(order.status)) && (
            <>
              <Link href={`/admin/ban-hang/dong-goi/${order.id}/phieu`} target="_blank" className={linkCls}>
                Phiếu đóng gói
              </Link>
              <Link href={`/admin/ban-hang/dong-goi/${order.id}/nhan`} target="_blank" className={linkCls}>
                Nhãn giao
              </Link>
            </>
          )}
          {canWrite && order.status === "delivered" && (
            <Link href={`/admin/ban-hang/doi-tra/moi?don=${order.id}`} className={linkCls}>
              Tạo đổi trả
            </Link>
          )}
          <Link href={`/don-hang/${order.code}?t=${order.accessToken}`} target="_blank" className={linkCls}>
            Trang khách xem ↗
          </Link>
        </div>
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
                    {item.trackInventory ? (
                      <span className="font-mono text-sm">{item.lotNo ?? (order.stockIssuedAt ? "—" : "Chọn lô khi đóng gói")}</span>
                    ) : canWrite ? (
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
            {!anyTracked && availableLots.length === 0 && <p className="mt-3 text-xs text-ink-soft">Chưa có lô nào được duyệt xuất kho cho các sản phẩm này. Duyệt lô ở mục Lô và kiểm nghiệm.</p>}
            <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Tạm tính</dt>
                <dd>{formatVnd(order.subtotal)}</dd>
              </div>
              {order.discountTotal > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Giảm giá{order.voucherCode ? ` (mã ${order.voucherCode})` : ""}</dt>
                  <dd>−{formatVnd(order.discountTotal)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-soft">Phí giao</dt>
                <dd>{formatVnd(order.shippingFee)}</dd>
              </div>
              <div className="flex justify-between text-base font-medium">
                <dt>Tổng</dt>
                <dd>{formatVnd(order.total)}</dd>
              </div>
              {order.platformFee > 0 && (
                <div className="flex justify-between text-ink-soft">
                  <dt>Phí nền tảng (sàn giữ lại)</dt>
                  <dd>{formatVnd(order.platformFee)}</dd>
                </div>
              )}
            </dl>
          </Card>

          {canWrite && (forward.length > 0 || backward.length > 0) && (
            <Card title="Xử lý đơn">
              <div className="space-y-5">
                {needsPacking && (
                  <p className="bg-pith p-3 text-sm">
                    Đơn có hàng quản lý kho: xuất kho ở{" "}
                    <Link href={`/admin/ban-hang/dong-goi/${order.id}`} className="underline underline-offset-4">
                      màn Đóng gói
                    </Link>{" "}
                    (chọn lô theo hạn dùng). Bấm giao vận chuyển khi chưa xuất kho thì hệ thống tự xuất FEFO.
                  </p>
                )}
                {isDirect && (
                  <ActionForm action={deliverOnSpotAction} submitLabel="Giao tại chỗ" confirm={`Giao tại chỗ ${order.code}? Hệ thống xuất kho và đánh dấu khách đã nhận.`} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="orderId" value={order.id} />
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" name="paidNow" defaultChecked className="size-5" /> Đã thu tiền ngay ({methodLabel})
                    </label>
                  </ActionForm>
                )}
                {forward.map((to) => (
                  <ActionForm key={to} action={changeStatusAction} submitLabel={NEXT_LABEL[to] ?? ORDER_STATUS_LABEL[to]} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="to" value={to} />
                    <input name="note" placeholder="Ghi chú (không bắt buộc)" className="field min-h-11 max-w-xs py-1.5 text-sm" />
                  </ActionForm>
                ))}
                {order.status === "shipping" && (
                  <details className="border-t border-line pt-4">
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm">Ghi giao thất bại…</summary>
                    <ActionForm action={deliveryFailedAction} submitLabel="Ghi giao thất bại" className="mt-3 flex flex-wrap items-center gap-3">
                      <input type="hidden" name="orderId" value={order.id} />
                      <input name="reason" required placeholder="Lý do (khách vắng, sai địa chỉ…)" className="field min-h-11 max-w-xs py-1.5 text-sm" />
                    </ActionForm>
                  </details>
                )}
                {backward.map((to) => (
                  <details key={to} className="border-t border-line pt-4">
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm text-danger">{NEXT_LABEL[to]}…</summary>
                    <ActionForm
                      action={changeStatusAction}
                      submitLabel={NEXT_LABEL[to]}
                      submitClassName="btn border-danger bg-danger text-bone"
                      confirm={to === "cancelled" ? `Hủy ${order.code}? Hàng sẽ được cộng lại vào kho.` : `Ghi nhận ${order.code} hoàn về? Hàng xử lý theo lựa chọn từng dòng.`}
                      className="mt-3 flex flex-wrap items-center gap-3"
                    >
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="to" value={to} />
                      <input name="note" required placeholder="Lý do (bắt buộc)" className="field min-h-11 max-w-xs py-1.5 text-sm" />
                      {to === "returned" && (
                        <div className="basis-full space-y-2">
                          <p className="text-sm text-ink-soft">Hàng hoàn về xử lý thế nào?</p>
                          {items.map((item) => (
                            <label key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="min-w-40 flex-1">
                                {item.productName} × {item.quantity}
                                {item.lotNo ? ` · lô ${item.lotNo}` : ""}
                              </span>
                              <select name={`disposition:${item.id}`} defaultValue="restock" className="field min-h-11 w-auto py-1.5 text-sm">
                                <option value="restock">Nhập lại kho bán</option>
                                <option value="quarantine">Đưa vào khu cách ly</option>
                              </select>
                            </label>
                          ))}
                        </div>
                      )}
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
              <Link href={`/admin/khach-hang/${order.customerId}`} className={`mt-1 ${linkCls}`}>
                Hồ sơ khách
              </Link>
            )}
            {order.dealerId && (
              <Link href={`/admin/ban-hang/dai-ly/${order.dealerId}`} className={`mt-1 ml-4 ${linkCls}`}>
                Hồ sơ đại lý
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
              {methodLabel} ·{" "}
              <Badge tone={order.paymentStatus === "paid" ? "green" : order.paymentStatus === "refunded" ? "red" : "amber"}>
                {order.paymentStatus === "paid" ? "Đã thanh toán" : order.paymentStatus === "refunded" ? "Đã hoàn tiền" : "Chưa thanh toán"}
              </Badge>
            </p>
            {order.paidAt && <p className="mt-1 text-xs text-ink-soft">Lúc {formatDateTime(order.paidAt)}</p>}
            {usesDebt ? (
              <p className="mt-3 text-sm text-ink-soft">
                {order.paymentMethod === "credit" ? "Đơn công nợ đại lý" : "Đơn qua sàn"}: khi giao xong hệ thống ghi khoản phải thu; thu tiền ở mục Công nợ.
              </p>
            ) : order.paymentStatus === "refunded" ? (
              <p className="mt-3 text-sm text-ink-soft">Đơn đã hoàn tiền: trạng thái thanh toán khóa, xem phiếu chi ở mục Sổ quỹ.</p>
            ) : (
              canWrite && (
                <ActionForm action={paymentAction} submitLabel="Cập nhật" className="mt-4 flex flex-wrap items-center gap-2" submitClassName="btn btn-outline min-h-11 py-1.5" inline>
                  <input type="hidden" name="orderId" value={order.id} />
                  <select name="paymentStatus" defaultValue={order.paymentStatus} className="field min-h-11 w-auto py-1.5 text-sm" aria-label="Trạng thái thanh toán">
                    <option value="unpaid">Chưa thanh toán</option>
                    <option value="paid">Đã thanh toán</option>
                    {order.paymentStatus === "paid" && <option value="refunded">Đã hoàn tiền</option>}
                  </select>
                  <input name="reason" placeholder="Lý do (bắt buộc khi về chưa thanh toán)" className="field min-h-11 min-w-0 flex-1 py-1.5 text-sm" />
                </ActionForm>
              )
            )}
            {order.paymentMethod === "platform" && can(staff.role, "sales.write") && (
              <details className="mt-4 border-t border-line pt-3">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm">Sửa phí nền tảng…</summary>
                <ActionForm action={platformFeeAction} submitLabel="Lưu phí" className="mt-2 space-y-3">
                  <input type="hidden" name="orderId" value={order.id} />
                  <label className="block">
                    <span className="field-label">Phí nền tảng (đ)</span>
                    <input name="platformFee" inputMode="numeric" defaultValue={order.platformFee} className="field" />
                  </label>
                  <label className="block">
                    <span className="field-label">Lý do</span>
                    <input name="reason" required placeholder="Theo bảng đối soát của sàn…" className="field" />
                  </label>
                </ActionForm>
              </details>
            )}
          </Card>

          {returns.length > 0 && (
            <Card title="Đổi trả">
              <ul className="divide-y divide-line text-sm">
                {returns.map((r) => (
                  <li key={r.id}>
                    <Link href={`/admin/ban-hang/doi-tra/${r.id}`} className="flex min-h-11 items-center justify-between gap-3">
                      <span className="font-mono">{r.code}</span>
                      <Badge tone={r.status === "completed" ? "green" : r.status === "rejected" || r.status === "cancelled" ? "neutral" : "amber"}>{RETURN_STATUS_LABEL[r.status as ReturnStatus]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

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
