import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Next chỉ cho dùng cookies()/headers() trong request; test service không cần tới chúng.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-test-"));
process.env.PGLITE_DIR = dir;

import { getDb } from "@/db/client";
import { products, lots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseSettings } from "@/modules/settings/schema";
import { changeOrderStatus, getOrderForCustomer, placeOrder, assignLot, getOrderDetail, lookupOrder } from "@/modules/orders/service";

const settings = parseSettings({});
const consentTexts = { dataProcessing: "dp", marketing: "mk" };
let tonicId = "";

beforeAll(async () => {
  const db = await getDb(); // migrate + nạp dữ liệu mẫu
  const [tonic] = await db.select().from(products).where(eq(products.code, "PST"));
  tonicId = tonic!.id;
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const baseInput = () => ({
  recipientName: "Khách Test",
  phoneE164: "84901234567",
  email: null,
  province: "Hà Nội",
  ward: "Phường Test",
  addressLine: "1 Đường Test",
  customerNote: null,
  paymentMethod: "cod" as const,
  marketingConsent: false,
  consentTexts,
  utm: null,
  landingVariant: "A",
});

describe("order flow on a real database", () => {
  it("places an order, deducts stock, numbers per month and makes repeat buyers", async () => {
    const db = await getDb();
    const before = (await db.select().from(products).where(eq(products.id, tonicId)))[0]!.stock;

    const first = await placeOrder({ ...baseInput(), lines: [{ productId: tonicId, quantity: 1 }] }, settings);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.code).toMatch(/^WEB-\d{4}-0001$/);

    const view = await getOrderForCustomer(first.code, first.accessToken);
    expect(view?.order.total).toBe(229_000 + 25_000);
    expect(await getOrderForCustomer(first.code, "wrong-token")).toBeNull();
    expect(await lookupOrder(first.code.toLowerCase(), "84901234567")).toEqual({ code: first.code, token: first.accessToken });

    const second = await placeOrder({ ...baseInput(), lines: [{ productId: tonicId, quantity: 2 }] }, settings);
    expect(second.ok && second.code).toMatch(/-0002$/);
    const after = (await db.select().from(products).where(eq(products.id, tonicId)))[0]!.stock;
    expect(after).toBe(before - 3);

    const customer = await db.query.customers.findFirst();
    expect(customer?.lifecycleStage).toBe("repeat_buyer");
  }, 60_000);

  it("refuses to oversell and restores stock on cancel", async () => {
    const db = await getDb();
    await db.update(products).set({ stock: 1 }).where(eq(products.id, tonicId));
    const tooMany = await placeOrder({ ...baseInput(), lines: [{ productId: tonicId, quantity: 2 }] }, settings);
    expect(tooMany.ok).toBe(false);

    const one = await placeOrder({ ...baseInput(), lines: [{ productId: tonicId, quantity: 1 }] }, settings);
    expect(one.ok).toBe(true);
    expect((await db.select().from(products).where(eq(products.id, tonicId)))[0]!.stock).toBe(0);

    const order = await db.query.orders.findFirst({ where: (o, { eq }) => eq(o.code, one.ok ? one.code : "") });
    expect(await changeOrderStatus(order!.id, "delivered", "00000000-0000-4000-8000-000000000000", null)).toEqual({ ok: false, message: "Không chuyển được sang trạng thái này" });
    expect((await changeOrderStatus(order!.id, "cancelled", "00000000-0000-4000-8000-000000000000", "khách đổi ý")).ok).toBe(true);
    expect((await db.select().from(products).where(eq(products.id, tonicId)))[0]!.stock).toBe(1);
  }, 60_000);

  it("only assigns released lots of the same product", async () => {
    const db = await getDb();
    await db.update(products).set({ stock: 10 }).where(eq(products.id, tonicId));
    const placed = await placeOrder({ ...baseInput(), lines: [{ productId: tonicId, quantity: 1 }] }, settings);
    const order = await db.query.orders.findFirst({ where: (o, { eq }) => eq(o.code, placed.ok ? placed.code : "") });
    const detail = await getOrderDetail(order!.id);
    const item = detail!.items[0]!;
    const [lot] = await db.select().from(lots);
    const actor = "00000000-0000-4000-8000-000000000000";
    expect((await assignLot(item.id, lot!.id, actor)).ok).toBe(false); // lô mẫu còn cách ly
    await db.update(lots).set({ releaseStatus: "released", isPublic: false }).where(eq(lots.id, lot!.id));
    // T-8 / SA-5: lô đã duyệt nhưng quên bật công khai vẫn gán được, kèm cảnh báo cho quản trị
    expect(await assignLot(item.id, lot!.id, actor)).toEqual({ ok: true, warning: "Lô này chưa bật trang công khai, khách quét mã sẽ không xem được." });
    const after = await getOrderDetail(order!.id);
    expect(after!.items[0]).toMatchObject({ lotId: lot!.id, lotIsPublic: false, lotReleaseStatus: "released" });
    expect(after!.availableLots.find((l) => l.id === lot!.id)?.isPublic).toBe(false);
    await db.update(lots).set({ isPublic: true }).where(eq(lots.id, lot!.id));
    expect(await assignLot(item.id, lot!.id, actor)).toEqual({ ok: true });
  }, 60_000);
});
