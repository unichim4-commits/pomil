import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { consents, customers, touchpoints } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { generateReferralCode } from "@/lib/referral";
import type { Utm } from "@/lib/utm";

export type WaitlistInput = {
  name: string;
  phoneE164: string;
  scalpConcern: string;
  marketingConsent: boolean;
  consentText: string;
  utm: Utm | null;
  landingVariant: string | null;
  referredByCode: string | null;
  // Sản phẩm khách muốn nhận tin khi mở bán (slug), null nếu đăng ký chung
  interest?: string | null;
};

// Đăng ký danh sách chờ: tìm hoặc tạo khách theo số điện thoại, ghi đồng ý và điểm chạm.
export async function registerWaitlist(input: WaitlistInput): Promise<{ customerId: string; referralCode: string }> {
  const db = await getDb();
  const policyVersion = process.env.CONSENT_POLICY_VERSION ?? "unversioned";

  return db.transaction(async (tx) => {
    const existing = await tx.query.customers.findFirst({ where: eq(customers.phoneE164, input.phoneE164) });

    let referredById: string | null = null;
    if (input.referredByCode) {
      const referrer = await tx.query.customers.findFirst({ where: eq(customers.referralCode, input.referredByCode) });
      referredById = referrer?.id ?? null;
    }

    let customerId: string;
    let referralCode: string;

    if (existing) {
      customerId = existing.id;
      referralCode = existing.referralCode;
      await tx
        .update(customers)
        .set({
          name: existing.name ?? input.name,
          lastTouchUtm: input.utm ?? existing.lastTouchUtm,
          scalpProfile: { ...existing.scalpProfile, concerns: mergeConcern(existing.scalpProfile.concerns, input.scalpConcern) },
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId));
    } else {
      referralCode = generateReferralCode();
      const [row] = await tx
        .insert(customers)
        .values({
          phoneE164: input.phoneE164,
          name: input.name,
          scalpProfile: { concerns: [input.scalpConcern] },
          firstTouchUtm: input.utm,
          lastTouchUtm: input.utm,
          landingVariant: input.landingVariant,
          referralCode,
          referredByCustomerId: referredById,
        })
        .returning({ id: customers.id });
      customerId = row!.id;
      await writeAudit(tx, { actorId: null, action: "customer.created", entity: "customers", entityId: customerId, after: { source: "waitlist" } });
    }

    // Luôn ghi một bản ghi đồng ý mới, kể cả khi khách không đồng ý, để có bằng chứng.
    await tx.insert(consents).values({
      customerId,
      purpose: "marketing_message",
      channel: "any",
      granted: input.marketingConsent,
      policyVersion,
      source: "waitlist",
      evidence: { text: input.consentText },
    });

    await tx.insert(touchpoints).values({
      customerId,
      type: "waitlist_signup",
      payload: { utm: input.utm, variant: input.landingVariant, referredByCode: input.referredByCode, interest: input.interest ?? null },
    });

    return { customerId, referralCode };
  });
}

function mergeConcern(current: string[] | undefined, next: string): string[] {
  const set = new Set(current ?? []);
  set.add(next);
  return [...set];
}
