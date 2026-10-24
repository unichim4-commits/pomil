import { describe, expect, it } from "vitest";
import { checkClaims } from "@/modules/content/rules";
import { hashPassword, passwordProblem, verifyPassword } from "@/modules/auth/password";
import { base32Decode, base32Encode, totpAt, verifyTotp } from "@/modules/auth/totp";
import { can, sessionUsable } from "@/modules/auth/rules";
import { renderMarkdown } from "@/lib/markdown";
import { displayPhone, formatDateTime, formatVnd, slugify } from "@/lib/format";
import { vietQrImageUrl } from "@/lib/vietqr";

describe("claim filter", () => {
  it("flags drug-like promises", () => {
    expect(checkClaims("Tinh dầu bưởi giúp mọc tóc nhanh.").map((v) => v.phrase)).toEqual(["mọc tóc"]);
    expect(checkClaims("Sản phẩm đặc trị gàu sau 7 ngày").map((v) => v.phrase).sort()).toEqual(["trị gàu", "đặc trị"].sort());
    expect(checkClaims("Chữa rụng tóc tận gốc").length).toBe(1);
  });

  it("allows negations and questions", () => {
    expect(checkClaims("Không làm mọc tóc. Không trị rụng tóc.")).toEqual([]);
    expect(checkClaims("Pomil không hứa mọc tóc, chỉ giúp da đầu dịu.")).toEqual([]);
    expect(checkClaims("Bưởi có làm mọc tóc không?")).toEqual([]);
    expect(checkClaims("Hiện chưa có nghiên cứu đủ mạnh cho thấy tinh dầu bưởi làm mọc tóc.")).toEqual([]);
  });

  it("does not match inside other words", () => {
    expect(checkClaims("Giá trị của minh bạch.")).toEqual([]);
    expect(checkClaims("Sửa chữa nhỏ").length).toBe(1);
    expect(checkClaims("chữab")).toEqual([]);
  });

  it("negation in one sentence does not cover the next", () => {
    expect(checkClaims("Không chứa cồn. Giúp mọc tóc.").map((v) => v.phrase)).toEqual(["mọc tóc"]);
  });
});

describe("password", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("vo-buoi-da-xanh");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("vo-buoi-da-xanh", hash)).toBe(true);
    expect(await verifyPassword("sai-mat-khau", hash)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("requires 10 characters", () => {
    expect(passwordProblem("ngan")).not.toBeNull();
    expect(passwordProblem("du-muoi-ky-tu")).toBeNull();
  });
});

describe("totp", () => {
  // Vector thử của RFC 6238 (SHA-1, khóa "12345678901234567890"), lấy 6 số cuối
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches RFC 6238 vectors", () => {
    expect(totpAt(secret, 59_000)).toBe("287082");
    expect(totpAt(secret, 1_111_111_109_000)).toBe("081804");
    expect(totpAt(secret, 1_234_567_890_000)).toBe("005924");
  });
  it("accepts ±1 step and rejects others", () => {
    const now = 1_234_567_890_000;
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
  });
  it("base32 round-trips", () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });
});

describe("permissions and sessions", () => {
  it("viewer reads only, collaborator cannot manage staff", () => {
    expect(can("viewer", "orders.write")).toBe(false);
    expect(can("collaborator", "orders.write")).toBe(true);
    expect(can("collaborator", "staff.manage")).toBe(false);
    expect(can("collaborator", "settings.write")).toBe(false);
    expect(can("owner", "staff.manage")).toBe(true);
  });
  it("needs MFA when TOTP is on", () => {
    const base = { expiresAt: new Date("2030-01-01"), staffActive: true, now: new Date("2029-01-01") };
    expect(sessionUsable({ ...base, mfaPassed: false, totpEnabled: true })).toEqual({ ok: false, reason: "mfa_required" });
    expect(sessionUsable({ ...base, mfaPassed: false, totpEnabled: false })).toEqual({ ok: true });
    expect(sessionUsable({ ...base, mfaPassed: true, totpEnabled: true, staffActive: false })).toEqual({ ok: false, reason: "inactive" });
    expect(sessionUsable({ ...base, mfaPassed: true, totpEnabled: true, now: new Date("2031-01-01") })).toEqual({ ok: false, reason: "expired" });
  });
});

describe("markdown", () => {
  it("escapes HTML and renders basics", () => {
    const html = renderMarkdown("## Tiêu đề\n\nĐoạn **đậm** <script>x</script>\n\n- một\n- hai\n\n[Lô](/minh-bach) [xấu](javascript:alert(1))");
    expect(html).toContain("<h2>Tiêu đề</h2>");
    expect(html).toContain("<strong>đậm</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<ul><li>một</li><li>hai</li></ul>");
    expect(html).toContain('<a href="/minh-bach">Lô</a>');
    expect(html).not.toContain("javascript:");
  });
});

describe("format", () => {
  it("formats money, dates, slugs, phones", () => {
    expect(formatVnd(229000)).toBe("229.000đ");
    expect(formatVnd(0)).toBe("0đ");
    expect(formatDateTime(new Date("2026-10-22T07:05:00Z"))).toBe("22/10/2026 14:05");
    expect(slugify("Dầu gội da đầu vỏ bưởi")).toBe("dau-goi-da-dau-vo-buoi");
    expect(slugify("Đặc biệt!")).toBe("dac-biet");
    expect(displayPhone("84901234567")).toBe("0901 234 567");
  });
});

describe("vietqr", () => {
  it("builds image url only for valid accounts", () => {
    const url = vietQrImageUrl({ bankBin: "970436", accountNo: "0123 456 789", accountName: "POMIL" }, 254000, "WEB-2711-0001");
    expect(url).toBe("https://img.vietqr.io/image/970436-0123456789-compact2.png?amount=254000&addInfo=WEB-2711-0001&accountName=POMIL");
    expect(vietQrImageUrl({ bankBin: "", accountNo: "1", accountName: "" }, 1, "x")).toBeNull();
  });
});
