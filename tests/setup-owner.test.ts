import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Lỗi #1 (T-2): ai vào /dang-nhap trước cũng tạo được chủ cửa hàng; gửi cùng lúc tạo được 2 chủ.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-setup-"));
process.env.PGLITE_DIR = dir;
process.env.ALLOW_PGLITE = "1";

import { count } from "drizzle-orm";
import { getDb } from "@/db/client";
import { staffUsers } from "@/db/schema";
import { setupOwnerAction } from "@/app/dang-nhap/actions";
import { setupMode, setupTokenMatches, SETUP_TOKEN_MIN } from "@/modules/auth/setup";

const GOOD_TOKEN = "khoi-tao-pomil-0123456789abcdef";

function form(extra: Record<string, string> = {}) {
  const fd = new FormData();
  const values = { name: "Chủ Pomil", email: "chu@pomil.test", password: "mat-khau-du-dai", confirm: "mat-khau-du-dai", ...extra };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function ownerCount() {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(staffUsers);
  return row?.n ?? 0;
}

async function runAction(fd: FormData) {
  try {
    return await setupOwnerAction({ status: "idle" }, fd);
  } catch (error) {
    if ((error as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) return { status: "redirect" as const };
    throw error;
  }
}

beforeAll(async () => {
  await getDb();
}, 120_000);
afterEach(() => vi.unstubAllEnvs());
// Mỗi ca bắt đầu với DB chưa có nhân viên nào
beforeEach(async () => {
  const db = await getDb();
  await db.delete(staffUsers);
  jar.clear();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("setup gate rules", () => {
  it("requires a long SETUP_TOKEN in production, open on a dev machine", () => {
    expect(setupMode({ nodeEnv: "development", setupToken: undefined })).toBe("open");
    expect(setupMode({ nodeEnv: "test", setupToken: "" })).toBe("open");
    expect(setupMode({ nodeEnv: "production", setupToken: undefined })).toBe("disabled");
    expect(setupMode({ nodeEnv: "production", setupToken: "ngan-qua" })).toBe("disabled");
    expect(setupMode({ nodeEnv: "production", setupToken: "x".repeat(SETUP_TOKEN_MIN) })).toBe("token");
    // Máy dev có đặt mã thì vẫn kiểm mã
    expect(setupMode({ nodeEnv: "development", setupToken: GOOD_TOKEN })).toBe("token");
  });

  it("compares tokens of any length without throwing", () => {
    expect(setupTokenMatches(GOOD_TOKEN, GOOD_TOKEN)).toBe(true);
    expect(setupTokenMatches(GOOD_TOKEN, ` ${GOOD_TOKEN} `)).toBe(true);
    expect(setupTokenMatches(GOOD_TOKEN, "sai")).toBe(false);
    expect(setupTokenMatches(GOOD_TOKEN, "")).toBe(false);
    expect(setupTokenMatches("", "")).toBe(false);
  });
});

describe("setupOwnerAction", () => {
  it("refuses to create an owner in production when SETUP_TOKEN is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SETUP_TOKEN", "");
    const result = await runAction(form());
    expect(result.status).toBe("error");
    expect(await ownerCount()).toBe(0);
  });

  it("refuses a wrong setup code in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SETUP_TOKEN", GOOD_TOKEN);
    const result = await runAction(form({ setupToken: "doan-bua-mot-ma-bat-ky-0000" }));
    expect(result).toEqual({ status: "error", message: "Mã khởi tạo chưa đúng." });
    expect(await ownerCount()).toBe(0);
  });

  it("creates exactly one owner when two setups are sent at the same time", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SETUP_TOKEN", GOOD_TOKEN);
    const [a, b] = await Promise.all([
      runAction(form({ setupToken: GOOD_TOKEN, email: "a@pomil.test" })),
      runAction(form({ setupToken: GOOD_TOKEN, email: "b@pomil.test" })),
    ]);
    expect([a.status, b.status].sort()).toEqual(["error", "redirect"]);
    expect(await ownerCount()).toBe(1);
  }, 30_000);
});
