// Quy tắc đồng ý (SYS-20). Hàm thuần, không đụng cơ sở dữ liệu, để test được.

export type ConsentPurpose = "marketing_message" | "photo_use" | "trial_participation" | "data_processing";
export type ConsentChannel = "zalo" | "sms" | "email" | "any";

export type ConsentRecord = {
  purpose: ConsentPurpose;
  channel: ConsentChannel;
  granted: boolean;
  capturedAt: Date;
  withdrawnAt: Date | null;
};

// Bản ghi mới nhất cho mục đích và kênh quyết định. "any" áp cho mọi kênh.
export function hasActiveConsent(
  records: ConsentRecord[],
  purpose: ConsentPurpose,
  channel: Exclude<ConsentChannel, "any">,
  now: Date = new Date(),
): boolean {
  const relevant = records
    .filter((r) => r.purpose === purpose && (r.channel === channel || r.channel === "any"))
    .filter((r) => r.capturedAt.getTime() <= now.getTime())
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());

  const latest = relevant[0];
  if (!latest) return false;
  if (!latest.granted) return false;
  if (latest.withdrawnAt && latest.withdrawnAt.getTime() <= now.getTime()) return false;
  return true;
}

// Bộ gửi tin phải gọi hàm này ngay trước khi gửi, không chỉ lúc lên lịch.
export function canSendMarketingMessage(
  records: ConsentRecord[],
  channel: Exclude<ConsentChannel, "any">,
  opts: { sentThisMonth: number; monthlyCap: number; now?: Date },
): { allowed: true } | { allowed: false; reason: "no_consent" | "monthly_cap" } {
  if (!hasActiveConsent(records, "marketing_message", channel, opts.now)) return { allowed: false, reason: "no_consent" };
  if (opts.sentThisMonth >= opts.monthlyCap) return { allowed: false, reason: "monthly_cap" };
  return { allowed: true };
}
