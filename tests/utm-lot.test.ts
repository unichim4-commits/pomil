import { describe, expect, it } from "vitest";
import { decodeUtmCookie, encodeUtmCookie, parseUtm } from "@/lib/utm";
import { formatLotNo, lotPageUrl, parseLotNo } from "@/lib/lot-no";

describe("parseUtm", () => {
  it("lowercases values, uppercases ref and stamps time", () => {
    const now = new Date("2027-02-20T03:00:00Z");
    const utm = parseUtm(new URLSearchParams("utm_source=TikTok&utm_campaign=waitlist-2702&ref=ab12cd"), now);
    expect(utm).toEqual({ utm_source: "tiktok", utm_campaign: "waitlist-2702", ref: "AB12CD", landedAt: now.toISOString() });
  });

  it("returns null without utm params", () => {
    expect(parseUtm(new URLSearchParams("foo=bar"))).toBeNull();
  });

  it("round-trips through the cookie and ignores garbage", () => {
    const utm = { utm_source: "zalo" };
    expect(decodeUtmCookie(encodeUtmCookie(utm))).toEqual(utm);
    expect(decodeUtmCookie("%%%")).toBeNull();
  });
});

describe("lot numbers", () => {
  it("formats and parses PST-YYMMDD-NN", () => {
    const lotNo = formatLotNo("pst", new Date(Date.UTC(2027, 9, 20)), 1);
    expect(lotNo).toBe("PST-271020-01");
    expect(parseLotNo(lotNo)).toEqual({ productCode: "PST", manufacturedOn: new Date(Date.UTC(2027, 9, 20)), batch: 1 });
  });

  it.each(["PST-271320-01", "PST-270231-01", "PST-271020-00", "PST271020-01", "X-271020-01"])("rejects %s", (bad) => {
    expect(parseLotNo(bad)).toBeNull();
  });

  it("builds the lot page url", () => {
    expect(lotPageUrl("https://pomil.vn/", "PST-271020-01")).toBe("https://pomil.vn/l/PST-271020-01");
  });
});
