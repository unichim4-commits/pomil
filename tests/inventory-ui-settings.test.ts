// Form "Vận hành" ở /admin/cai-dat (00-tong-quan.md mục 10): đọc số kiểu Việt Nam, % lưu bp, giữ mốc làm mới hạn dùng.
import { describe, expect, it } from "vitest";
import { ERP_FIELDS, erpFieldValue, parseErpForm } from "@/app/admin/cai-dat/erp-form";
import { parseErpSettings } from "@/modules/settings/erp-schema";

const current = { ...parseErpSettings({}), lastExpiryRefreshAt: "2026-11-01T00:00:00.000Z" };
const formOf = (s: typeof current) => Object.fromEntries(ERP_FIELDS.map((f) => [f.key, erpFieldValue(s, f)]));
const getter = (o: Record<string, string>) => (k: string) => o[k] ?? "";

describe("erp settings form", () => {
  it("round-trips the defaults and keeps lastExpiryRefreshAt", () => {
    const r = parseErpForm(getter(formOf(current)), current);
    expect(r).toEqual({ ok: true, value: current });
  });

  it("shows percent from basis points and money with dot grouping", () => {
    const f = (k: string) => ERP_FIELDS.find((x) => x.key === k)!;
    expect(erpFieldValue({ ...current, overIssueWarnBp: 550 }, f("overIssueWarnBp"))).toBe("5,5");
    expect(erpFieldValue({ ...current, overIssueWarnBp: 525 }, f("overIssueWarnBp"))).toBe("5,25");
    expect(erpFieldValue({ ...current, overIssueWarnBp: 500 }, f("overIssueWarnBp"))).toBe("5");
    expect(erpFieldValue({ ...current, minCashAlert: 5_000_000 }, f("minCashAlert"))).toBe("5.000.000");
  });

  it("parses Vietnamese numbers: 5,5 % → 550 bp, 2.000.000 đồng → 2000000", () => {
    const r = parseErpForm(getter({ ...formOf(current), overIssueWarnBp: "5,5", minCashAlert: "2.000.000", expiryWarnDays: "30" }), current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.overIssueWarnBp).toBe(550);
    expect(r.value.minCashAlert).toBe(2_000_000);
    expect(r.value.expiryWarnDays).toBe(30);
  });

  it("rejects empty, non-numeric, too many decimals and out-of-range values with the field label", () => {
    const bad = (k: string, v: string) => parseErpForm(getter({ ...formOf(current), [k]: v }), current);
    const label = (k: string) => ERP_FIELDS.find((x) => x.key === k)!.label;
    expect(bad("expiryWarnDays", "")).toEqual({ ok: false, message: `${label("expiryWarnDays")}: nhập số hợp lệ` });
    expect(bad("slowMovingDays", "abc").ok).toBe(false);
    expect(bad("overIssueWarnBp", "5,555").ok).toBe(false);
    expect(bad("minCashAlert", "1,5").ok).toBe(false);
    expect(bad("forecastWeeks", "0")).toEqual({ ok: false, message: `${label("forecastWeeks")}: ngoài khoảng cho phép` });
    expect(bad("budgetWarnBp", "101").ok).toBe(false);
  });
});
