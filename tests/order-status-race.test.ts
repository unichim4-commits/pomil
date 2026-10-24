import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-race-"));
process.env.PGLITE_DIR = dir;

import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getDb } from "@/db/client";
import { orders, products } from "@/db/schema";
import { parseSettings } from "@/modules/settings/schema";
import { changeOrderStatus, placeOrder, setPaymentStatus } from "@/modules/orders/service";

const ACTOR = "00000000-0000-4000-8000-000000000000";
let tonicId = "";

beforeAll(async () => {
  const db = await getDb();
  const [tonic] = await db.select().from(products).where(eq(products.code, "PST"));
  tonicId = tonic!.id;
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function stock() {
  const db = await getDb();
  return (await db.select().from(products).where(eq(products.id, tonicId)))[0]!.stock;
}

async function newOrder(quantity: number) {
  const result = await placeOrder(
    {
      lines: [{ productId: tonicId, quantity }],
      recipientName: "Khách Race",
      phoneE164: "84907654321",
      email: null,
      province: "Hà Nội",
      ward: "Phường Test",
      addressLine: "1 Đường Test",
      customerNote: null,
      paymentMethod: "bank_transfer",
      marketingConsent: false,
      consentTexts: { dataProcessing: "dp", marketing: "mk" },
      utm: null,
      landingVariant: null,
    },
    parseSettings({}),
  );
  if (!result.ok) throw new Error("place failed");
  const db = await getDb();
  return (await db.query.orders.findFirst({ where: eq(orders.code, result.code) }))!;
}

// PGlite chạy từng giao dịch một, nên không tự tái hiện được cảnh hai giao dịch cùng đọc.
// Ở đây cho lần gọi sau "đọc" bản đơn cũ (trạng thái trước khi lần đầu ghi xong), đúng như
// chuyện xảy ra trên PostgreSQL thật với READ COMMITTED khi hai người bấm cùng lúc.
function withStaleOrderRead(db: Db, stale: typeof orders.$inferSelect) {
  const original = db.transaction.bind(db);
  return vi.spyOn(db, "transaction").mockImplementationOnce(((cb: (tx: unknown) => Promise<unknown>) =>
    original(async (tx) => {
      const ordersQuery = new Proxy(tx.query.orders, {
        get(target, prop, receiver) {
          if (prop === "findFirst") return async () => stale;
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const query = new Proxy(tx.query, { get: (t, p, r) => (p === "orders" ? ordersQuery : Reflect.get(t, p, r)) });
      const proxied = new Proxy(tx, {
        get(t, p, r) {
          if (p === "query") return query;
          const value = Reflect.get(t, p, r);
          return typeof value === "function" ? value.bind(t) : value;
        },
      });
      return cb(proxied);
    })) as Db["transaction"]);
}

describe("order status race", () => {
  it("cancelling the same order twice at once restores stock only once", async () => {
    const db = await getDb();
    const start = await stock();
    const order = await newOrder(2);
    expect(await stock()).toBe(start - 2);

    const staleSnapshot = { ...order };
    expect(await changeOrderStatus(order.id, "cancelled", ACTOR, "Khách đổi ý")).toEqual({ ok: true });
    expect(await stock()).toBe(start);

    const spy = withStaleOrderRead(db, staleSnapshot);
    const second = await changeOrderStatus(order.id, "cancelled", ACTOR, "Bấm lần hai");
    spy.mockRestore();

    expect(second).toEqual({ ok: false, message: "Đơn vừa được người khác cập nhật, tải lại trang." });
    expect(await stock()).toBe(start);
  }, 60_000);

  it("payment status change on a stale read is refused", async () => {
    const db = await getDb();
    const order = await newOrder(1);
    const staleSnapshot = { ...order };
    expect(await setPaymentStatus(order.id, "paid", ACTOR)).toEqual({ ok: true });

    const spy = withStaleOrderRead(db, staleSnapshot);
    const second = await setPaymentStatus(order.id, "paid", ACTOR);
    spy.mockRestore();
    expect(second).toEqual({ ok: false, message: "Đơn vừa được người khác cập nhật, tải lại trang." });
  }, 60_000);
});
