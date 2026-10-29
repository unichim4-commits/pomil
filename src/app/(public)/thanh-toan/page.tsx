import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { formatVnd } from "@/lib/format";
import { VN_PROVINCES } from "@/lib/provinces";
import Link from "next/link";
import { displayPhone } from "@/lib/format";
import { currentCustomer, lastShippingAddress } from "@/modules/accounts/service";
import { loadCartView } from "@/modules/cart/view";
import { CHECKOUT_DATA_CONSENT_TEXT, CHECKOUT_MARKETING_CONSENT_TEXT } from "@/modules/consent/texts";
import { getSettings } from "@/modules/settings/service";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Thanh toán", robots: { index: false } };

export default async function CheckoutPage() {
  const settings = await getSettings();
  const cart = await loadCartView(settings);
  if (cart.rows.length === 0 || cart.problems.length > 0 || !settings.salesOpen) redirect("/gio-hang");
  const me = await currentCustomer();
  const last = me ? await lastShippingAddress(me.accountId) : null;
  // Điền sẵn từ đơn gần nhất của tài khoản; lần đầu thì lấy tên và số đã đăng ký
  const prefill = me
    ? {
        recipientName: last?.recipientName ?? me.name,
        phone: displayPhone(last?.phoneE164 ?? me.phoneE164),
        email: last?.email ?? "",
        province: last?.province ?? "",
        ward: last?.ward ?? "",
        addressLine: last?.addressLine ?? "",
      }
    : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <h1 className="display enter text-5xl">Thanh toán</h1>
      {me ? (
        <p className="mt-3 text-sm text-ink-soft">Đơn sẽ lưu vào tài khoản của {me.name || "bạn"}. Thông tin dưới đây lấy từ lần mua trước, bạn sửa nếu cần.</p>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">
          Mua không cần tài khoản.{" "}
          <Link href="/tai-khoan/dang-nhap?tiep=%2Fthanh-toan" className="underline underline-offset-4">
            Đăng nhập
          </Link>{" "}
          để điền sẵn địa chỉ và xem lại đơn sau này.
        </p>
      )}
      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_22rem]">
        <CheckoutForm
          provinces={VN_PROVINCES}
          codEnabled={settings.codEnabled}
          bankTransferEnabled={settings.bankTransferEnabled}
          dataConsentText={CHECKOUT_DATA_CONSENT_TEXT}
          marketingConsentText={CHECKOUT_MARKETING_CONSENT_TEXT}
          totalLabel={formatVnd(cart.total)}
          prefill={prefill}
        />
        <aside className="enter h-fit border border-line bg-paper p-6 lg:sticky lg:top-24" style={{ ["--d" as string]: "250ms" }}>
          <h2 className="eyebrow">Đơn của bạn</h2>
          <ul className="mt-5 space-y-3 text-sm">
            {cart.rows.map((r) => (
              <li key={r.product.id} className="flex justify-between gap-3">
                <span>
                  {r.product.name} <span className="text-ink-soft">× {r.quantity}</span>
                </span>
                <span>{formatVnd(r.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Tạm tính</dt>
              <dd>{formatVnd(cart.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Phí giao</dt>
              <dd>{cart.shippingFee === 0 ? "Miễn phí" : formatVnd(cart.shippingFee)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-medium">
              <dt>Tổng</dt>
              <dd>{formatVnd(cart.total)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-ink-soft">{settings.shippingNote}</p>
        </aside>
      </div>
    </div>
  );
}
