import Link from "next/link";
import { formatDate } from "@/lib/format";
import { currentCustomer } from "@/modules/accounts/service";
import { SCALP_FEEL, USED_FOR, type ScalpFeel, type UsedFor } from "@/modules/reviews/rules";
import { getMyReview, publicReviews } from "@/modules/reviews/service";
import { ReviewForm } from "./review-form";

function Stars({ value, className = "" }: { value: number; className?: string }) {
  const full = Math.round(value);
  return (
    <span className={className} aria-label={`${value} trên 5 sao`}>
      <span aria-hidden="true">
        {"★".repeat(full)}
        <span className="text-line">{"★".repeat(5 - full)}</span>
      </span>
    </span>
  );
}

// Đánh giá công khai và form góp ý ở cuối trang sản phẩm
export async function ReviewsSection({ productId, productSlug }: { productId: string; productSlug: string }) {
  const [me, { summary, reviews }] = await Promise.all([currentCustomer(), publicReviews(productId)]);
  const mine = me ? await getMyReview(me.accountId, productId) : null;

  return (
    <section id="danh-gia" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6">
      <div className="grid gap-12 border-t border-line pt-12 md:grid-cols-[18rem_1fr]">
        <div>
          <p className="eyebrow text-rind">Đánh giá</p>
          <h2 className="display mt-3 text-4xl">Khách nói gì</h2>
          {summary.count > 0 && summary.average !== null ? (
            <div className="mt-6">
              <p className="text-5xl font-light">{summary.average.toLocaleString("vi-VN")}</p>
              <Stars value={summary.average} className="mt-1 block text-xl" />
              <p className="mt-1 text-sm text-ink-soft">{summary.count} đánh giá đã duyệt</p>
              <ul className="mt-5 space-y-1.5 text-sm">
                {[5, 4, 3, 2, 1].map((n) => {
                  const c = summary.distribution[n - 1]!;
                  return (
                    <li key={n} className="flex items-center gap-3">
                      <span className="w-8 text-ink-soft">{n}★</span>
                      <span className="h-1.5 flex-1 bg-pith">
                        <span className="block h-full bg-graphite" style={{ width: `${(c / summary.count) * 100}%` }} />
                      </span>
                      <span className="w-6 text-right text-ink-soft">{c}</span>
                    </li>
                  );
                })}
              </ul>
              {summary.rebuyRate !== null && <p className="mt-4 text-sm">{Math.round(summary.rebuyRate * 100)}% nói sẽ mua lại</p>}
            </div>
          ) : (
            <p className="mt-6 text-ink-soft">Chưa có đánh giá công khai. Pomil hiện cả đánh giá thấp, chỉ bỏ câu hứa hẹn công dụng như thuốc.</p>
          )}
        </div>

        <div className="space-y-10">
          {me ? (
            <div>
              <h3 className="eyebrow mb-4">{mine ? "Đánh giá của bạn" : "Viết đánh giá"}</h3>
              <ReviewForm
                productId={productId}
                productSlug={productSlug}
                existing={
                  mine && {
                    rating: mine.rating,
                    scentRating: mine.scentRating,
                    scalpFeel: mine.scalpFeel,
                    wouldRebuy: mine.wouldRebuy,
                    usedFor: mine.usedFor,
                    comment: mine.comment,
                    suggestion: mine.suggestion,
                    publishConsent: mine.publishConsent,
                  }
                }
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4 border border-line bg-paper p-6">
              <p className="text-ink-soft">Đã dùng thử? Đăng nhập để chấm sao và góp ý cho lô sau.</p>
              <Link href={`/tai-khoan/dang-nhap?tiep=${encodeURIComponent(`/san-pham/${productSlug}#danh-gia`)}`} className="btn btn-primary">
                Đăng nhập để đánh giá
              </Link>
            </div>
          )}

          {reviews.length > 0 && (
            <ul className="divide-y divide-line border-y border-line">
              {reviews.map((r) => (
                <li key={r.id} className="py-6">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <Stars value={r.rating} />
                    <span className="font-medium">{r.reviewer}</span>
                    {r.verifiedPurchase && <span className="eyebrow text-[0.65rem] text-rind">Đã mua</span>}
                    <span className="text-ink-soft">{formatDate(r.createdAt)}</span>
                  </div>
                  <p className="mt-3 leading-relaxed">{r.comment}</p>
                  <p className="mt-2 text-xs text-ink-soft">
                    {[r.scalpFeel && SCALP_FEEL[r.scalpFeel as ScalpFeel] && `Da đầu: ${SCALP_FEEL[r.scalpFeel as ScalpFeel].toLowerCase()}`, r.usedFor && USED_FOR[r.usedFor as UsedFor] && `Đã dùng ${USED_FOR[r.usedFor as UsedFor].toLowerCase()}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
