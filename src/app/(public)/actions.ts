"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { registerWaitlist } from "@/modules/customers/service";
import { logError } from "@/lib/log";
import { normalizeVnPhone } from "@/lib/phone";
import { decodeUtmCookie, UTM_COOKIE } from "@/lib/utm";
import { VARIANT_COOKIE } from "@/lib/variant";
import { WAITLIST_CONSENT_TEXT } from "@/modules/consent/texts";

export type WaitlistState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; referralCode: string };

const schema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên").max(80),
  phone: z.string().trim().min(9, "Vui lòng nhập số điện thoại"),
  scalpConcern: z.enum(["oily", "itchy", "odor", "dandruff", "hair_fall", "other"]),
  marketingConsent: z.literal("on").optional(),
  interest: z.string().max(80).regex(/^[a-z0-9-]*$/).optional(),
  // Ô ẩn chống bot: người thật không điền
  website: z.string().max(0).optional(),
});

export async function joinWaitlist(_prev: WaitlistState, formData: FormData): Promise<WaitlistState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ" };

  const phoneE164 = normalizeVnPhone(parsed.data.phone);
  if (!phoneE164) return { status: "error", message: "Số điện thoại di động chưa đúng" };

  const cookieStore = await cookies();
  const utm = decodeUtmCookie(cookieStore.get(UTM_COOKIE)?.value);

  try {
    const result = await registerWaitlist({
      name: parsed.data.name,
      phoneE164,
      scalpConcern: parsed.data.scalpConcern,
      marketingConsent: parsed.data.marketingConsent === "on",
      consentText: WAITLIST_CONSENT_TEXT,
      utm,
      landingVariant: cookieStore.get(VARIANT_COOKIE)?.value ?? null,
      referredByCode: utm?.ref ?? null,
      interest: parsed.data.interest || null,
    });
    return { status: "ok", referralCode: result.referralCode };
  } catch (error) {
    logError("waitlist", error);
    return { status: "error", message: "Chưa lưu được, bạn thử lại sau ít phút nhé" };
  }
}
