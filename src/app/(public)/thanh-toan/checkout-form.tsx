"use client";

import Link from "next/link";
import { useFormAction } from "@/components/use-form-action";
import { checkoutAction, type CheckoutState } from "./actions";

type Props = {
  provinces: readonly string[];
  codEnabled: boolean;
  bankTransferEnabled: boolean;
  dataConsentText: string;
  marketingConsentText: string;
  totalLabel: string;
};

export function CheckoutForm(props: Props) {
  const [state, onSubmit, pending, ready] = useFormAction<CheckoutState>(checkoutAction, { status: "idle" });
  const err = (name: string) => (state.status === "error" ? state.fieldErrors?.[name] : undefined);
  const defaultPayment = props.codEnabled ? "cod" : "bank_transfer";

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-10" noValidate>
      <fieldset data-reveal style={{ ["--d" as string]: "0ms" }} className="space-y-4">
        <legend className="eyebrow mb-2">Người nhận</legend>
        <Field label="Họ và tên" name="recipientName" autoComplete="name" error={err("recipientName")} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Số điện thoại" name="phone" type="tel" inputMode="tel" autoComplete="tel" error={err("phone")} required />
          <Field label="Email (không bắt buộc)" name="email" type="email" autoComplete="email" error={err("email")} />
        </div>
      </fieldset>

      <fieldset data-reveal style={{ ["--d" as string]: "80ms" }} className="space-y-4">
        <legend className="eyebrow mb-2">Địa chỉ giao hàng</legend>
        <label className="block">
          <span className="field-label">Tỉnh / Thành phố</span>
          <select name="province" className="field" defaultValue="" aria-invalid={!!err("province")} required>
            <option value="" disabled>
              Chọn tỉnh/thành
            </option>
            {props.provinces.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          {err("province") && <span className="mt-1 block text-sm text-danger">{err("province")}</span>}
        </label>
        <Field label="Phường / Xã" name="ward" error={err("ward")} required />
        <Field label="Số nhà, tên đường" name="addressLine" autoComplete="street-address" error={err("addressLine")} required />
        <label className="block">
          <span className="field-label">Ghi chú cho Pomil (không bắt buộc)</span>
          <textarea name="customerNote" maxLength={500} rows={3} className="field" placeholder="Giờ nhận hàng, gọi trước khi giao…" />
        </label>
      </fieldset>

      <fieldset data-reveal style={{ ["--d" as string]: "160ms" }}>
        <legend className="eyebrow mb-4">Thanh toán</legend>
        <div className="space-y-3">
          {props.codEnabled && (
            <label className="flex cursor-pointer items-start gap-3 border border-line bg-paper p-4 has-[:checked]:border-graphite">
              <input type="radio" name="paymentMethod" value="cod" defaultChecked={defaultPayment === "cod"} className="mt-1 accent-graphite" />
              <span>
                <span className="block font-medium">Thanh toán khi nhận hàng (COD)</span>
                <span className="text-sm text-ink-soft">Trả tiền mặt cho người giao.</span>
              </span>
            </label>
          )}
          {props.bankTransferEnabled && (
            <label className="flex cursor-pointer items-start gap-3 border border-line bg-paper p-4 has-[:checked]:border-graphite">
              <input type="radio" name="paymentMethod" value="bank_transfer" defaultChecked={defaultPayment === "bank_transfer"} className="mt-1 accent-graphite" />
              <span>
                <span className="block font-medium">Chuyển khoản ngân hàng</span>
                <span className="text-sm text-ink-soft">Quét mã QR ở bước sau, nội dung là mã đơn.</span>
              </span>
            </label>
          )}
        </div>
        {err("paymentMethod") && <p className="mt-2 text-sm text-danger">{err("paymentMethod")}</p>}
      </fieldset>

      <fieldset data-reveal style={{ ["--d" as string]: "240ms" }} className="space-y-3 text-sm">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="dataConsent" className="mt-0.5 h-5 w-5 shrink-0 accent-graphite" aria-invalid={!!err("dataConsent")} />
          <span>
            {props.dataConsentText}{" "}
            <Link href="/chinh-sach-bao-mat" target="_blank" className="underline underline-offset-4">
              Xem chính sách
            </Link>
          </span>
        </label>
        {err("dataConsent") && <p className="pl-7 text-danger">{err("dataConsent")}</p>}
        <label className="flex items-start gap-3 text-ink-soft">
          {/* Không tích sẵn (SYS-20) */}
          <input type="checkbox" name="marketingConsent" className="mt-0.5 h-5 w-5 shrink-0 accent-graphite" />
          <span>{props.marketingConsentText}</span>
        </label>
      </fieldset>

      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      {state.status === "error" && (
        <p className="border border-danger/40 bg-danger/5 p-3 text-sm text-danger" role="alert">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending || !ready} className="btn btn-primary w-full">
        {pending ? "Đang đặt đơn…" : <>Đặt hàng · <span className="price">{props.totalLabel}</span></>}
      </button>
    </form>
  );
}

function Field({ label, error, ...rest }: { label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input className="field" aria-invalid={!!error} {...rest} />
      {error && <span className="mt-1 block text-sm text-danger">{error}</span>}
    </label>
  );
}
