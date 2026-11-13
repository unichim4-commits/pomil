import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-payment-"));
process.env.PGLITE_DIR = dir;

import { and, eq, like } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cashAccounts, cashTransactions, dealers, orderEvents, orders, products, receivables } from "@/db/schema";
import { accountBalance, applyDebtPayment, cancelCashTransaction, openReceivable } from "@/modules/finance/ledger";
import { applyOrderPaymentStatus, paymentAccountCode, paymentTransitionProblem, usesReceivable } from "@/modules/orders/payment";
import { placeOrder, setPaymentStatus } from "@/modules/orders/service";
import { vnToday } from "@/modules/numbering";
import { parseSettings } from "@/modules/settings/schema";

const ACTOR = "00000000-0000-4000-8000-000000000000";
let tonicId = "";
const acc: Record<string, string> = {};

beforeAll(async () => {
  const db = await getDb();
  const [tonic] = await db.select().from(products).where(eq(products.code, "PST"));
  tonicId = tonic!.id;
  for (const a of await db.select().from(cashAccounts)) acc[a.code] = a.id;
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function newOrder(paymentMethod: "cod" | "bank_transfer", quantity = 1) {
  const result = await placeOrder(
    {
      lines: [{ productId: tonicId, quantity }],
      recipientName: "Khách Thanh Toán",
      phoneE164: "84907770001",
      email: null,
      province: "Hà Nội",
      ward: "Phường Test",
      addressLine: "1 Đường Test",
      customerNote: null,
      paymentMethod,
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

async function cashFor(orderId: string) {
  const db = await getDb();
  return db.select().from(cashTransactions).where(and(eq(cashTransactions.sourceType, "order"), eq(cashTransactions.sourceId, orderId)));
}

describe("hàm thuần thanh toán đơn (R-BH-18)", () => {
  it("tài khoản theo phương thức, đơn công nợ, chuyển trạng thái", () => {
    expect(paymentAccountCode("bank_transfer")).toBe("NH");
    expect(paymentAccountCode("cod")).toBe("COD");
    expect(paymentAccountCode("cash")).toBe("TM");
    expect(paymentAccountCode("platform")).toBeNull();
    expect(paymentAccountCode("credit")).toBeNull();
    expect(usesReceivable("platform")).toBe(true);
    expect(usesReceivable("credit")).toBe(true);
    expect(usesReceivable("cod")).toBe(false);
    expect(paymentTransitionProblem("credit", "unpaid", "paid", "staff")).toBe("Đơn công nợ: thu tiền ở mục Công nợ");
    expect(paymentTransitionProblem("credit", "unpaid", "paid", "receivable")).toBeNull();
    expect(paymentTransitionProblem("cod", "refunded", "paid", "staff")).toMatch(/đã hoàn tiền/);
    expect(paymentTransitionProblem("cod", "unpaid", "refunded", "staff")).toMatch(/chưa thu tiền/);
    expect(paymentTransitionProblem("cod", "paid", "unpaid", "staff")).toBeNull();
  });
});

describe("applyOrderPaymentStatus trên PGlite", () => {
  it("đơn COD giao xong → phiếu thu vào COD, gọi lại không tạo phiếu thứ hai", async () => {
    const db = await getDb();
    const order = await newOrder("cod");
    const codBefore = await accountBalance(db, acc.COD!);
    const r = await db.transaction((tx) => applyOrderPaymentStatus(tx, order.id, "paid", ACTOR, { source: "cod_delivery" }));
    expect(r).toEqual({ ok: true, changed: true });
    expect(await accountBalance(db, acc.COD!)).toBe(codBefore + order.total);

    const [pt] = await cashFor(order.id);
    expect(pt).toMatchObject({ direction: "in", amount: order.total, accountId: acc.COD, idempotencyKey: `order-paid:${order.id}`, occurredOn: vnToday(), counterpartyName: "Khách Thanh Toán" });
    expect(pt!.code).toMatch(/^PT-\d{4}-\d{4}$/);

    // Đánh dấu lại đã thu → không tạo phiếu thứ hai
    expect(await setPaymentStatus(order.id, "paid", ACTOR)).toEqual({ ok: true });
    expect(await db.transaction((tx) => applyOrderPaymentStatus(tx, order.id, "paid", ACTOR, { source: "staff" }))).toEqual({ ok: true, changed: false });
    expect(await cashFor(order.id)).toHaveLength(1);
    expect(await accountBalance(db, acc.COD!)).toBe(codBefore + order.total);

    const events = await db.select().from(orderEvents).where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.type, "payment")));
    expect(events).toHaveLength(1);
    expect(events[0]!.note).toContain(pt!.code);
  }, 60_000);

  it("hai lần bấm đồng thời chỉ ra một phiếu thu", async () => {
    const db = await getDb();
    const order = await newOrder("bank_transfer", 2);
    const results = await Promise.all([setPaymentStatus(order.id, "paid", ACTOR), setPaymentStatus(order.id, "paid", ACTOR)]);
    expect(results.every((r) => r.ok)).toBe(true);
    const rows = await cashFor(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: acc.NH, amount: order.total });

    // Bấm với trạng thái cũ (expectedFrom) → báo đơn vừa đổi
    const stale = await db.transaction((tx) => applyOrderPaymentStatus(tx, order.id, "paid", ACTOR, { source: "staff", expectedFrom: "unpaid" }));
    expect(stale).toEqual({ ok: false, message: "Đơn vừa được người khác cập nhật, tải lại trang." });
    expect(await cashFor(order.id)).toHaveLength(1);
  }, 60_000);

  it("hoàn tiền: phiếu chi cùng tài khoản đã thu; refunded thì không đổi được nữa", async () => {
    const db = await getDb();
    const order = await newOrder("bank_transfer");
    const nhBefore = await accountBalance(db, acc.NH!);
    expect(await setPaymentStatus(order.id, "refunded", ACTOR)).toEqual({ ok: false, message: "Đơn chưa thu tiền, không hoàn được" });
    expect(await setPaymentStatus(order.id, "paid", ACTOR)).toEqual({ ok: true });
    expect(await accountBalance(db, acc.NH!)).toBe(nhBefore + order.total);
    expect(await setPaymentStatus(order.id, "refunded", ACTOR)).toEqual({ ok: true });
    expect(await accountBalance(db, acc.NH!)).toBe(nhBefore);
    const rows = await cashFor(order.id);
    expect(rows.find((r) => r.direction === "out")).toMatchObject({ amount: order.total, accountId: acc.NH, idempotencyKey: `order-refund:${order.id}` });
    expect(await setPaymentStatus(order.id, "paid", ACTOR)).toEqual({ ok: false, message: "Đơn đã hoàn tiền, không đổi được trạng thái thanh toán" });
  }, 60_000);

  it("sửa nhầm paid → unpaid hủy phiếu thu; thu lại tạo phiếu mới", async () => {
    const db = await getDb();
    const order = await newOrder("bank_transfer");
    const nhBefore = await accountBalance(db, acc.NH!);
    expect(await setPaymentStatus(order.id, "paid", ACTOR)).toEqual({ ok: true });
    expect(await setPaymentStatus(order.id, "unpaid", ACTOR)).toEqual({ ok: true });
    expect(await accountBalance(db, acc.NH!)).toBe(nhBefore);
    expect(await setPaymentStatus(order.id, "paid", ACTOR)).toEqual({ ok: true });
    const rows = await cashFor(order.id);
    expect(rows.map((r) => r.status).sort()).toEqual(["cancelled", "posted"]);
    expect(rows.find((r) => r.status === "cancelled")!.idempotencyKey).toMatch(new RegExp(`^order-paid:${order.id}#cancelled-`));
    expect(await accountBalance(db, acc.NH!)).toBe(nhBefore + order.total);
  }, 60_000);

  it("hoàn tiền mặt vượt quỹ bị chặn và không đổi trạng thái đơn (cả giao dịch hủy)", async () => {
    const db = await getDb();
    const order = await newOrder("cod");
    // Giả sử đơn trả tiền mặt và đã thu nhưng quỹ TM sau đó đã chi hết
    await db.update(orders).set({ paymentMethod: "cash" }).where(eq(orders.id, order.id));
    expect(await setPaymentStatus(order.id, "paid", ACTOR)).toEqual({ ok: true });
    const tm = await accountBalance(db, acc.TM!);
    await db.transaction((tx) => cancelCashTransaction(tx, { idempotencyKey: `order-paid:${order.id}` }, "Thử", ACTOR));
    // trạng thái đơn vẫn paid nhưng phiếu thu đã hủy → TM = tm − total; hoàn sẽ làm âm nếu TM < total
    expect(await accountBalance(db, acc.TM!)).toBe(tm - order.total);
    const r = await setPaymentStatus(order.id, "refunded", ACTOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/^Tiền mặt chỉ còn/);
    const after = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    expect(after!.paymentStatus).toBe("paid");
  }, 60_000);

  it("đơn đại lý (credit): nhân viên không đặt paid; trả công nợ 2 lần thì đơn paid; hủy lần trả thì đơn về unpaid", async () => {
    const db = await getDb();
    const order = await newOrder("cod", 2);
    const [dealer] = await db.insert(dealers).values({ code: "DL-T01", name: "Đại lý Test", paymentTermsDays: 30 }).returning();
    await db.update(orders).set({ paymentMethod: "credit", dealerId: dealer!.id }).where(eq(orders.id, order.id));

    expect(await setPaymentStatus(order.id, "paid", ACTOR)).toEqual({ ok: false, message: "Đơn công nợ: thu tiền ở mục Công nợ" });

    const input = { party: "dealer" as const, dealerId: dealer!.id, orderId: order.id, amount: order.total, issuedOn: vnToday(), dueOn: vnToday() };
    const r = await db.transaction((tx) => openReceivable(tx, input, ACTOR));
    expect(r.created).toBe(true);
    expect(await db.transaction((tx) => openReceivable(tx, input, ACTOR))).toEqual({ ...r, created: false });
    expect(await db.select().from(receivables).where(eq(receivables.orderId, order.id))).toHaveLength(1);

    const half = Math.floor(order.total / 2);
    const p1 = await db.transaction((tx) => applyDebtPayment(tx, { kind: "receivable", debtId: r.id, amount: half, accountId: acc.NH!, paidOn: vnToday() }, ACTOR));
    expect(p1.status).toBe("partial");
    expect((await db.query.orders.findFirst({ where: eq(orders.id, order.id) }))!.paymentStatus).toBe("unpaid");
    const p2 = await db.transaction((tx) => applyDebtPayment(tx, { kind: "receivable", debtId: r.id, amount: order.total - half, accountId: acc.NH!, paidOn: vnToday() }, ACTOR));
    expect(p2).toMatchObject({ status: "paid", remaining: 0 });
    expect((await db.query.orders.findFirst({ where: eq(orders.id, order.id) }))!.paymentStatus).toBe("paid");
    // Nguồn receivable không ghi phiếu thu đơn (tiền đã ở Công nợ)
    expect(await cashFor(order.id)).toHaveLength(0);
    expect(await db.select().from(cashTransactions).where(like(cashTransactions.idempotencyKey, `order-paid:${order.id}%`))).toHaveLength(0);

    await db.transaction((tx) => cancelCashTransaction(tx, { id: p2.cashTxId }, "Ngân hàng trả lại", ACTOR));
    expect((await db.query.orders.findFirst({ where: eq(orders.id, order.id) }))!.paymentStatus).toBe("unpaid");
    const [debt] = await db.select().from(receivables).where(eq(receivables.id, r.id));
    expect(debt).toMatchObject({ paidAmount: half, status: "partial" });
  }, 60_000);
});
