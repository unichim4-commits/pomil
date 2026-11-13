// T-19 (QA): Bán hàng (đại lý, sàn) × Kho (sản phẩm quản lý kho) × Tài chính (phải thu, thu nợ, sổ quỹ).
// AC-TICHHOP-11, AC-TICHHOP-12, AC-TC-9 (bấm hai lần khi thu nợ), AC-BH-13 (gán lô tay trên sản phẩm quản lý kho).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-qa-daily-"));
process.env.PGLITE_DIR = dir;

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cashAccounts, cashTransactions, debtPayments, financeCategories, inventoryItems, lots, orderItems, orders, payables, products, receivables, stockLots, stockMovements, suppliers, warehouses } from "@/db/schema";
import { payDebt } from "@/modules/finance/debts";
import { enableInventoryTracking, postReceipt } from "@/modules/inventory/ledger";
import { vnToday } from "@/modules/numbering/rules";
import { assignLot, changeOrderStatus, packOrder } from "@/modules/orders/service";
import { listPackedAwaitingShipment, listPackingQueue } from "@/modules/sales/packing";
import { savePriceList, updateChannel, upsertPriceListItem } from "@/modules/sales/catalog";
import { createDealer } from "@/modules/sales/dealers";
import { createManualOrder, type ManualOrderInput } from "@/modules/sales/orders";
import { addDays } from "@/modules/sales/rules";
import { checkInvariants, makeStaff, type TestActor } from "./_helpers";

const today = vnToday();
let owner: TestActor;
const ids = { pst: "", item: "", wh: {} as Record<string, string>, acc: {} as Record<string, string>, lot: "", stockLot: "", dealer: "", order1: "" };

function input(over: Partial<ManualOrderInput>): ManualOrderInput {
  return {
    channelCode: "FB",
    dealerId: null,
    recipientName: "Salon QA",
    phone: null,
    email: null,
    province: "Hà Nội",
    ward: "Phường Láng",
    addressLine: "12 Láng Hạ",
    customerNote: null,
    internalNote: null,
    lines: [{ productId: ids.pst, qty: 1 }],
    bundles: [],
    voucherCode: null,
    manualDiscount: 0,
    shippingFee: 0,
    platformFee: null,
    externalRef: null,
    paymentMethod: "cod",
    consentConfirmed: false,
    confirmNow: true,
    priceOverrideReason: null,
    ...over,
  };
}
async function walk(id: string, ...to: ("confirmed" | "packing" | "shipping" | "delivered")[]) {
  for (const s of to) expect(await changeOrderStatus(id, s, owner.id, null)).toEqual({ ok: true });
}
async function stock() {
  return (await (await getDb()).select({ s: products.stock }).from(products).where(eq(products.id, ids.pst)))[0]!.s;
}

