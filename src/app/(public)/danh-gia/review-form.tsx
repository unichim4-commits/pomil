"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { SCALP_FEEL, USED_FOR, WOULD_REBUY } from "@/modules/reviews/rules";
import { reviewAction, type ReviewFormState } from "./actions";

type Existing = {
  rating: number;
  scentRating: number | null;
  scalpFeel: string | null;
  wouldRebuy: string | null;
  usedFor: string | null;
  comment: string;
  suggestion: string;
  publishConsent: boolean;
} | null;

export function ReviewForm({ productId, productSlug, existing }: { productId: string; productSlug: string; existing: Existing }) {
  const [state, onSubmit, pending, ready] = useFormAction<ReviewFormState>(reviewAction, { status: "idle" });
  const [rating, setRating] = useState(existing?.rating ?? 0);

  if (state.status === "ok") {
    return (
      <div className="border border-graphite bg-paper p-6" role="status">
        <p className="accent-serif text-3xl">Cảm ơn bạn.</p>
        <p className="mt-2 text-ink-soft">
          {state.updated ? "Đã cập nhật đánh giá." : "Pomil đã nhận đánh giá."} Mọi góp ý đều được đọc và ghi vào sổ để chỉnh công thức, mùi và bao bì ở lô sau.
          {" "}Nếu bạn cho phép, nhận xét sẽ hiện trên trang này sau khi Pomil đọc xong.
        </p>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-6 border border-line bg-paper p-6" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="productSlug" value={productSlug} />

      <fieldset>
        <legend className="field-label">Bạn chấm bao nhiêu sao?</legend>
        <div className="mt-1 flex gap-1" role="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="peer sr-only" />
              <span
                className={`flex h-11 w-11 items-center justify-center text-2xl peer-focus-visible:outline peer-focus-visible:outline-2 ${n <= rating ? "text-graphite" : "text-line"}`}
                aria-hidden="true"
              >
                ★
              </span>
              <span className="sr-only">{n} sao</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select name="scalpFeel" label="Da đầu sau khi dùng" options={SCALP_FEEL} defaultValue={existing?.scalpFeel} />
        <Select name="usedFor" label="Bạn đã dùng bao lâu" options={USED_FOR} defaultValue={existing?.usedFor} />
        <Select name="scentRating" label="Mùi vỏ bưởi" options={{ "5": "Rất thích", "4": "Thích", "3": "Bình thường", "2": "Hơi gắt", "1": "Không hợp" }} defaultValue={existing?.scentRating?.toString()} />
        <Select name="wouldRebuy" label="Bạn có mua lại không" options={WOULD_REBUY} defaultValue={existing?.wouldRebuy} />
      </div>

      <label className="block">
        <span className="field-label">Nhận xét của bạn</span>
        <textarea name="comment" rows={4} maxLength={1500} defaultValue={existing?.comment} className="field" placeholder="Cảm giác khi xịt, độ khô nhanh, mùi, đầu xịt có dễ dùng không…" />
      </label>

      <label className="block">
        <span className="field-label">Pomil nên sửa gì? (chỉ nội bộ đọc)</span>
        <textarea name="suggestion" rows={3} maxLength={1500} defaultValue={existing?.suggestion} className="field" placeholder="Mùi nhẹ hơn, chai to hơn, đầu xịt tia rộng hơn…" />
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="publishConsent" defaultChecked={existing?.publishConsent ?? false} className="mt-0.5 h-5 w-5 shrink-0 accent-graphite" />
        <span>Cho phép hiện nhận xét này trên website, kèm tên dạng rút gọn (ví dụ “Lan N.”). Phần góp ý không bao giờ hiện công khai.</span>
      </label>

      <p className="text-xs text-ink-soft">
        Bị ngứa, đỏ hay rát sau khi dùng? Ngưng dùng và{" "}
        <a href="/phan-anh" className="underline underline-offset-4">
          gửi phản ánh kèm số lô
        </a>{" "}
        để Pomil hỗ trợ trong 24 giờ.
      </p>

      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {state.status === "error" && (
        <p className="border border-danger/40 bg-danger/5 p-3 text-sm text-danger" role="alert">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending || !ready || rating === 0} className="btn btn-primary w-full sm:w-auto">
        {pending ? "Đang gửi…" : existing ? "Cập nhật đánh giá" : "Gửi đánh giá"}
      </button>
    </form>
  );
}

function Select({ name, label, options, defaultValue }: { name: string; label: string; options: Record<string, string>; defaultValue?: string | null }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} className="field">
        <option value="">Chọn</option>
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
