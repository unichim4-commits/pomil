// Quy tắc đánh giá sản phẩm. Hàm thuần để test được.
import { checkClaims, type ClaimViolation } from "@/modules/content/rules";

export const SCALP_FEEL = {
  diu: "Dịu, thoáng",
  binh_thuong: "Bình thường",
  bet: "Hơi bết",
  kho: "Hơi khô căng",
  ngua: "Ngứa hoặc châm chích",
} as const;

export const WOULD_REBUY = {
  co: "Có",
  chua_chac: "Chưa chắc",
  khong: "Không",
} as const;

export const USED_FOR = {
  duoi_1_tuan: "Dưới 1 tuần",
  "1_4_tuan": "1–4 tuần",
  tren_1_thang: "Trên 1 tháng",
} as const;

export const REVIEW_STATUS_LABEL = { new: "Chờ xem", published: "Đang hiện", hidden: "Nội bộ" } as const;

export type ScalpFeel = keyof typeof SCALP_FEEL;
export type WouldRebuy = keyof typeof WOULD_REBUY;
export type UsedFor = keyof typeof USED_FOR;

export function isRating(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

export type ReviewForSummary = { rating: number; scentRating: number | null; scalpFeel: string | null; wouldRebuy: string | null };

export type ReviewSummary = {
  count: number;
  average: number | null;
  // Số đánh giá theo số sao, chỉ số 0 là 1 sao
  distribution: [number, number, number, number, number];
  scentAverage: number | null;
  rebuyRate: number | null;
  // Tỷ lệ khách thấy ngứa hoặc châm chích: tín hiệu cần xem ngay
  irritationRate: number | null;
  feel: Record<ScalpFeel, number>;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarizeReviews(rows: readonly ReviewForSummary[]): ReviewSummary {
  const distribution: ReviewSummary["distribution"] = [0, 0, 0, 0, 0];
  const feel = Object.fromEntries(Object.keys(SCALP_FEEL).map((k) => [k, 0])) as Record<ScalpFeel, number>;
  let sum = 0;
  let scentSum = 0;
  let scentN = 0;
  let rebuyYes = 0;
  let rebuyN = 0;
  let feelN = 0;

  for (const r of rows) {
    if (!isRating(r.rating)) continue;
    distribution[r.rating - 1]!++;
    sum += r.rating;
    if (r.scentRating != null && isRating(r.scentRating)) {
      scentSum += r.scentRating;
      scentN++;
    }
    if (r.wouldRebuy && r.wouldRebuy in WOULD_REBUY) {
      rebuyN++;
      if (r.wouldRebuy === "co") rebuyYes++;
    }
    if (r.scalpFeel && r.scalpFeel in SCALP_FEEL) {
      feel[r.scalpFeel as ScalpFeel]++;
      feelN++;
    }
  }
  const count = distribution.reduce((a, b) => a + b, 0);
  return {
    count,
    average: count ? round1(sum / count) : null,
    distribution,
    scentAverage: scentN ? round1(scentSum / scentN) : null,
    rebuyRate: rebuyN ? rebuyYes / rebuyN : null,
    irritationRate: feelN ? feel.ngua / feelN : null,
    feel,
  };
}

export type PublishProblem = { kind: "no_consent" } | { kind: "empty" } | { kind: "claims"; violations: ClaimViolation[] };

// Chỉ hiện công khai khi khách đồng ý, có lời nhận xét, và câu chữ không hứa công dụng như thuốc
// (mỹ phẩm không được quảng cáo "mọc tóc", "trị rụng"… kể cả khi khách tự viết).
export function reviewPublishProblem(review: { publishConsent: boolean; comment: string }): PublishProblem | null {
  if (!review.publishConsent) return { kind: "no_consent" };
  if (review.comment.trim().length === 0) return { kind: "empty" };
  const violations = checkClaims(review.comment);
  if (violations.length > 0) return { kind: "claims", violations };
  return null;
}

export function describePublishProblem(p: PublishProblem): string {
  if (p.kind === "no_consent") return "Khách không đồng ý hiện công khai, chỉ dùng nội bộ.";
  if (p.kind === "empty") return "Đánh giá không có lời nhận xét, không có gì để hiện.";
  return `Câu chữ có cụm không được dùng trên web: ${p.violations.map((v) => `"${v.phrase}"`).join(", ")}. Giữ nội bộ.`;
}

// Hiện tên khách dạng "Lan N." để không lộ họ tên đầy đủ
export function publicReviewerName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Khách Pomil";
  const given = parts[parts.length - 1]!;
  if (parts.length === 1) return given;
  return `${given} ${parts[0]!.charAt(0).toUpperCase()}.`;
}

// Đã mua: có đơn của tài khoản chứa sản phẩm và đơn đã giao
export function isVerifiedPurchase(orders: readonly { status: string; productIds: readonly string[] }[], productId: string): boolean {
  return orders.some((o) => o.status === "delivered" && o.productIds.includes(productId));
}