beforeAll(async () => {
  const db = await getDb();
  ({ owner } = await makeStaff("daily"));
  for (const w of await db.select().from(warehouses)) ids.wh[w.code] = w.id;
  for (const a of await db.select().from(cashAccounts)) ids.acc[a.code] = a.id;
  ids.pst = (await db.select().from(products).where(eq(products.code, "PST")))[0]!.id;
  await enableInventoryTracking(ids.pst, true, owner.id);
  ids.item = (await db.select().from(inventoryItems).where(eq(inventoryItems.productId, ids.pst)))[0]!.id;
  const [lot] = await db
    .insert(lots)
    .values({ lotNo: "PST-QA-DL", productId: ids.pst, formulaVersion: "v1", manufacturedOn: "2026-10-01", expiresOn: "2028-10-01", unitsProduced: 100, releaseStatus: "released", releasedAt: new Date() })
    .returning({ id: lots.id });
  ids.lot = lot!.id;
  const { postReceipt: pr } = { postReceipt };
  await db.transaction((t) => pr(t, { kind: "opening", warehouseId: ids.wh.FG!, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.item, qty: 100, lineCost: 100 * 56_757, productLotId: lot!.id }] }, owner.id));
  ids.stockLot = (await db.select().from(stockLots).where(eq(stockLots.productLotId, lot!.id)))[0]!.id;

  const pl = await savePriceList(null, { code: "DL-QA", name: "Giá đại lý QA", kind: "dealer", channelCode: null, validFrom: null, validTo: null, priority: 0, isActive: true, note: null }, owner);
  await upsertPriceListItem(pl, { productId: ids.pst, minQty: 1, unitPrice: 175_000 }, owner);
  const d = await createDealer(
    { name: "DL-001 QA", tier: "Vàng", contactName: null, phone: null, email: null, address: null, taxCode: null, contractNo: null, contractStart: null, contractEnd: null, priceListId: pl, discountBp: 0, commissionBp: 0, creditLimit: 5_000_000, paymentTermsDays: 15, customerId: null, note: null },
    owner,
  );
  ids.dealer = d.id;
  await updateChannel("SHP", { name: "Shopee", feeRateBp: 2150, payoutDays: 14, priceListId: null, isActive: true, sort: 2, note: null }, owner);
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("đại lý mua chịu (AC-TICHHOP-11)", { timeout: 60_000 }, () => {
  it("AC-TICHHOP-11: 20 chai 3.500.000đ tạo được; 10 chai bị chặn hạn mức; giao → phải thu hạn +15; thu 2.000.000 rồi 1.500.000 → partial, paid, đơn paid, 2 phiếu thu", async () => {
    const db = await getDb();
    const base = { channelCode: "DL", dealerId: ids.dealer, paymentMethod: "credit" as const };
    const r = await createManualOrder(input({ ...base, lines: [{ productId: ids.pst, qty: 20 }] }), owner);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    ids.order1 = r.orderId;
    expect(r.total).toBe(3_500_000);
    expect(await stock()).toBe(80);
    const over = await createManualOrder(input({ ...base, lines: [{ productId: ids.pst, qty: 10 }] }), owner);
    expect(over.ok === false && over.message).toMatch(/^Vượt hạn mức công nợ: còn 1\.500\.000/);
    expect(await stock()).toBe(80);

    await walk(r.orderId, "packing", "shipping", "delivered");
    const [ar] = await db.select().from(receivables).where(eq(receivables.orderId, r.orderId));
    expect(ar).toMatchObject({ amount: 3_500_000, dueOn: addDays(today, 15), dealerId: ids.dealer });
    // xuất kho đúng lô, 20 chai
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.type, "sale_issue"), eq(stockMovements.stockLotId, ids.stockLot)));
    expect(mv.reduce((s, m) => s + m.qty, 0)).toBe(-20);

    const p1 = await payDebt(db, { kind: "receivable", debtId: ar!.id, amount: 2_000_000, accountId: ids.acc.NH!, paidOn: today, expectedPaidAmount: 0 }, owner.id);
    expect(p1.status).toBe("partial");
    expect((await db.select().from(orders).where(eq(orders.id, r.orderId)))[0]!.paymentStatus).toBe("unpaid");
    const p2 = await payDebt(db, { kind: "receivable", debtId: ar!.id, amount: 1_500_000, accountId: ids.acc.NH!, paidOn: today, expectedPaidAmount: 2_000_000 }, owner.id);
    expect(p2.status).toBe("paid");
    expect((await db.select().from(orders).where(eq(orders.id, r.orderId)))[0]!.paymentStatus).toBe("paid");
    const pays = await db.select().from(debtPayments).where(eq(debtPayments.receivableId, ar!.id));
    expect(pays).toHaveLength(2);
    const cash = await db.select().from(cashTransactions).where(and(eq(cashTransactions.direction, "in"), eq(cashTransactions.accountId, ids.acc.NH!)));
    expect(cash.filter((c) => pays.some((p) => p.cashTransactionId === c.id)).map((c) => c.amount).sort()).toEqual([1_500_000, 2_000_000]);
    // trả thêm 1đ → lỗi
    await expect(payDebt(db, { kind: "receivable", debtId: ar!.id, amount: 1, accountId: ids.acc.NH!, paidOn: today, expectedPaidAmount: 3_500_000 }, owner.id)).rejects.toThrow();
  });
});

