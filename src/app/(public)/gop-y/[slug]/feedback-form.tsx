"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  AGE_RANGE,
  ASPECTS,
  CHANNEL,
  COMPARED_BEFORE,
  CONCERNS,
  HABITS,
  SCALP_FEEL,
  SCALP_TYPE,
  SCENT_INTENSITY,
  USAGE_FREQUENCY,
  USED_FOR,
  WOULD_REBUY,
} from "@/modules/reviews/rules";
import { feedbackAction, type FeedbackState } from "./actions";

export type FeedbackExisting = {
  rating: number;
  scentRating: number | null;
  scalpFeel: string | null;
  wouldRebuy: string | null;
  usedFor: string | null;
  comment: string;
  suggestion: string;
  publishConsent: boolean;
  reportedLotNo: string | null;
  channel: string | null;
  ageRange: string | null;
  scalpType: string | null;
  concerns: string[];
  habits: string[];
  usageFrequency: string | null;
  comparedBefore: string | null;
  scentIntensity: string | null;
  aspectRatings: Record<string, number>;
  nps: number | null;
  followUpConsent: boolean;
} | null;

type Props = {
  product: { id: string; slug: string; name: string };
  loggedInName: string | null;
  lotNo: string | null;
  existing: FeedbackExisting;
};

export function FeedbackForm({ product, loggedInName, lotNo, existing }: Props) {
  const [state, onSubmit, pending, ready] = useFormAction<FeedbackState>(feedbackAction, { status: "idle" });
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [scalpFeel, setScalpFeel] = useState(existing?.scalpFeel ?? "");

  if (state.status === "ok") {
    return (
      <div className="border border-graphite bg-paper p-6" role="status">
        <p className="accent-serif text-3xl">Cảm ơn bạn.</p>
        <p className="mt-2 text-ink-soft">
          {state.updated ? "Đã cập nhật góp ý." : "Pomil đã nhận góp ý."} Mọi góp ý đều được đọc, gắn vào lô và ghi vào sổ để chỉnh công thức, mùi và bao bì ở lô sau.
        </p>
        {state.lotNote && <p className="mt-2 text-sm text-ink-soft">{state.lotNote}</p>}
        <Link href={`/san-pham/${product.slug}`} className="btn btn-outline mt-6">
          Về trang {product.name}
        </Link>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-10" noValidate>
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="productSlug" value={product.slug} />

      <Step n={1} title="Chai bạn đang dùng">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Số lô (in dưới đáy chai, không bắt buộc)</span>
            <input name="lotNo" defaultValue={lotNo ?? existing?.reportedLotNo ?? ""} placeholder="PST-271101-01" autoCapitalize="characters" className="field uppercase" />
          </label>
          <Select name="channel" label="Bạn mua ở đâu" options={CHANNEL} defaultValue={existing?.channel} />
          <Select name="usedFor" label="Đã dùng bao lâu" options={USED_FOR} defaultValue={existing?.usedFor} />
          <Select name="usageFrequency" label="Dùng mấy lần" options={USAGE_FREQUENCY} defaultValue={existing?.usageFrequency} />
        </div>
      </Step>

      <Step n={2} title="Da đầu của bạn" hint="Giúp Pomil biết sản phẩm hợp với ai, không hợp với ai.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select name="scalpType" label="Da đầu bạn thường" options={SCALP_TYPE} defaultValue={existing?.scalpType} />
          <Select name="ageRange" label="Độ tuổi" options={AGE_RANGE} defaultValue={existing?.ageRange} />
        </div>
        <Checks name="concerns" legend="Trước khi dùng, bạn hay gặp (chọn nhiều)" options={CONCERNS} defaults={existing?.concerns} />
        <Checks name="habits" legend="Thói quen của bạn (chọn nhiều)" options={HABITS} defaults={existing?.habits} />
      </Step>

      <Step n={3} title="Cảm nhận khi dùng">
        <fieldset>
          <legend className="field-label">Chấm chung bao nhiêu sao?</legend>
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
          <label className="block">
            <span className="field-label">Da đầu sau khi dùng</span>
            <select name="scalpFeel" value={scalpFeel} onChange={(e) => setScalpFeel(e.target.value)} className="field">
              <option value="">Chọn</option>
              {Object.entries(SCALP_FEEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <Select name="comparedBefore" label="So với trước khi dùng, da đầu" options={COMPARED_BEFORE} defaultValue={existing?.comparedBefore} />
          <Select name="scentRating" label="Mùi vỏ bưởi" options={{ "5": "Rất thích", "4": "Thích", "3": "Bình thường", "2": "Hơi gắt", "1": "Không hợp" }} defaultValue={existing?.scentRating?.toString()} />
          <Select name="scentIntensity" label="Độ đậm của mùi" options={SCENT_INTENSITY} defaultValue={existing?.scentIntensity} />
        </div>

        {scalpFeel === "ngua" && (
          <p className="border border-danger/40 bg-danger/5 p-3 text-sm" role="alert">
            Bạn thấy ngứa hoặc châm chích: ngưng dùng và{" "}
            <Link href="/phan-anh" className="underline underline-offset-4">
              gửi phản ánh kèm số lô
            </Link>{" "}
            để Pomil hỗ trợ trong 24 giờ. Bạn vẫn có thể gửi góp ý này.
          </p>
        )}

        <fieldset>
          <legend className="field-label">Chấm từng mặt (1 kém, 5 rất tốt; bỏ trống nếu chưa rõ)</legend>
          <div className="mt-2 divide-y divide-line border-y border-line">
            {Object.entries(ASPECTS).map(([k, label]) => (
              <div key={k} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-sm">{label}</span>
                <span className="flex gap-1" role="radiogroup" aria-label={label}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className="cursor-pointer">
                      <input type="radio" name={`aspect_${k}`} value={n} defaultChecked={existing?.aspectRatings?.[k] === n} className="peer sr-only" />
                      <span className="flex h-9 w-9 items-center justify-center border border-line text-sm peer-checked:border-graphite peer-checked:bg-graphite peer-checked:text-bone peer-focus-visible:outline peer-focus-visible:outline-2">
                        {n}
                      </span>
                    </label>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </fieldset>
      </Step>

      <Step n={4} title="Lời của bạn">
        <label className="block">
          <span className="field-label">Nhận xét (có thể hiện trên web nếu bạn cho phép)</span>
          <textarea name="comment" rows={4} maxLength={1500} defaultValue={existing?.comment} className="field" placeholder="Cảm giác khi xịt, độ khô nhanh, mùi, đầu xịt có dễ dùng không…" />
        </label>
        <label className="block">
          <span className="field-label">Pomil nên sửa gì? (chỉ nội bộ đọc)</span>
          <textarea name="suggestion" rows={3} maxLength={1500} defaultValue={existing?.suggestion} className="field" placeholder="Mùi nhẹ hơn, chai to hơn, đầu xịt tia rộng hơn…" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select name="wouldRebuy" label="Bạn có mua lại không" options={WOULD_REBUY} defaultValue={existing?.wouldRebuy} />
          <Select
            name="nps"
            label="Giới thiệu cho bạn bè? (0 không, 10 chắc chắn)"
            options={Object.fromEntries([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((n) => [String(n), String(n)]))}
            defaultValue={existing?.nps?.toString()}
          />
        </div>
      </Step>

      <Step n={5} title="Liên hệ">
        {loggedInName ? (
          <p className="text-sm text-ink-soft">Bạn đang đăng nhập là {loggedInName}. Góp ý gắn với tài khoản; gửi lại sẽ cập nhật bản cũ.</p>
        ) : (
          <label className="block">
            <span className="field-label">Tên hoặc tên gọi</span>
            <input name="guestName" maxLength={60} autoComplete="given-name" className="field" />
          </label>
        )}
        <label className="block">
          <span className="field-label">Số điện thoại (không bắt buộc, chỉ để Pomil hỏi thêm)</span>
          <input name="phone" type="tel" inputMode="tel" autoComplete="tel" className="field" />
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="followUpConsent" defaultChecked={existing?.followUpConsent ?? false} className="mt-0.5 h-5 w-5 shrink-0 accent-graphite" />
          <span>Pomil có thể gọi hoặc nhắn Zalo hỏi thêm về góp ý này (tối đa 1 lần).</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="publishConsent" defaultChecked={existing?.publishConsent ?? false} className="mt-0.5 h-5 w-5 shrink-0 accent-graphite" />
          <span>Cho phép hiện phần nhận xét trên website, kèm tên dạng rút gọn (ví dụ “Lan N.”). Số điện thoại và phần góp ý không bao giờ hiện công khai.</span>
        </label>
      </Step>

      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {state.status === "error" && (
        <p className="border border-danger/40 bg-danger/5 p-3 text-sm text-danger" role="alert">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending || !ready || rating === 0} className="btn btn-primary w-full sm:w-auto">
        {pending ? "Đang gửi…" : rating === 0 ? "Chọn số sao để gửi" : existing ? "Cập nhật góp ý" : "Gửi góp ý"}
      </button>
    </form>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-5 border-t border-line pt-6">
      <legend className="float-left mb-4 w-full">
        <span className="eyebrow text-rind">Phần {n}</span>
        <span className="display mt-1 block text-2xl">{title}</span>
        {hint && <span className="mt-1 block text-sm text-ink-soft">{hint}</span>}
      </legend>
      <div className="clear-both space-y-5">{children}</div>
    </fieldset>
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

function Checks({ name, legend, options, defaults }: { name: string; legend: string; options: Record<string, string>; defaults?: string[] }) {
  return (
    <fieldset>
      <legend className="field-label">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {Object.entries(options).map(([k, v]) => (
          <label key={k} className="cursor-pointer">
            <input type="checkbox" name={name} value={k} defaultChecked={defaults?.includes(k)} className="peer sr-only" />
            <span className="inline-flex min-h-10 items-center border border-line px-3 text-sm peer-checked:border-graphite peer-checked:bg-graphite peer-checked:text-bone peer-focus-visible:outline peer-focus-visible:outline-2">
              {v}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
