import { describe, expect, it } from "vitest";
import { randomToken, toBase64Url } from "@/lib/random-token";
import { SETUP_TOKEN_MIN } from "@/modules/auth/setup";

// T-9 / SA-8: nút "Tạo chuỗi ngẫu nhiên" ở /dang-nhap.
describe("randomToken", () => {
  it("is 32 base64url characters, enough for SETUP_TOKEN", () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(t.length).toBeGreaterThanOrEqual(SETUP_TOKEN_MIN);
  });
  it("differs every time", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(seen.size).toBe(200);
  });
  it("matches Node's base64url encoding", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 24, 31]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 97 + 13) & 255);
      expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
    const all = new Uint8Array(256).map((_, i) => i);
    expect(toBase64Url(all)).toBe(Buffer.from(all).toString("base64url"));
  });
  it("uses the given random source", () => {
    expect(randomToken(3, (b) => b.fill(255))).toBe("____");
  });
});