describe("đơn sàn nhập tay (AC-TICHHOP-12)", { timeout: 60_000 }, () => {
  it("AC-TICHHOP-12: SHP 2711ABC 1 chai → phí 49.235đ, giao → phải thu kênh 179.765đ hạn +14; nhập lại cùng mã bị chặn, kho không trừ lần hai", async () => {
    const db = await getDb();
    const shp = input({ channelCode: "SHP", paymentMethod: "platform", externalRef: "2711ABC", lines: [{ productId: ids.pst, qty: 1 }] });
    const r = await createManualOrder(shp, owner);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await db.select().from(orders).where(eq(orders.id, r.orderId)))[0]!.platformFee).toBe(49_235);
    const s = await stock();
    const again = await createManualOrder(shp, owner);
    expect(again.ok === false && again.message).toMatch(/^Đơn sàn 2711ABC đã có \(/);
    expect(await stock()).toBe(s);
    await walk(r.orderId, "packing", "shipping", "delivered");
    const [ar] = await db.select().from(receivables).where(eq(receivables.orderId, r.orderId));
    expect(ar).toMatchObject({ party: "channel", channelCode: "SHP", amount: 179_765, dueOn: addDays(today, 14) });
  });
});

describe("gán lô tay trên sản phẩm quản lý kho (AC-BH-13)", { timeout: 60_000 }, () => {
  it("AC-BH-13: assignLot bị từ chối với sản phẩm đang quản lý kho (lô lấy từ xuất kho)", async () => {
    const db = await getDb();
    const r = await createManualOrder(input({ phone: "0901999888", consentConfirmed: true, lines: [{ productId: ids.pst, qty: 1 }] }), owner);
    if (!r.ok) throw new Error(r.message);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId));
    const res = await assignLot(item!.id, ids.lot, owner.id);
    expect(res.ok).toBe(false);
    expect((await db.select().from(orderItems).where(eq(orderItems.id, item!.id)))[0]!.lotId).toBeNull();
    await walk(r.orderId, "packing", "shipping", "delivered");
    expect((await db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId)))[0]!.lotId).toBe(ids.lot);
  });
});

describe("sản phẩm không quản lý kho giữ hành vi cũ (AC-TICHHOP-21)", { timeout: 60_000 }, () => {
  it("AC-TICHHOP-21: PSH không bật quản lý kho: đặt trừ products.stock, gán lô tay được, giao không sinh biến động kho", async () => {
    const db = await getDb();
    const [psh] = await db.select().from(products).where(eq(products.code, "PSH"));
    expect(psh!.trackInventory).toBe(false);
    await db.update(products).set({ status: "active", stock: 20 }).where(eq(products.id, psh!.id));
    psh!.stock = 20;
    const before = psh!.stock;
    const mvBefore = (await db.select().from(stockMovements)).length;
    const r = await createManualOrder(input({ phone: "0901999777", consentConfirmed: true, lines: [{ productId: psh!.id, qty: 1 }] }), owner);
    if (!r.ok) throw new Error(r.message);
    expect((await db.select().from(products).where(eq(products.id, psh!.id)))[0]!.stock).toBe(before - 1);
    const [lot] = await db
      .insert(lots)
      .values({ lotNo: "PSH-QA-01", productId: psh!.id, formulaVersion: "v1", manufacturedOn: "2026-10-01", expiresOn: "2028-10-01", unitsProduced: 10, releaseStatus: "released", releasedAt: new Date() })
      .returning({ id: lots.id });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId));
    expect((await assignLot(item!.id, lot!.id, owner.id)).ok).toBe(true);
    await walk(r.orderId, "packing", "shipping", "delivered");
    expect((await db.select().from(stockMovements)).length).toBe(mvBefore);
    expect((await db.select().from(orderItems).where(eq(orderItems.id, item!.id)))[0]!.lotId).toBe(lot!.id);
  });

  it("BUG-6: đơn sản phẩm chưa quản lý kho, sau khi bấm Đã đóng gói vẫn nằm ở hàng Chờ đóng gói (đồng thời ở Đã gói), trang đóng gói vẫn cho bấm lại", async () => {
    const db = await getDb();
    const [psh] = await db.select().from(products).where(eq(products.code, "PSH"));
    const r = await createManualOrder(input({ phone: "0901999666", consentConfirmed: true, lines: [{ productId: psh!.id, qty: 1 }] }), owner);
    if (!r.ok) throw new Error(r.message);
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId));
    expect(await packOrder(r.orderId, { checkedItemIds: items.map((i) => i.id) }, owner.id)).toEqual({ ok: true });
    expect((await listPackedAwaitingShipment()).some((o) => o.id === r.orderId)).toBe(true);
    expect((await listPackingQueue()).some((o) => o.id === r.orderId)).toBe(false);
  });
});

