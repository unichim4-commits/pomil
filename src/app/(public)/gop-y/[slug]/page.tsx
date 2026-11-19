import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseLotNo } from "@/lib/lot-no";
import { currentCustomer } from "@/modules/accounts/service";
import { getFeedbackProduct, getMyReview } from "@/modules/reviews/service";
import { FeedbackForm } from "./feedback-form";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lot?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getFeedbackProduct((await params).slug);
  return { title: product ? `Góp ý ${product.name}` : "Góp ý sản phẩm", robots: { index: false } };
}

// Trang góp ý sau khi dùng, mở cho mọi khách (kể cả mua trên sàn, không có tài khoản).
// Đường dẫn từ thẻ cảm ơn, trang lô (?lot=) và trang sản phẩm.
export default async function FeedbackPage({ params, searchParams }: Props) {
  const [{ slug }, { lot }] = await Promise.all([params, searchParams]);
  const product = await getFeedbackProduct(slug);
  if (!product) notFound();
  const me = await currentCustomer();
  const mine = me ? await getMyReview(me.accountId, product.id) : null;
  const lotNo = lot && parseLotNo(lot) ? lot.trim().toUpperCase() : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <p className="eyebrow enter text-rind">Góp ý sau khi dùng</p>
      <h1 className="display enter mt-4 text-4xl" style={{ ["--d" as string]: "100ms" }}>
        {product.name}
      </h1>
      <p className="mt-2 text-ink-soft">{[product.subtitle, product.size].filter(Boolean).join(" · ")}</p>
      <p className="mt-4 text-ink-soft">
        Khoảng 3 phút. Chỉ số sao và một câu trả lời về da đầu hoặc nhận xét là bắt buộc, phần còn lại bỏ trống được. Pomil đọc hết, kể cả góp ý chê, và dùng để chỉnh lô sau.
      </p>
      <div className="mt-10">
        <FeedbackForm
          product={product}
          loggedInName={me?.name ?? null}
          lotNo={lotNo}
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
              reportedLotNo: mine.reportedLotNo,
              channel: mine.channel,
              ageRange: mine.ageRange,
              scalpType: mine.scalpType,
              concerns: mine.concerns,
              habits: mine.habits,
              usageFrequency: mine.usageFrequency,
              comparedBefore: mine.comparedBefore,
              scentIntensity: mine.scentIntensity,
              aspectRatings: mine.aspectRatings,
              nps: mine.nps,
              followUpConsent: mine.followUpConsent,
            }
          }
        />
      </div>
    </div>
  );
}
