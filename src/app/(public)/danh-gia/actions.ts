"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UserError } from "@/lib/errors";
import { logError } from "@/lib/log";
import { currentCustomer } from "@/modules/accounts/service";
import { notifyInBackground } from "@/modules/notify/service";
import { SCALP_FEEL, USED_FOR, WOULD_REBUY, type ScalpFeel, type UsedFor, type WouldRebuy } from "@/modules/reviews/rules";
import { submitReview } from "@/modules/reviews/service";

export type ReviewFormState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; updated: boolean; at: number };

const optionalKey = <T extends Record<string, string>>(map: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v in map ? (v as keyof T & string) : null));

const schema = z.object({
  productId: z.string().uuid(),
  productSlug: z.string().max(120),
  rating: z.coerce.number({ invalid_type_error: "Chọn số sao" }).int().min(1, "Chọn số sao").max(5),
  scentRating: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 5)),
  scalpFeel: optionalKey(SCALP_FEEL),
  wouldRebuy: optionalKey(WOULD_REBUY),
  usedFor: optionalKey(USED_FOR),
  comment: z.string().trim().max(1500, "Nhận xét tối đa 1.500 ký tự").default(""),
  suggestion: z.string().trim().max(1500, "Góp ý tối đa 1.500 ký tự").default(""),
  publishConsent: z.literal("on").optional(),
  website: z.string().max(0).optional(),
});

export async function reviewAction(_prev: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  const me = await currentCustomer();
  if (!me) return { status: "error", message: "Phiên đăng nhập đã hết, bạn đăng nhập lại nhé." };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ" };
  const d = parsed.data;
  if (!d.comment && !d.suggestion && !d.scalpFeel) return { status: "error", message: "Bạn viết vài dòng nhận xét hoặc chọn cảm giác trên da đầu nhé." };

  try {
    const result = await submitReview({
      accountId: me.accountId,
      productId: d.productId,
      rating: d.rating,
      scentRating: d.scentRating,
      scalpFeel: d.scalpFeel as ScalpFeel | null,
      wouldRebuy: d.wouldRebuy as WouldRebuy | null,
      usedFor: d.usedFor as UsedFor | null,
      comment: d.comment,
      suggestion: d.suggestion,
      publishConsent: d.publishConsent === "on",
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
    return { status: "ok", updated: result.updated, at: Date.now() };
  } catch (error) {
    if (error instanceof UserError) return { status: "error", message: error.message };
    logError("review", error);
    return { status: "error", message: "Chưa gửi được, bạn thử lại sau ít phút nhé." };
  }
}
