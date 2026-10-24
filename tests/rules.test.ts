import { describe, expect, it } from "vitest";
import { canSendMarketingMessage, hasActiveConsent, type ConsentRecord } from "@/modules/consent/rules";
import { evaluateLotRelease, isResponseOverdue, shouldHoldLot } from "@/modules/quality/rules";

const d = (s: string) => new Date(s);

describe("consent", () => {
  const granted: ConsentRecord = { purpose: "marketing_message", channel: "any", granted: true, capturedAt: d("2027-02-01"), withdrawnAt: null };

  it("allows when latest record grants", () => {
    expect(hasActiveConsent([granted], "marketing_message", "zalo", d("2027-03-01"))).toBe(true);
  });

  it("blocks after withdrawal", () => {
    const withdrawn = { ...granted, withdrawnAt: d("2027-02-15") };
    expect(hasActiveConsent([withdrawn], "marketing_message", "zalo", d("2027-03-01"))).toBe(false);
  });

  it("latest record wins: a later refusal overrides an earlier grant", () => {
    const refused: ConsentRecord = { ...granted, granted: false, capturedAt: d("2027-02-10") };
    expect(hasActiveConsent([granted, refused], "marketing_message", "zalo", d("2027-03-01"))).toBe(false);
  });

  it("does not use photo consent for messages", () => {
    const photo: ConsentRecord = { ...granted, purpose: "photo_use" };
    expect(hasActiveConsent([photo], "marketing_message", "zalo")).toBe(false);
  });

  it("respects the monthly cap", () => {
    expect(canSendMarketingMessage([granted], "zalo", { sentThisMonth: 4, monthlyCap: 4, now: d("2027-03-01") })).toEqual({
      allowed: false,
      reason: "monthly_cap",
    });
    expect(canSendMarketingMessage([], "zalo", { sentThisMonth: 0, monthlyCap: 4 })).toEqual({ allowed: false, reason: "no_consent" });
  });
});

describe("lot release", () => {
  const base = {
    status: "quarantine",
    expiresOn: d("2030-01-01"),
    tests: [
      { type: "microbial" as const, result: "pass" as const },
      { type: "heavy_metals" as const, result: "pass" as const },
    ],
    notificationExpiresAt: d("2032-01-01"),
    now: d("2027-10-30"),
  };

  it("releases when every condition holds", () => {
    expect(evaluateLotRelease(base)).toEqual({ ok: true, blockers: [] });
  });

  it("blocks on missing, pending or failed tests", () => {
    const r = evaluateLotRelease({ ...base, tests: [{ type: "microbial", result: "fail" }] });
    expect(r.ok).toBe(false);
    expect(r.blockers).toContainEqual({ code: "failed_test", test: "microbial" });
    expect(r.blockers).toContainEqual({ code: "missing_test", test: "heavy_metals" });

    const pending = evaluateLotRelease({ ...base, tests: [base.tests[0]!, { type: "heavy_metals", result: "pending" }] });
    expect(pending.blockers).toEqual([{ code: "pending_test", test: "heavy_metals" }]);
  });

  it("blocks without a valid notification or when not in quarantine", () => {
    expect(evaluateLotRelease({ ...base, notificationExpiresAt: null }).blockers).toEqual([{ code: "no_notification" }]);
    expect(evaluateLotRelease({ ...base, notificationExpiresAt: d("2027-01-01") }).blockers).toEqual([{ code: "notification_expired" }]);
    expect(evaluateLotRelease({ ...base, status: "on_hold" }).blockers).toEqual([{ code: "not_in_quarantine", status: "on_hold" }]);
  });
});

describe("complaint threshold", () => {
  const now = d("2027-12-10T12:00:00Z");

  it("holds at 3 complaints within 7 days", () => {
    expect(shouldHoldLot([d("2027-12-04T13:00:00Z"), d("2027-12-08"), d("2027-12-10")], now)).toBe(true);
  });

  it("does not hold when one is older than the window", () => {
    expect(shouldHoldLot([d("2027-12-01"), d("2027-12-08"), d("2027-12-10")], now)).toBe(false);
  });

  it("flags responses overdue after 24 hours", () => {
    expect(isResponseOverdue(d("2027-12-09T11:00:00Z"), null, now)).toBe(true);
    expect(isResponseOverdue(d("2027-12-09T13:00:00Z"), null, now)).toBe(false);
    expect(isResponseOverdue(d("2027-12-01"), d("2027-12-01T02:00:00Z"), now)).toBe(false);
  });
});
