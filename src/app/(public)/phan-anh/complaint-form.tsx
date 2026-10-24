"use client";

import { useFormAction } from "@/components/use-form-action";
import {
  COMPLAINT_LOT_HINT,
  COMPLAINT_PHONE_HINT,
  COMPLAINT_PHONE_LABEL,
  COMPLAINT_SAMPLE_LABEL,
  COMPLAINT_THANKS_TITLE,
  complaintThanksBody,
  LOT_FORMAT_HINT,
} from "@/modules/quality/copy";
import { sendComplaint, type ComplaintState } from "./actions";

export function ComplaintForm({ lotNo, zalo, hotline }: { lotNo: string | null; zalo?: string; hotline?: string }) {
  const [state, onSubmit, pending, ready] = useFormAction<ComplaintState>(sendComplaint, { status: "idle" });

  if (state.status === "ok") {
    return (
      <div className="border border-line bg-paper p-6" role="status">
        <p className="accent-serif text-2xl">{COMPLAINT_THANKS_TITLE}</p>
        <p className="mt-3 text-sm text-ink-soft">
          {complaintThanksBody(state.hasContact, { zalo, hotline }).map((part, i) =>
            part.href ? (
              <a
                key={i}
                href={part.href}
                {...(part.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="inline-flex min-h-11 items-center underline underline-offset-2"
              >
                {part.text}
              </a>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Số lô in trên chai</span>
          <input name="lotNo" defaultValue={lotNo ?? ""} placeholder={LOT_FORMAT_HINT} autoCapitalize="characters" spellCheck={false} aria-describedby="lot-hint" className="field font-mono uppercase" />
          <span id="lot-hint" className="mt-1 block text-sm text-ink-soft">
            {COMPLAINT_LOT_HINT}
          </span>
        </label>
        <label className="block">
          <span className="field-label">{COMPLAINT_SAMPLE_LABEL}</span>
          <input name="sampleCode" maxLength={10} className="field" />
        </label>
      </div>
      <label className="block">
        <span className="field-label">Ngày bắt đầu dùng</span>
        <input type="date" name="startedUsingOn" className="field" />
      </label>
      <label className="block">
        <span className="field-label">Bạn thấy gì?</span>
        <textarea name="symptoms" required minLength={5} rows={4} className="field" placeholder="Vị trí, cảm giác, xuất hiện sau bao lâu…" />
      </label>
      <fieldset>
        <legend className="field-label">Mức độ</legend>
        <div className="flex gap-3">
          {[
            ["mild", "Nhẹ"],
            ["moderate", "Vừa"],
            ["severe", "Nặng"],
          ].map(([value, label]) => (
            <label key={value} className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 border border-line bg-paper py-3 text-sm has-[:checked]:border-graphite has-[:checked]:bg-graphite has-[:checked]:text-bone">
              <input type="radio" name="severity" value={value} aria-label={label} defaultChecked={value === "mild"} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="field-label">{COMPLAINT_PHONE_LABEL}</span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" aria-describedby="phone-hint" className="field" />
        <span id="phone-hint" className="mt-1 block text-sm text-ink-soft">
          {COMPLAINT_PHONE_HINT}
        </span>
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {state.status === "error" && (
        <p className="text-sm text-danger" role="alert">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending || !ready} className="btn btn-primary w-full">
        {pending ? "Đang gửi…" : "Gửi phản ánh"}
      </button>
    </form>
  );
}