describe("bấm hai lần khi trả nợ (AC-TC-9, AC-TICHHOP-17)", { timeout: 60_000 }, () => {
  async function newPayable(amount: number) {
    const db = await getDb();
    const [sup] = await db.insert(suppliers).values({ code: `NCC-QA-${amount}`, name: "NCC bao bì QA", kind: "packaging", paymentTermsDays: 30 }).returning({ id: suppliers.id });
    const [cat] = await db.select().from(financeCategories).where(eq(financeCategories.direction, "out")).limit(1);
    const [p] = await db
      .insert(payables)
      .values({ code: `PT-QA-${amount}`, supplierId: sup!.id, categoryId: cat!.id, sourceType: "manual", amount, dueOn: addDays(today, 30), issuedOn: today } as typeof payables.$inferInsert)
      .returning({ id: payables.id });
    return p!.id;
  }

  it("trả đủ số còn nợ, gọi hai lần đồng thời → chỉ một lần ghi (lần hai bị chặn)", async () => {
    const db = await getDb();
    const id = await newPayable(4_500_000);
    const res = await Promise.allSettled([
      payDebt(db, { kind: "payable", debtId: id, amount: 4_500_000, accountId: ids.acc.NH!, paidOn: today, expectedPaidAmount: 0 }, owner.id),
      payDebt(db, { kind: "payable", debtId: id, amount: 4_500_000, accountId: ids.acc.NH!, paidOn: today, expectedPaidAmount: 0 }, owner.id),
    ]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await db.select().from(payables).where(eq(payables.id, id)))[0]!.paidAmount).toBe(4_500_000);
  });

  it("BUG-5 AC-TC-9: trả một phần 2.000.000đ, form gửi hai lần (đọc cũ) → paid_amount phải chỉ cộng một lần (hiện cộng 4.000.000đ, 2 phiếu chi)", async () => {
    const db = await getDb();
    const id = await newPayable(4_500_001);
    // Hai lần gửi cùng một form: cùng mang số đã trả đọc lúc mở trang (0đ), như payDebtAction gửi
    await Promise.allSettled([
      payDebt(db, { kind: "payable", debtId: id, amount: 2_000_000, accountId: ids.acc.NH!, paidOn: today, expectedPaidAmount: 0 }, owner.id),
      payDebt(db, { kind: "payable", debtId: id, amount: 2_000_000, accountId: ids.acc.NH!, paidOn: today, expectedPaidAmount: 0 }, owner.id),
    ]);
    expect((await db.select().from(payables).where(eq(payables.id, id)))[0]!.paidAmount).toBe(2_000_000);
  });

  it("bất biến INV-1…INV-8 sau các luồng trên", async () => {
    expect(await checkInvariants({ productLotIds: [ids.lot] })).toEqual([]);
  });
});
