"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UserError } from "@/lib/errors";
import { logError } from "@/lib/log";
import { parseLotNo } from "@/lib/lot-no";
import { normalizeVnPhone } from "@/lib/phone";
import { currentCustomer } from "@/modules/accounts/service";
import { notifyInBackground } from "@/modules/notify/service";
import {
  AGE_RANGE,
  CHANNEL,
  cleanAspectRatings,
  COMPARED_BEFORE,
  CONCERNS,
  guestFeedbackProblem,
  HABITS,
  pickKeys,
  SCALP_FEEL,
  SCALP_TYPE,
  SCENT_INTENSITY,
  USAGE_FREQUENCY,
  USED_FOR,
  WOULD_REBUY,
  type AgeRange,
  type Channel,
  type ComparedBefore,
  type ScalpFeel,
  type ScalpType,
  type ScentIntensity,
  type UsageFrequency,
  type UsedFor,
  type WouldRebuy,
} from "@/modules/reviews/rules";
import { submitReview } from "@/modules/reviews/service";

export type FeedbackState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; updated: boolean; lotNote: string | null; at: number };

const key = <T extends Record<string, string>>(map: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v in map ? (v as keyof T & string) : null));

const intIn = (min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= min && v <= max), "Điểm không hợp lệ");

const schema = z.object({
  productId: z.string().uuid(),
  productSlug: z.string().max(120),
  guestName: z.string().trim().max(60, "Tên tối đa 60 ký tự").default(""),
  phone: z.string().trim().max(20).default(""),
  lotNo: z.string().trim().toUpperCase().max(40).default(""),
  channel: key(CHANNEL),
  ageRange: key(AGE_RANGE),
  scalpType: key(SCALP_TYPE),
  usedFor: key(USED_FOR),
  usageFrequency: key(USAGE_FREQUENCY),
  rating: z.coerce.number({ invalid_type_error: "Chọn số sao" }).int().min(1, "Chọn số sao chung").max(5),
  scentRating: intIn(1, 5),
  scentIntensity: key(SCENT_INTENSITY),
  scalpFeel: key(SCALP_FEEL),
  comparedBefore: key(COMPARED_BEFORE),
  wouldRebuy: key(WOULD_REBUY),
  nps: intIn(0, 10),
  comment: z.string().trim().max(1500, "Nhận xét tối đa 1.500 ký tự").default(""),
  suggestion: z.string().trim().max(1500, "Góp ý tối đa 1.500 ký tự").default(""),
  publishConsent: z.literal("on").optional(),
  followUpConsent: z.literal("on").optional(),
  website: z.string().max(0).optional(),
});

export async function feedbackAction(_prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const single = Object.fromEntries([...formData.keys()].map((k) => [k, formData.get(k)]).filter(([, v]) => typeof v === "string"));
  const parsed = schema.safeParse(single);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ" };
  const d = parsed.data;

  const me = await currentCustomer();
  const contactPhone = d.phone ? normalizeVnPhone(d.phone) : null;
  if (d.phone && !contactPhone) return { status: "error", message: "Số điện thoại chưa đúng, bạn kiểm lại nhé (ví dụ 0912 345 678)." };
  const followUp = d.followUpConsent === "on";
  const problem = guestFeedbackProblem({ loggedIn: !!me, guestName: d.guestName, contactPhone, followUpConsent: followUp });
  if (problem) return { status: "error", message: problem };
  if (d.lotNo && !parseLotNo(d.lotNo)) return { status: "error", message: "Số lô có dạng PST-271101-01, in dưới đáy chai. Không chắc thì để trống." };
  if (!d.comment && !d.suggestion && !d.scalpFeel) return { status: "error", message: "Bạn chọn cảm giác trên da đầu hoặc viết vài dòng nhận xét nhé." };

  try {
    const result = await submitReview({
      accountId: me?.accountId ?? null,
      productId: d.productId,
      rating: d.rating,
      scentRating: d.scentRating,
      scalpFeel: d.scalpFeel as ScalpFeel | null,
      wouldRebuy: d.wouldRebuy as WouldRebuy | null,
      usedFor: d.usedFor as UsedFor | null,
      comment: d.comment,
      suggestion: d.suggestion,
      publishConsent: d.publishConsent === "on",
      details: {
        guestName: d.guestName,
        contactPhone,
        lotNo: d.lotNo || null,
        channel: d.channel as Channel | null,
        ageRange: d.ageRange as AgeRange | null,
        scalpType: d.scalpType as ScalpType | null,
        concerns: pickKeys(CONCERNS, formData.getAll("concerns")),
        habits: pickKeys(HABITS, formData.getAll("habits")),
        usageFrequency: d.usageFrequency as UsageFrequency | null,
        comparedBefore: d.comparedBefore as ComparedBefore | null,
        scentIntensity: d.scentIntensity as ScentIntensity | null,
        aspectRatings: cleanAspectRatings(Object.fromEntries([...formData.entries()].filter(([k]) => k.startsWith("aspect_")).map(([k, v]) => [k.slice(7), v]))),
        nps: d.nps,
        followUpConsent: followUp,
      },
    });
    notifyInBackground({
      kind: "review_created",
      reviewId: result.reviewId,
      productName: result.productName,
      rating: d.rating,
      irritation: d.scalpFeel === "ngua",
      comment: d.comment,
    });
    revalidatePath(`/san-pham/${d.productSlug}`);
    const lotNote = d.lotNo && !result.lotMatched ? `Pomil chưa thấy lô ${d.lotNo} của sản phẩm này, sẽ kiểm lại bằng tay.` : null;
    return { status: "ok", updated: result.updated, lotNote, at: Date.now() };
  } catch (error) {
    if (error instanceof UserError) return { status: "error", message: error.message };
    logError("feedback", error);
    return { status: "error", message: "Chưa gửi được, bạn thử lại sau ít phút nhé." };
  }
}
