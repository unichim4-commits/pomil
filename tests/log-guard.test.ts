import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

// Lỗi #4 (T-2): lỗi truy vấn chứa giá trị tham số (SĐT, tên, địa chỉ); bị ghi nguyên vào log
// và guard() trả nguyên câu SQL ra giao diện quản trị.
const PHONE = "84901234567";
const NAME = "Nguyễn Thị Riêng Tư";
let dbError: unknown;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
vi.mock("@/modules/settings/service", async () => {
  const { parseSettings } = await import("@/modules/settings/schema");
  return { getSettings: async () => parseSettings({ salesOpen: true }) };
});
vi.mock("@/modules/cart/service", () => ({ readCart: async () => [{ productId: "00000000-0000-4000-8000-000000000001", quantity: 1 }], writeCart: async () => undefined }));
vi.mock("@/modules/orders/service", () => ({
  placeOrder: async () => {
    throw dbError;
  },
}));
vi.mock("@/modules/notify/service", () => ({ notifyInBackground: () => undefined }));

import { guard } from "@/app/admin/_lib/result";
import { checkoutAction } from "@/app/(public)/thanh-toan/actions";
import { UserError } from "@/lib/errors";
import { describeError, formatSafeError, logError } from "@/lib/log";
import { PermissionError } from "@/modules/auth/service";

let client: PGlite;
const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

beforeAll(async () => {
  // Tạo lỗi DB thật: thêm hai khách trùng số điện thoại
  client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(schema.customers).values({ phoneE164: PHONE, name: NAME, referralCode: "AAAAAA" });
  try {
    await db.insert(schema.customers).values({ phoneE164: PHONE, name: NAME, referralCode: "BBBBBB" });
  } catch (error) {
    dbError = error;
  }
}, 120_000);
afterEach(() => spy.mockClear());
afterAll(async () => {
  spy.mockRestore();
  await client.close();
});

const logged = () => spy.mock.calls.map((args) => args.map((a) => (typeof a === "string" ? a : a instanceof Error ? `${a.message}\n${a.stack}` : JSON.stringify(a))).join(" ")).join("\n");

describe("the reproduced DB error", () => {
  it("really contains customer data", () => {
    expect(dbError).toBeInstanceOf(Error);
    expect(String((dbError as Error).message)).toContain(PHONE);
  });
});

describe("logError", () => {
  it("keeps name and Postgres code, drops SQL and params", () => {
    const d = describeError(dbError);
    expect(d.code).toBe("23505");
    expect(d.message).not.toContain(PHONE);
    expect(d.message).not.toContain(NAME);
    expect(d.message.toLowerCase()).not.toContain("insert into");
    logError("checkout", dbError);
    const out = logged();
    expect(out).toContain("[checkout]");
    expect(out).toContain("23505");
    expect(out).not.toContain(PHONE);
    expect(out).not.toContain(NAME);
    expect(out).not.toContain("params");
  });

  it("masks phone numbers, emails and quoted values in plain messages", () => {
    expect(formatSafeError("x", new Error("gửi 0901 234 567 thất bại cho khach@mail.vn"))).toBe("[x] Error: gửi [số] thất bại cho [email]");
    expect(formatSafeError("x", new Error('invalid input syntax for type uuid: "Nguyễn Văn A"'))).toBe('[x] Error: invalid input syntax for type uuid: "…"');
    expect(formatSafeError("x", "Zalo từ chối: 84901234567")).toBe("[x] Error: Zalo từ chối: [số]");
    expect(formatSafeError("x", null)).toBe("[x] object");
  });
});

describe("guard", () => {
  it("shows a generic sentence for unexpected errors and logs no customer data", async () => {
    const result = await guard(async () => {
      throw dbError;
    });
    expect(result).toEqual({ status: "error", message: "Có lỗi, thử lại sau. Nếu lặp lại, báo kỹ thuật kèm thời điểm." });
    const out = logged();
    expect(out).not.toContain(PHONE);
    expect(out).not.toContain(NAME);
  });

  it("shows intended business messages as-is", async () => {
    expect(await guard(async () => Promise.reject(new UserError("Chỉ nhận ảnh JPG, PNG, WebP hoặc AVIF.")))).toEqual({ status: "error", message: "Chỉ nhận ảnh JPG, PNG, WebP hoặc AVIF." });
    expect(await guard(async () => Promise.reject(new PermissionError()))).toEqual({ status: "error", message: "Tài khoản của bạn không có quyền làm việc này." });
    expect(spy).not.toHaveBeenCalled();
  });

  it("lets Next redirect/notFound errors through", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;/x" });
    await expect(guard(async () => Promise.reject(redirect))).rejects.toBe(redirect);
  });
});

describe("checkout logging", () => {
  it("does not write the customer's phone or name to the log when placing the order fails", async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      recipientName: NAME,
      phone: "0901234567",
      province: "Hà Nội",
      ward: "Phường Test",
      addressLine: "12 Ngõ Riêng Tư",
      paymentMethod: "cod",
      dataConsent: "on",
    }))
      fd.set(k, v);
    const result = await checkoutAction({ status: "idle" }, fd);
    expect(result.status).toBe("error");
    const out = logged();
    expect(out).toContain("23505");
    expect(out).not.toContain(PHONE);
    expect(out).not.toContain(NAME);
    expect(out).not.toContain("Ngõ Riêng Tư");
  });
});
