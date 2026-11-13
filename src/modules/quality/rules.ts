// Quy tắc lô và phản ánh (SYS-19, SYS-25). Hàm thuần để test được.

export type LotTestType = "microbial" | "heavy_metals" | "stability" | "gc_ms" | "irritation" | "sensory";
export type LotTestResult = "pass" | "fail" | "pending";

// Ít nhất các kiểm nghiệm này phải đạt mới được duyệt xuất kho.
export const REQUIRED_RELEASE_TESTS: readonly LotTestType[] = ["microbial", "heavy_metals"];

export type ReleaseBlocker =
  | { code: "missing_test"; test: LotTestType }
  | { code: "failed_test"; test: LotTestType }
  | { code: "pending_test"; test: LotTestType }
  | { code: "no_notification" }
  | { code: "notification_expired" }
  | { code: "lot_expired" }
  | { code: "not_in_quarantine"; status: string };

export function evaluateLotRelease(input: {
  status: string;
  expiresOn: Date;
  tests: { type: LotTestType; result: LotTestResult }[];
  notificationExpiresAt: Date | null;
  now?: Date;
}): { ok: boolean; blockers: ReleaseBlocker[] } {
  const now = input.now ?? new Date();
  const blockers: ReleaseBlocker[] = [];

  if (input.status !== "quarantine") blockers.push({ code: "not_in_quarantine", status: input.status });

  for (const required of REQUIRED_RELEASE_TESTS) {
    const results = input.tests.filter((t) => t.type === required);
    if (results.length === 0) blockers.push({ code: "missing_test", test: required });
    else if (results.some((t) => t.result === "fail")) blockers.push({ code: "failed_test", test: required });
    else if (!results.some((t) => t.result === "pass")) blockers.push({ code: "pending_test", test: required });
  }

  if (!input.notificationExpiresAt) blockers.push({ code: "no_notification" });
  else if (input.notificationExpiresAt.getTime() <= now.getTime()) blockers.push({ code: "notification_expired" });

  if (input.expiresOn.getTime() <= now.getTime()) blockers.push({ code: "lot_expired" });

  return { ok: blockers.length === 0, blockers };
}

export const HOLD_THRESHOLD = 3;
export const HOLD_WINDOW_DAYS = 7;

// 3 phản ánh cùng lô trong 7 ngày gần nhất thì giữ lô.
export function shouldHoldLot(
  complaintOpenedAt: Date[],
  now: Date = new Date(),
  threshold = HOLD_THRESHOLD,
  windowDays = HOLD_WINDOW_DAYS,
): boolean {
  const since = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const recent = complaintOpenedAt.filter((d) => d.getTime() > since && d.getTime() <= now.getTime());
  return recent.length >= threshold;
}

// Phản ánh quá 24 giờ chưa phản hồi thì cần nhắc.
export function isResponseOverdue(openedAt: Date, firstResponseAt: Date | null, now: Date = new Date()): boolean {
  if (firstResponseAt) return false;
  return now.getTime() - openedAt.getTime() > 24 * 60 * 60 * 1000;
}

export type LotReleaseStatus = "quarantine" | "released" | "on_hold" | "recalled" | "rejected";
export type LotLookup = "bad_format" | "missing" | "pending" | "public";

// Trang lô công khai: phân biệt sai định dạng, không có lô, lô chưa mở (chưa công khai hoặc đang
// cách ly) và lô xem được. Lô đang giữ hoặc thu hồi vẫn hiện, kèm cảnh báo trên trang.
export function classifyLotLookup(validFormat: boolean, lot: { isPublic: boolean; releaseStatus: LotReleaseStatus } | null): LotLookup {
  if (!validFormat) return "bad_format";
  if (!lot) return "missing";
  if (!lot.isPublic || lot.releaseStatus === "quarantine" || lot.releaseStatus === "rejected") return "pending";
  return "public";
}

// Lô đã duyệt xuất kho nhưng quên bật trang công khai: vẫn cho gán vào đơn, nhưng nhắc quản trị
// vì khách quét mã trên chai sẽ gặp trang "chưa mở".
export const LOT_NOT_PUBLIC_WARNING = "Lô này chưa bật trang công khai, khách quét mã sẽ không xem được.";

export function lotNotPublicWarning(lot: { isPublic: boolean; releaseStatus: string } | null): string | null {
  if (!lot) return null;
  return lot.releaseStatus === "released" && !lot.isPublic ? LOT_NOT_PUBLIC_WARNING : null;
}

// Form phản ánh (D-3): số lô và mã mẫu thử đều tùy chọn. Thiếu cả hai thì phải có số liên hệ,
// vì không có lô lẫn số điện thoại thì Pomil không hỏi lại được. Trả về ô còn thiếu, hoặc null.
export type ComplaintMissing = "contact" | null;

export function complaintMissingField(input: { lotNo?: string | null; sampleCode?: string | null; contactPhone?: string | null }): ComplaintMissing {
  const has = (v: string | null | undefined) => !!v && v.trim().length > 0;
  if (has(input.lotNo) || has(input.sampleCode)) return null;
  return has(input.contactPhone) ? null : "contact";
}

// Nhãn lô ở danh sách phản ánh quản trị: lô đã khớp, số khách gõ nhưng không khớp, mã mẫu, hoặc chưa có.
export function complaintLotLabel(c: { lotNo: string | null; reportedLotNo?: string | null; sampleCode: string | null }): string {
  if (c.lotNo) return c.lotNo;
  const parts: string[] = [];
  if (c.reportedLotNo) parts.push(`${c.reportedLotNo} (không khớp lô nào)`);
  if (c.sampleCode) parts.push(`Mẫu ${c.sampleCode}`);
  return parts.length ? parts.join(" · ") : "Chưa có số lô";
}

// Nhãn phản hồi ở danh sách phản ánh quản trị (T-9, SA-b). Không có số liên hệ thì Pomil không gọi
// lại được, nên hiện nhãn trung tính thay cho nhãn đỏ "quá hạn". Có số, chưa phản hồi quá 24 giờ thì đỏ.
export type ComplaintResponseBadge = { tone: "red" | "neutral"; label: string } | null;

export function complaintResponseBadge(
  c: { openedAt: Date; firstResponseAt: Date | null; contactPhone: string | null },
  now: Date = new Date(),
): ComplaintResponseBadge {
  if (!c.contactPhone || c.contactPhone.trim().length === 0) return { tone: "neutral", label: "Không có số liên hệ" };
  return isResponseOverdue(c.openedAt, c.firstResponseAt, now) ? { tone: "red", label: "Quá 24 giờ chưa phản hồi" } : null;
}
