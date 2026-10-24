import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Lỗi #5 (T-2) + G3: deploy xong là nhận đơn thật cho hàng chưa sản xuất.
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
vi.mock("next/server", () => ({ after: () => undefined }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-closed-"));
process.env.PGLITE_DIR = dir;
process.env.PGLITE_SEED = "production";

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { lots, orders, products, settings } from "@/db/schema";
import { addToCartAction } from "@/app/(public)/gio-hang/actions";
import { checkoutAction } from "@/app/(public)/thanh-toan/actions";
import { writeCart } from "@/modules/cart/service";
import { parseSettings, storeSettingsSchema } from "@/modules/settings/schema";
import { getSeedMode } from "@/modules/settings/service";

let tonicId = "";

beforeAll(async () => {
  const db = await getDb();
  tonicId = (await db.select().from(products).where(eq(products.code, "PST")))[0]!.id;
}, 120_000);
afterAll(() => {
  delete process.env.PGLITE_SEED;
  rmSync(dir, { recursive: true, force: true });
});

function addForm() {
  const fd = new FormData();
  fd.set("productId", tonicId);
  fd.set("quantity", "1");
  return fd;
}

function checkoutForm() {
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    recipientName: "Khách Sớm",
    phone: "0901234567",
    province: "Hà Nội",
    ward: "Phường Test",
    addressLine: "1 Đường Test",
    paymentMethod: "cod",
    dataConsent: "on",
  }))
    fd.set(k, v);
  return fd;
}

describe("settings defaults", () => {
  it("closes sales by default and accepts a short launch note", () => {
    expect(parseSettings({}).salesOpen).toBe(false);
    expect(parseSettings({}).launchNote).toBe("");
    expect(storeSettingsSchema.safeParse({ launchNote: "Dự kiến mở bán tháng 11/2027" }).success).toBe(true);
    expect(storeSettingsSchema.safeParse({ launchNote: "x".repeat(121) }).success).toBe(false);
  });
});

describe("production seed", () => {
  it("has nothing for sale, no stock, sales closed and no sample lot", async () => {
    const db = await getDb();
    const all = await db.select().from(products);
    expect(all.length).toBe(5);
    expect(all.every((p) => p.status === "coming_soon" || p.status === "draft")).toBe(true);
    expect(all.every((p) => p.stock === 0)).toBe(true);
    const [store] = await db.select().from(settings).where(eq(settings.key, "store"));
    expect(parseSettings(store?.value).salesOpen).toBe(false);
    expect(await db.select().from(lots)).toEqual([]);
    expect(await getSeedMode()).toBe("production");
  });

  it("refuses add-to-cart", async () => {
    expect(await addToCartAction({ status: "idle" }, addForm())).toEqual({ status: "error", message: "Sản phẩm này hiện chưa bán" });
  });
});

describe("sales closed with a product in stock", () => {
  it("refuses add-to-cart and checkout while salesOpen is off", async () => {
    const db = await getDb();
    await db.update(products).set({ status: "active", stock: 10 }).where(eq(products.id, tonicId));

    expect(await addToCartAction({ status: "idle" }, addForm())).toEqual({ status: "error", message: "Sản phẩm này hiện chưa bán" });

    // Giỏ cũ còn trong cookie từ trước khi tắt bán: thanh toán vẫn bị chặn
    await writeCart([{ productId: tonicId, quantity: 1 }]);
    expect(await checkoutAction({ status: "idle" }, checkoutForm())).toEqual({ status: "error", message: "Cửa hàng đang tạm ngừng nhận đơn." });
    expect(await db.select().from(orders)).toEqual([]);
    expect((await db.select().from(products).where(eq(products.id, tonicId)))[0]!.stock).toBe(10);
  });
});
