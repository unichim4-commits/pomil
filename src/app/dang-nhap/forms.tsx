"use client";

import { useEffect, useRef, useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { randomToken } from "@/lib/random-token";
import { loginAction, mfaAction, setupOwnerAction, type AuthState } from "./actions";

const idle: AuthState = { status: "idle" };

function ErrorLine({ state }: { state: AuthState }) {
  return state.status === "error" ? (
    <p className="text-sm text-danger" role="alert">
      {state.message}
    </p>
  ) : null;
}

export function LoginForm() {
  const [state, onSubmit, pending, ready] = useFormAction<AuthState>(loginAction, idle);
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="field-label">Email</span>
        <input name="email" type="email" autoComplete="username" required className="field" />
      </label>
      <label className="block">
        <span className="field-label">Mật khẩu</span>
        <input name="password" type="password" autoComplete="current-password" required className="field" />
      </label>
      <ErrorLine state={state} />
      <button disabled={pending || !ready} className="btn btn-primary w-full">
        {pending ? "Đang kiểm tra…" : "Đăng nhập"}
      </button>
    </form>
  );
}

export function MfaForm() {
  const [state, onSubmit, pending, ready] = useFormAction<AuthState>(mfaAction, idle);
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="field-label">Mã 6 số trong ứng dụng xác thực</span>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus className="field text-center font-mono text-2xl tracking-[0.4em]" />
      </label>
      <ErrorLine state={state} />
      <button disabled={pending || !ready} className="btn btn-primary w-full">
        {pending ? "Đang kiểm tra…" : "Xác nhận"}
      </button>
    </form>
  );
}

export function SetupForm({ needsToken }: { needsToken: boolean }) {
  const [state, onSubmit, pending, ready] = useFormAction<AuthState>(setupOwnerAction, idle);
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      {needsToken && (
        <label className="block">
          <span className="field-label">Mã khởi tạo</span>
          <input name="setupToken" type="password" required autoComplete="off" spellCheck={false} className="field font-mono" />
          <span className="mt-1 block text-sm text-ink-soft">
            Dán chuỗi bạn đã lưu cho SETUP_TOKEN trên Vercel. Tạo xong chủ cửa hàng thì quay lại Vercel → Settings → Environment Variables, xóa biến SETUP_TOKEN, rồi Redeploy một lần nữa (Deployments → ⋯ ở dòng trên cùng → Redeploy).
          </span>
        </label>
      )}
      <label className="block">
        <span className="field-label">Tên của bạn</span>
        <input name="name" required autoComplete="name" className="field" />
      </label>
      <label className="block">
        <span className="field-label">Email đăng nhập</span>
        <input name="email" type="email" required autoComplete="username" className="field" />
      </label>
      <label className="block">
        <span className="field-label">Mật khẩu (ít nhất 10 ký tự)</span>
        <input name="password" type="password" required minLength={10} autoComplete="new-password" className="field" />
      </label>
      <label className="block">
        <span className="field-label">Nhập lại mật khẩu</span>
        <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className="field" />
      </label>
      <ErrorLine state={state} />
      <button disabled={pending || !ready} className="btn btn-primary w-full">
        {pending ? "Đang tạo…" : "Tạo tài khoản chủ cửa hàng"}
      </button>
    </form>
  );
}

// Tạo mã khởi tạo ngay trên trình duyệt (crypto.getRandomValues). Không nằm trong form nào và không
// gửi lên máy chủ: máy chủ chỉ so với SETUP_TOKEN đã đặt trên Vercel.
export function SetupTokenGenerator() {
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState<"" | "ok" | "manual">("");
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setReady(true), []);

  const generate = () => {
    setToken(randomToken());
    setCopied("");
  };
  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied("ok");
    } catch {
      // Trình duyệt trong app hoặc trang không https: chọn sẵn chữ để người dùng tự chép.
      ref.current?.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {}
      setCopied(ok ? "ok" : "manual");
    }
  };

  return (
    <div className="mt-4 space-y-2">
      <label htmlFor="setup-token-generated" className="field-label">
        Chuỗi mã khởi tạo
      </label>
      <textarea
        id="setup-token-generated"
        ref={ref}
        readOnly
        rows={2}
        value={token}
        placeholder="Bấm “Tạo chuỗi ngẫu nhiên”"
        autoComplete="off"
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        className="field min-h-0 resize-none break-all font-mono"
      />
      <div className="flex gap-2">
        <button type="button" onClick={generate} disabled={!ready} className="btn btn-outline flex-1 px-3 text-sm">
          Tạo chuỗi ngẫu nhiên
        </button>
        <button type="button" onClick={copy} disabled={!ready || !token} className="btn btn-primary px-5 text-sm">
          Chép
        </button>
      </div>
      <p aria-live="polite" className="text-sm text-ink-soft">
        {copied === "ok" && "Đã chép. Dán vào ô Value trên Vercel."}
        {copied === "manual" && "Máy chưa cho chép tự động. Chuỗi đã được chọn sẵn, bạn giữ ngón tay lên chuỗi rồi chọn Sao chép."}
        {copied === "" && token && "Chuỗi chỉ nằm trên máy bạn, chưa gửi đi đâu."}
      </p>
    </div>
  );
}
