import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDateTime, formatVnd } from "@/lib/format";
import { requireStaff } from "@/modules/auth/service";
import { getOrderDetail } from "@/modules/orders/service";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/modules/sales/rules";
import { getSettings } from "@/modules/settings/service";
import { customerSafe, PrintButton, PrintStyle } from "../../print";

export const metadata: Metadata = { title: "Phiếu đóng gói" };

// Phiếu đóng gói A5 bỏ vào thùng (R-BH-13, AC-BH-34): hàng, số lô, lời cảm ơn qua checkClaims
export default async function PackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [, detail, store] = await Promise.all([requireStaff(), getOrderDetail(id), getSettings()]);
  if (!detail) notFound();
  const { order, items } = detail;
  const tagline = customerSafe(store.tagline);
  const thanks = customerSafe("Cảm ơn bạn đã chọn Pomil. Có gì cần hỏi, nhắn cho chúng mình qua Zalo nhé.");
  const note = customerSafe(order.customerNote);
  const collect = order.paymentMethod === "cod" && order.paymentStatus === "unpaid" ? order.total : 0;

  return (
    <>
      <PrintStyle size="A5" />
      <PrintButton />
      <section className="print-area mx-auto max-w-[148mm] border border-line bg-white p-6 text-sm text-graphite">
        <header className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <div>
            <p className="text-xl tracking-[0.2em]">{store.storeName.toUpperCase()}</p>
            {tagline && <p className="mt-1 text-xs italic text-ink-soft">{tagline}</p>}
          </div>
          <div className="text-right">
            <p className="font-mono text-base">{order.code}</p>
            <p className="text-xs text-ink-soft">{formatDateTime(order.createdAt)}</p>
          </div>
        </header>
        <p className="mt-3">
          Gửi: <span className="font-medium">{order.recipientName}</span>
        </p>
        <table className="mt-3 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-xs text-ink-soft">
              <th className="py-1 font-normal">Sản phẩm</th>
              <th className="py-1 font-normal">Số lô</th>
              <th className="py-1 text-right font-normal">SL</th>
              <th className="py-1 text-right font-normal">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-line">
                <td className="py-1.5">{customerSafe(it.productName) ?? "Sản phẩm Pomil"}</td>
                <td className="py-1.5 font-mono text-xs">{it.lotNo ?? "—"}</td>
                <td className="py-1.5 text-right">{it.quantity}</td>
                <td className="py-1.5 text-right tabular-nums">{formatVnd(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-3 space-y-0.5">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Tạm tính</dt>
            <dd>{formatVnd(order.subtotal)}</dd>
          </div>
          {order.discountTotal > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-soft">Giảm giá</dt>
              <dd>−{formatVnd(order.discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-soft">Phí giao</dt>
            <dd>{formatVnd(order.shippingFee)}</dd>
          </div>
          <div className="flex justify-between text-base">
            <dt>Tổng</dt>
            <dd>{formatVnd(order.total)}</dd>
          </div>
          <div className="flex justify-between text-xs text-ink-soft">
            <dt>Thanh toán</dt>
            <dd>{PAYMENT_METHOD_LABEL[order.paymentMethod as PaymentMethod] ?? order.paymentMethod}</dd>
          </div>
        </dl>
        {collect > 0 && <p className="mt-2 border border-graphite p-2 text-center">Thu hộ khi giao: {formatVnd(collect)}</p>}
        {note && <p className="mt-3 bg-pith p-2 text-xs">Bạn ghi: {note}</p>}
        {thanks && <p className="mt-4 text-center italic">{thanks}</p>}
        {(store.hotline || store.zalo) && (
          <p className="mt-1 text-center text-xs text-ink-soft">
            {[store.hotline && `Hotline ${store.hotline}`, store.zalo && `Zalo ${store.zalo}`].filter(Boolean).join(" · ")}
          </p>
        )}
      </section>
    </>
  );
}
