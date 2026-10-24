import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { displayPhone, formatDateTime, formatVnd } from "@/lib/format";
import { vietQrImageUrl } from "@/lib/vietqr";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/modules/orders/rules";
import { getOrderForCustomer } from "@/modules/orders/service";
import { getSettings } from "@/modules/settings/service";

export const metadata: Metadata = { title: "Đơn hàng", robots: { index: false } };

const STEPS: OrderStatus[] = ["pending", "confirmed", "packing", "shipping", "delivered"];

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ t?: string; moi?: string }> };

export default async function OrderPage({ params, searchParams }: Props) {
  const [{ code }, { t, moi }] = await Promise.all([params, searchParams]);
  if (!t) notFound();
  const [data, settings] = await Promise.all([getOrderForCustomer(decodeURIComponent(code), t), getSettings()]);
  if (!data) notFound();
  const { order, items } = data;

  const stepIndex = STEPS.indexOf(order.status);
  const ended = order.status === "cancelled" || order.status === "returned";
  const needsTransfer = order.paymentMethod === "bank_transfer" && order.paymentStatus === "unpaid" && !ended;
  const qr = needsTransfer
    ? vietQrImageUrl({ bankBin: settings.bankBin, accountNo: settings.bankAccountNo, accountName: settings.bankAccountName }, order.total, order.code)
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      {moi && (
        <div className="mb-10 text-center">
          <p className="accent-serif text-4xl">Cảm ơn bạn.</p>
          <p className="mt-3 text-ink-soft">Pomil đã nhận đơn và sẽ gọi hoặc nhắn Zalo xác nhận trong giờ làm việc. Lưu lại trang này để xem tình trạng đơn.</p>
        </div>
      )}

      <div className="border border-line bg-paper p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-ink-soft">Mã đơn</p>
            <p className="mt-1 font-mono text-2xl tracking-wider">{order.code}</p>
            <p className="mt-1 text-sm text-ink-soft">Đặt lúc {formatDateTime(order.createdAt)}</p>
          </div>
          <span className={`eyebrow px-3 py-1.5 text-[0.68rem] ${ended ? "bg-danger/10 text-danger" : "bg-graphite text-bone"}`}>{ORDER_STATUS_LABEL[order.status]}</span>
        </div>

        {!ended && (
          <ol className="mt-8 grid grid-cols-5 gap-1" aria-label="Tiến trình đơn">
            {STEPS.map((s, i) => (
              <li key={s} className="text-center">
                <div className={`h-1 ${i <= stepIndex ? "bg-rind" : "bg-line"}`} />
                <p className={`mt-2 text-[0.7rem] leading-tight ${i <= stepIndex ? "text-graphite" : "text-ink-soft/70"}`}>{ORDER_STATUS_LABEL[s]}</p>
              </li>
            ))}
          </ol>
        )}
        {order.trackingNo && (
          <p className="mt-6 text-sm">
            Mã vận đơn: <span className="font-mono">{order.trackingNo}</span> {order.carrier && `(${order.carrier})`}
          </p>
        )}
      </div>

      {needsTransfer && (
        <div className="mt-6 grid gap-6 border border-graphite p-6 sm:grid-cols-[12rem_1fr] sm:p-8">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={`Mã QR chuyển khoản ${formatVnd(order.total)} cho đơn ${order.code}`} className="w-48 bg-white" />
          ) : (
            <div className="flex aspect-square w-48 items-center justify-center bg-pith p-4 text-center text-xs text-ink-soft">Cửa hàng chưa nhập tài khoản nhận tiền</div>
          )}
          <div>
            <p className="eyebrow">Chuyển khoản</p>
            <dl className="mt-4 space-y-2 text-sm">
              {settings.bankName && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">Ngân hàng</dt>
                  <dd>{settings.bankName}</dd>
                </div>
              )}
              {settings.bankAccountNo && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">Số tài khoản</dt>
                  <dd className="font-mono">{settings.bankAccountNo}</dd>
                </div>
              )}
              {settings.bankAccountName && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">Chủ tài khoản</dt>
                  <dd>{settings.bankAccountName}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Số tiền</dt>
                <dd className="font-medium">{formatVnd(order.total)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Nội dung</dt>
                <dd className="font-mono">{order.code}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-ink-soft">Pomil xác nhận khi tiền về tài khoản, thường trong giờ làm việc.</p>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section className="border border-line p-6">
          <h2 className="eyebrow">Sản phẩm</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span>
                  {item.productName} × {item.quantity}
                </span>
                <span>{formatVnd(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Phí giao</dt>
              <dd>{order.shippingFee === 0 ? "Miễn phí" : formatVnd(order.shippingFee)}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>Tổng</dt>
              <dd>{formatVnd(order.total)}</dd>
            </div>
            <div className="flex justify-between text-ink-soft">
              <dt>Thanh toán</dt>
              <dd>
                {order.paymentMethod === "cod" ? "Khi nhận hàng" : "Chuyển khoản"} · {order.paymentStatus === "paid" ? "đã thanh toán" : order.paymentStatus === "refunded" ? "đã hoàn tiền" : "chưa thanh toán"}
              </dd>
            </div>
          </dl>
        </section>
        <section className="border border-line p-6 text-sm">
          <h2 className="eyebrow">Giao tới</h2>
          <p className="mt-4 font-medium">{order.recipientName}</p>
          <p className="text-ink-soft">{displayPhone(order.phoneE164)}</p>
          <p className="mt-2 text-ink-soft">
            {order.addressLine}, {order.ward}, {order.province}
          </p>
          {order.customerNote && <p className="mt-2 italic text-ink-soft">“{order.customerNote}”</p>}
        </section>
      </div>

      <p className="mt-10 text-center text-sm text-ink-soft">
        Cần đổi địa chỉ hoặc hủy đơn? {settings.zalo ? `Nhắn Zalo ${settings.zalo}` : settings.hotline ? `Gọi ${settings.hotline}` : "Liên hệ Pomil"} kèm mã đơn.{" "}
        <Link href="/san-pham" className="underline underline-offset-4">
          Tiếp tục mua
        </Link>
      </p>
    </div>
  );
}
