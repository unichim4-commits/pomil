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

// ---------- Trường góp ý chi tiết (trang /gop-y/[slug]) ----------

export const CHANNEL = {
  web: "Website Pomil",
  tiktok: "TikTok Shop",
  shopee: "Shopee",
  zalo: "Zalo",
  qua_tang: "Được tặng hoặc dùng thử",
  khac: "Nơi khác",
} as const;

export const AGE_RANGE = { duoi_18: "Dưới 18", "18_24": "18–24", "25_34": "25–34", "35_44": "35–44", tu_45: "45 trở lên" } as const;

export const SCALP_TYPE = {
  dau: "Da đầu dầu, nhanh bết",
  kho: "Da đầu khô",
  hon_hop: "Hỗn hợp",
  nhay_cam: "Nhạy cảm, dễ ngứa",
  binh_thuong: "Bình thường",
  khong_ro: "Không rõ",
} as const;

// Điều khách để ý trên da đầu trước khi dùng (chọn nhiều)
export const CONCERNS = {
  ngua: "Ngứa",
  gau: "Gàu, vảy",
  bet: "Bết nhanh",
  kho_cang: "Khô căng",
  mui: "Mùi da đầu, mồ hôi",
  bi_do: "Mẩn đỏ, nổi mụn nhỏ",
  toc_xo: "Tóc xơ, dễ gãy",
} as const;

// Thói quen ảnh hưởng da đầu (chọn nhiều)
export const HABITS = {
  mu_bao_hiem: "Đội mũ bảo hiểm hằng ngày",
  mo_hoi: "Tập thể thao, ra nhiều mồ hôi",
  goi_hang_ngay: "Gội đầu hằng ngày",
  nhuom_uon: "Nhuộm, uốn hoặc duỗi tóc",
  dieu_hoa: "Ngồi phòng điều hòa nhiều",
} as const;

export const USAGE_FREQUENCY = {
  hang_ngay: "Hằng ngày",
  "3_5_tuan": "3–5 lần mỗi tuần",
  "1_2_tuan": "1–2 lần mỗi tuần",
  it_hon: "Ít hơn",
} as const;

export const SCENT_INTENSITY = { nhe_qua: "Nhẹ quá", vua: "Vừa", dam_qua: "Đậm quá" } as const;

export const COMPARED_BEFORE = {
  de_chiu_hon: "Dễ chịu hơn",
  nhu_cu: "Như cũ",
  kem_hon: "Khó chịu hơn",
  chua_ro: "Chưa thấy rõ",
} as const;

// Chấm 1–5 từng mặt của sản phẩm. Mùi đã có cột riêng (scentRating).
export const ASPECTS = {
  texture: "Cảm giác chất (nhẹ, không nhờn)",
  dryness: "Khô ráo sau khi dùng hoặc dễ xả sạch",
  ease: "Dễ dùng (đầu xịt, vòi, nắp)",
  packaging: "Chai và nhãn (chắc, dễ đọc)",
  value: "Đáng tiền so với giá",
} as const;

// Nhân viên gắn nhãn vấn đề để gom thành việc cải tiến
export const ISSUE_TAGS = {
  mui: "Mùi",
  ket_cau: "Kết cấu, độ bết",
  kich_ung: "Kích ứng",
  dau_xit: "Đầu xịt, vòi, nắp",
  bao_bi: "Chai, nhãn",
  dung_tich: "Dung tích",
  gia: "Giá",
  cam_nhan: "Cảm nhận sau khi dùng",
  huong_dan: "Hướng dẫn dùng",
  giao_hang: "Giao hàng, đóng gói",
  khac: "Khác",
} as const;

export const ACTION_STATUS = {
  chua_xu_ly: "Chưa xử lý",
  dang_xem: "Đang xem",
  lo_sau: "Đưa vào lô sau",
  khong_doi: "Không đổi",
  da_xong: "Đã xong",
} as const;

export type Channel = keyof typeof CHANNEL;
export type AgeRange = keyof typeof AGE_RANGE;
export type ScalpType = keyof typeof SCALP_TYPE;
export type Concern = keyof typeof CONCERNS;
export type Habit = keyof typeof HABITS;
export type UsageFrequency = keyof typeof USAGE_FREQUENCY;
export type ScentIntensity = keyof typeof SCENT_INTENSITY;
export type ComparedBefore = keyof typeof COMPARED_BEFORE;
export type Aspect = keyof typeof ASPECTS;
export type IssueTag = keyof typeof ISSUE_TAGS;
export type ActionStatus = keyof typeof ACTION_STATUS;
export type AspectRatings = Partial<Record<Aspect, number>>;

