"use client";

import { useActionState } from "react";
import { joinWaitlist, type WaitlistState } from "./actions";

const CONCERNS = [
  { value: "oily", label: "Da đầu nhanh bết" },
  { value: "itchy", label: "Ngứa da đầu" },
  { value: "odor", label: "Có mùi sau khi đội mũ bảo hiểm" },
  { value: "dandruff", label: "Gàu" },
  { value: "hair_fall", label: "Tóc rụng nhiều" },
  { value: "other", label: "Khác" },
];

export function WaitlistForm({
  consentText,
  siteUrl,
  interest,
  submitLabel = "Giữ chỗ khi mở bán",
  dark = false,
}: {
  consentText: string;
  siteUrl: string;
  interest?: string;
  submitLabel?: string;
  dark?: boolean;
}) {
  const [state, action, pending] = useActionState<WaitlistState, FormData>(joinWaitlist, { status: "idle" });
  const fieldClass = dark ? "field border-bone/25 bg-transparent text-bone placeholder:text-bone/40" : "field";

  if (state.status === "ok") {
    const shareUrl = `${siteUrl.replace(/\/$/, "")}/?ref=${state.referralCode}`;
    return (
      <div className={dark ? "border border-bone/25 p-6" : "border border-line bg-paper p-6"} role="status">
        <p className="accent-serif text-2xl">Cảm ơn bạn.</p>
        <p className="mt-2 text-sm opacity-80">Pomil sẽ nhắn bạn trước khi mở bán chung. Gửi đường dẫn này cho bạn bè để cả hai cùng nhận quà khi mở bán:</p>
        <p className={`mt-3 break-all p-3 font-mono text-sm ${dark ? "bg-bone/10" : "bg-pith"}`}>{shareUrl}</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {interest && <input type="hidden" name="interest" value={interest} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Tên của bạn</span>
          <input name="name" required maxLength={80} autoComplete="name" className={fieldClass} />
        </label>
        <label className="block">
          <span className="field-label">Số điện thoại hoặc Zalo</span>
          <input name="phone" required inputMode="tel" autoComplete="tel" className={fieldClass} />
        </label>
      </div>
      <label className="block">
        <span className="field-label">Da đầu bạn hay gặp vấn đề gì nhất?</span>
        <select name="scalpConcern" required className={fieldClass} defaultValue="oily">
          {CONCERNS.map((c) => (
            <option key={c.value} value={c.value} className="text-graphite">
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <label className="flex items-start gap-3 text-sm opacity-90">
        {/* Không tích sẵn (SYS-20) */}
        <input type="checkbox" name="marketingConsent" className="mt-1 h-4 w-4 accent-rind" />
        <span>{consentText}</span>
      </label>
      {state.status === "error" && (
        <p className={`text-sm ${dark ? "text-blush" : "text-danger"}`} role="alert">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className={`btn w-full ${dark ? "btn-light" : "btn-primary"}`}>
        {pending ? "Đang gửi…" : submitLabel}
      </button>
    </form>
  );
}
