"use client";

import Link from "next/link";
import { useFormAction } from "@/components/use-form-action";
import {
  changePasswordAction,
  customerLoginAction,
  registerAction,
  updateProfileAction,
  type AccountFormState,
} from "./actions";

const idle: AccountFormState = { status: "idle" };

function Message({ state }: { state: AccountFormState }) {
  if (state.status === "error")
    return (
      <p className="border border-danger/40 bg-danger/5 p-3 text-sm text-danger" role="alert">
        {state.message}
      </p>
    );
  if (state.status === "ok")
    return (
      <p className="text-sm text-graphite" role="status">
        {state.message}
      </p>
    );
  return null;
}

export function CustomerLoginForm({ next }: { next?: string }) {
  const [state, onSubmit, pending, ready] = useFormAction<AccountFormState>(customerLoginAction, idle);
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="block">
        <span className="field-label">Số điện thoại</span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required className="field" />
      </label>
      <label className="block">
        <span className="field-label">Mật khẩu</span>
        <input name="password" type="password" autoComplete="current-password" required className="field" />
      </label>
      <Message state={state} />
      <button disabled={pending || !ready} className="btn btn-primary w-full">
        {pending ? "Đang kiểm tra…" : "Đăng nhập"}
      </button>
    </form>
  );
}

export function RegisterForm({ next, consentText }: { next?: string; consentText: string }) {
  const [state, onSubmit, pending, ready] = useFormAction<AccountFormState>(registerAction, idle);
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="block">
        <span className="field-label">Tên của bạn</span>
        <input name="name" autoComplete="name" required maxLength={80} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Số điện thoại</span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required className="field" />
        <span className="mt-1 block text-xs text-ink-soft">Dùng để đăng nhập. Pomil không gửi tin quảng cáo nếu bạn chưa đồng ý.</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Mật khẩu (từ 8 ký tự)</span>
          <input name="password" type="password" autoComplete="new-password" minLength={8} required className="field" />
        </label>
        <label className="block">
          <span className="field-label">Nhập lại mật khẩu</span>
          <input name="confirm" type="password" autoComplete="new-password" minLength={8} required className="field" />
        </label>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="dataConsent" className="mt-0.5 h-5 w-5 shrink-0 accent-graphite" />
        <span>
          {consentText}{" "}
          <Link href="/chinh-sach-bao-mat" target="_blank" className="underline underline-offset-4">
            Xem chính sách
          </Link>
        </span>
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <Message state={state} />
      <button disabled={pending || !ready} className="btn btn-primary w-full">
        {pending ? "Đang tạo tài khoản…" : "Tạo tài khoản"}
      </button>
    </form>
  );
}

export function ProfileForm({ name }: { name: string }) {
  const [state, onSubmit, pending, ready] = useFormAction<AccountFormState>(updateProfileAction, idle);
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="field-label">Tên hiển thị</span>
        <input name="name" defaultValue={name} autoComplete="name" required maxLength={80} className="field" />
      </label>
      <Message state={state} />
      <button disabled={pending || !ready} className="btn btn-outline">
        {pending ? "Đang lưu…" : "Lưu tên"}
      </button>
    </form>
  );
}

export function PasswordForm() {
  const [state, onSubmit, pending, ready] = useFormAction<AccountFormState>(changePasswordAction, idle);
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="field-label">Mật khẩu hiện tại</span>
        <input name="current" type="password" autoComplete="current-password" required className="field" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Mật khẩu mới</span>
          <input name="password" type="password" autoComplete="new-password" minLength={8} required className="field" />
        </label>
        <label className="block">
          <span className="field-label">Nhập lại</span>
          <input name="confirm" type="password" autoComplete="new-password" minLength={8} required className="field" />
        </label>
      </div>
      <Message state={state} />
      <button disabled={pending || !ready} className="btn btn-outline">
        {pending ? "Đang đổi…" : "Đổi mật khẩu"}
      </button>
    </form>
  );
}