// Giữ lại các khóa hợp lệ, bỏ trùng; dùng cho ô chọn nhiều gửi từ form
export function pickKeys<T extends Record<string, string>>(map: T, values: readonly unknown[]): (keyof T & string)[] {
  const out: (keyof T & string)[] = [];
  for (const v of values) if (typeof v === "string" && v in map && !out.includes(v)) out.push(v);
  return out;
}

export function cleanAspectRatings(input: Record<string, unknown>): AspectRatings {
  const out: AspectRatings = {};
  for (const k of Object.keys(ASPECTS) as Aspect[]) {
    const raw = input[k];
    const n = typeof raw === "string" && raw !== "" ? Number(raw) : raw;
    if (isRating(n)) out[k] = n;
  }
  return out;
}

export function isNps(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10;
}

// NPS = % người chấm 9–10 trừ % người chấm 0–6
export function npsScore(scores: readonly (number | null | undefined)[]): number | null {
  const valid = scores.filter(isNps);
  if (valid.length === 0) return null;
  const promoters = valid.filter((n) => n >= 9).length;
  const detractors = valid.filter((n) => n <= 6).length;
  return Math.round(((promoters - detractors) / valid.length) * 100);
}

// Khách chưa đăng nhập phải để lại tên; muốn được hỏi thêm thì phải có số điện thoại.
export function guestFeedbackProblem(input: { loggedIn: boolean; guestName: string; contactPhone: string | null; followUpConsent: boolean }): string | null {
  if (!input.loggedIn && input.guestName.trim().length < 2) return "Bạn để lại tên (hoặc tên gọi) để Pomil biết ai góp ý nhé.";
  if (input.followUpConsent && !input.contactPhone) return "Để Pomil hỏi thêm, bạn điền số điện thoại nhé.";
  return null;
}

// Số lô chỉ được tính là "có số lô" khi lô có thật và đúng sản phẩm đang góp ý
export function lotMatchesProduct(lot: { productId: string } | null | undefined, productId: string): boolean {
  return !!lot && lot.productId === productId;
}

export type FeedbackForStats = ReviewForSummary & {
  aspectRatings: AspectRatings | null;
  nps: number | null;
  comparedBefore: string | null;
  scentIntensity: string | null;
  issueTags: readonly string[] | null;
};

export type FeedbackStats = ReviewSummary & {
  aspects: Record<Aspect, number | null>;
  nps: number | null;
  better: number | null;
  scentTooStrong: number;
  scentTooLight: number;
  issues: { tag: IssueTag; label: string; count: number }[];
};

// Thống kê để quyết định sửa gì ở lô sau: điểm từng mặt, NPS, tỷ lệ thấy dễ chịu hơn, nhãn vấn đề nhiều nhất
export function feedbackStats(rows: readonly FeedbackForStats[]): FeedbackStats {
  const base = summarizeReviews(rows);
  const aspects = {} as Record<Aspect, number | null>;
  for (const k of Object.keys(ASPECTS) as Aspect[]) {
    const vals = rows.map((r) => r.aspectRatings?.[k]).filter(isRating);
    aspects[k] = vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  const compared = rows.map((r) => r.comparedBefore).filter((v): v is string => !!v && v in COMPARED_BEFORE && v !== "chua_ro");
  const issueCount = new Map<IssueTag, number>();
  for (const r of rows) for (const t of pickKeys(ISSUE_TAGS, r.issueTags ?? [])) issueCount.set(t, (issueCount.get(t) ?? 0) + 1);
  return {
    ...base,
    aspects,
    nps: npsScore(rows.map((r) => r.nps)),
    better: compared.length ? compared.filter((v) => v === "de_chiu_hon").length / compared.length : null,
    scentTooStrong: rows.filter((r) => r.scentIntensity === "dam_qua").length,
    scentTooLight: rows.filter((r) => r.scentIntensity === "nhe_qua").length,
    issues: [...issueCount.entries()].map(([tag, count]) => ({ tag, label: ISSUE_TAGS[tag], count })).sort((a, b) => b.count - a.count),
  };
}

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
