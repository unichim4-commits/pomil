import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-sales-flow-"));
process.env.PGLITE_DIR = dir;

import { and, eq, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import {
  cashTransactions,
  complaints,
  financeCategories,
  inventoryItems,
  lots,
  orderEvents,
  orderItems,
  orders,
  products,
  receivables,
  returnRequests,
  staffUsers,
  stockBalances,
  stockLots,
  vouchers,
  warehouses,
} from "@/db/schema";
import { enableInventoryTracking, postReceipt } from "@/modules/inventory/ledger";
import { vnToday } from "@/modules/numbering/rules";
import { changeOrderStatus, deliverOnSpot, packOrder, recordDeliveryFailed } from "@/modules/orders/service";
import { setLotHold } from "@/modules/quality/admin";
import type { Actor } from "@/modules/sales/access";
import { saveBundle, saveVoucher } from "@/modules/sales/catalog";
import { createDealer } from "@/modules/sales/dealers";
import { createManualOrder, type ManualOrderInput } from "@/modules/sales/orders";
import { getPackingView } from "@/modules/sales/packing";
import { getSalesReport } from "@/modules/sales/reports";
import { approveReturn, completeReturn, createComplaintFromReturn, createReturnRequest, getReturn, receiveReturn } from "@/modules/sales/returns";
import { addDays } from "@/modules/sales/rules";

const today = vnToday();
const owner: Actor = { id: "", role: "owner" };
const collab: Actor = { id: "", role: "collaborator" };
const ids = { pst: "", item: "", wh: {} as Record<string, string>, lot: {} as Record<string, string>, stockLot: {} as Record<string, string>, bundle: "" };

function input(over: Partial<ManualOrderInput>): ManualOrderInput {
  return {
    channelCode: "FB",
    dealerId: null,
    recipientName: "Chị Lan",
    phone: "0901234567",
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
    consentConfirmed: true,
    confirmNow: true,
    priceOverrideReason: null,
    ...over,
  };
}
async function create(over: Partial<ManualOrderInput> = {}) {
  const r = await createManualOrder(input(over), owner);
  if (!r.ok) throw new Error(r.message);
  return r;
}
async function tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await getDb()).transaction(fn);
}
async function stock() {
  const db = await getDb();
  return (await db.select({ s: products.stock }).from(products).where(eq(products.id, ids.pst)))[0]!.s;
}
async function whQty(code: "FG" | "REJ", stockLotId?: string) {
  const db = await getDb();
  const [row] = await db
    .select({ q: sql<number>`coalesce(sum(${stockBalances.qty}),0)::int` })
    .from(stockBalances)
    .where(and(eq(stockBalances.warehouseId, ids.wh[code]!), eq(stockBalances.itemId, ids.item), stockLotId ? eq(stockBalances.stockLotId, stockLotId) : undefined));
  return Number(row?.q ?? 0);
}
async function orderOf(id: string) {
  const db = await getDb();
  return (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
}
async function itemsOf(id: string) {
  const db = await getDb();
  return db.select().from(orderItems).where(eq(orderItems.orderId, id));
}
async function packAll(id: string, picks?: { orderItemId: string; stockLotId: string; qty: number }[]) {
  const items = await itemsOf(id);
  return packOrder(id, { checkedItemIds: items.map((i) => i.id), picks }, owner.id);
}
async function ship(id: string) {
  expect(await changeOrderStatus(id, "shipping", owner.id, null)).toEqual({ ok: true });
}
async function deliver(id: string) {
  expect(await changeOrderStatus(id, "delivered", owner.id, null)).toEqual({ ok: true });
}
async function newLot(lotNo: string, expiresOn: string, units: number) {
  const db = await getDb();
  const [row] = await db
    .insert(lots)
    .values({ lotNo, productId: ids.pst, formulaVersion: "v1", manufacturedOn: "2026-10-01", expiresOn, unitsProduced: units, releaseStatus: "released" })
    .returning({ id: lots.id });
  await tx((t) =>
    postReceipt(t, { kind: "opening", warehouseId: ids.wh.FG!, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.item, qty: units, lineCost: units * 65_000, productLotId: row!.id }] }, owner.id),
  );
  const [sl] = await db.select().from(stockLots).where(eq(stockLots.productLotId, row!.id));
  ids.lot[lotNo] = row!.id;
  ids.stockLot[lotNo] = sl!.id;
}
async function cashByKey(key: string) {
  const db = await getDb();
  return db.select().from(cashTransactions).where(eq(cashTransactions.idempotencyKey, key));
}

beforeAll(async () => {
  const db = await getDb();
  for (const [role, a] of [["owner", owner], ["collaborator", collab]] as const) {
    const [s] = await db.insert(staffUsers).values({ email: `${role}@test.vn`, role, passwordHash: "x" }).returning({ id: staffUsers.id });
    a.id = s!.id;
  }
  ids.pst = (await db.select().from(products).where(eq(products.code, "PST")))[0]!.id;
  for (const w of await db.select().from(warehouses)) ids.wh[w.code] = w.id;
  // Bật quản lý kho trước (tạo hàng thành phẩm), rồi nhập các lô
  await enableInventoryTracking(ids.pst, true, owner.id);
  ids.item = (await db.select().from(inventoryItems).where(eq(inventoryItems.productId, ids.pst)))[0]!.id;
  await newLot("PST-A", addDays(today, 200), 2);
  await newLot("PST-B", addDays(today, 400), 50);
  await newLot("PST-C", addDays(today, 600), 30);
  ids.bundle = await saveBundle(null, { code: "BO2", name: "Bộ 2 Tonic", price: 399_000, channelCode: null, isActive: true, note: null, items: [{ productId: ids.pst, qty: 2 }] }, owner);
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Đóng gói và giao (sản phẩm quản lý kho)", () => {
  it("bật quản lý kho: số bán được = tồn FG", async () => {
    expect(await stock()).toBe(82);
  });

  it("AC-BH-12: gợi ý A 2, B 1; chưa tích đủ → lỗi; tích đủ → packing, tách 2 dòng, event packed", async () => {
    const r = await create({ lines: [{ productId: ids.pst, qty: 3 }] });
    const view = await getPackingView(r.orderId);
    expect(view!.lines[0]!.suggestion!.map((p) => [p.code, p.qty])).toEqual([
      ["PST-A", 2],
      ["PST-B", 1],
    ]);
    const bad = await packOrder(r.orderId, { checkedItemIds: [] }, owner.id);
    expect(bad.ok).toBe(false);
    expect((await orderOf(r.orderId)).status).toBe("confirmed");
    expect(await packAll(r.orderId)).toEqual({ ok: true });
    const o = await orderOf(r.orderId);
    expect(o.status).toBe("packing");
    expect(o.stockIssuedAt).not.toBeNull();
    const items = await itemsOf(r.orderId);
    expect(items.map((i) => [i.lotId, i.quantity]).sort((a, b) => Number(b[1]) - Number(a[1]))).toEqual([
      [ids.lot["PST-A"], 2],
      [ids.lot["PST-B"], 1],
    ]);
    const db = await getDb();
    expect(await db.select().from(orderEvents).where(and(eq(orderEvents.orderId, r.orderId), eq(orderEvents.type, "packed")))).toHaveLength(1);
  });

  it("AC-BH-14: packing chưa xuất → shipping tự xuất FEFO; lô bị giữ hết → không đổi trạng thái", async () => {
    const r = await create();
    expect(await changeOrderStatus(r.orderId, "packing", owner.id, null)).toEqual({ ok: true });
    expect((await orderOf(r.orderId)).stockIssuedAt).toBeNull();
    await ship(r.orderId);
    const o = await orderOf(r.orderId);
    expect(o.status).toBe("shipping");
    expect(o.stockIssuedAt).not.toBeNull();

    const r2 = await create();
    expect(await changeOrderStatus(r2.orderId, "packing", owner.id, null)).toEqual({ ok: true });
    await setLotHold(ids.lot["PST-B"]!, true, "Thử giữ", owner.id);
    await setLotHold(ids.lot["PST-C"]!, true, "Thử giữ", owner.id);
    const blocked = await changeOrderStatus(r2.orderId, "shipping", owner.id, null);
    expect(blocked.ok).toBe(false);
    expect((await orderOf(r2.orderId)).status).toBe("packing");
    expect((await orderOf(r2.orderId)).stockIssuedAt).toBeNull();
    await setLotHold(ids.lot["PST-B"]!, false, null, owner.id);
    await setLotHold(ids.lot["PST-C"]!, false, null, owner.id);
    await ship(r2.orderId);
  });

  it("AC-BH-15: đơn TT giao tại chỗ, đã thu → delivered, phiếu thu tiền mặt", async () => {
    const r = await create({ channelCode: "TT", phone: null, recipientName: "", province: "", ward: "", addressLine: "", paymentMethod: "cash", consentConfirmed: false, confirmNow: false });
    expect(await deliverOnSpot(r.orderId, owner.id, { paidNow: true })).toEqual({ ok: true });
    const o = await orderOf(r.orderId);
    expect(o).toMatchObject({ status: "delivered", paymentStatus: "paid" });
    expect(o.stockIssuedAt).not.toBeNull();
    const db = await getDb();
    const statusEvents = await db.select().from(orderEvents).where(and(eq(orderEvents.orderId, r.orderId), eq(orderEvents.type, "status")));
    expect(statusEvents.length).toBeGreaterThanOrEqual(3);
    const cash = await cashByKey(`order-paid:${r.orderId}`);
    expect(cash).toHaveLength(1);
    expect(cash[0]!.amount).toBe(229_000);
  });

  it("AC-BH-16: hủy đơn đã xuất → đảo kho, bỏ lô, stock về như trước (không cộng hai lần), voucher −1", async () => {
    await saveVoucher(null, { code: "HUY5", kind: "amount", value: 5_000, minOrder: 0, maxDiscount: null, channelCode: null, validFrom: null, validTo: null, usageLimit: null, isActive: true }, owner);
    const before = await stock();
    const r = await create({ voucherCode: "HUY5" });
    expect(await stock()).toBe(before - 1);
    expect(await packAll(r.orderId)).toEqual({ ok: true });
    expect(await changeOrderStatus(r.orderId, "cancelled", owner.id, "Khách đổi ý")).toEqual({ ok: true });
    const o = await orderOf(r.orderId);
    expect(o.stockIssuedAt).toBeNull();
    expect((await itemsOf(r.orderId)).every((i) => i.lotId === null)).toBe(true);
    expect(await stock()).toBe(before);
    const db = await getDb();
    expect((await db.select().from(vouchers).where(eq(vouchers.code, "HUY5")))[0]!.usedCount).toBe(0);
  });

  it("AC-BH-17: giao thất bại vẫn shipping; hoàn về chai 1 nhập lại, chai 2 cách ly", async () => {
    const r = await create({ lines: [{ productId: ids.pst, qty: 2 }] });
    const [it] = await itemsOf(r.orderId);
    expect(await packAll(r.orderId, [
      { orderItemId: it!.id, stockLotId: ids.stockLot["PST-B"]!, qty: 1 },
      { orderItemId: it!.id, stockLotId: ids.stockLot["PST-C"]!, qty: 1 },
    ])).toEqual({ ok: true });
    await ship(r.orderId);
    expect(await recordDeliveryFailed(r.orderId, "Khách không nghe máy", owner.id)).toEqual({ ok: true });
    expect((await orderOf(r.orderId)).status).toBe("shipping");
    const items = await itemsOf(r.orderId);
    expect(items).toHaveLength(2);
    const lineB = items.find((i) => i.lotId === ids.lot["PST-B"])!;
    const lineC = items.find((i) => i.lotId === ids.lot["PST-C"])!;
    const fgB = await whQty("FG", ids.stockLot["PST-B"]);
    const rej = await whQty("REJ");
    const s = await stock();
    const res = await changeOrderStatus(r.orderId, "returned", owner.id, "Hoàn về", {
      returnLines: [
        { orderItemId: lineB.id, disposition: "restock" },
        { orderItemId: lineC.id, disposition: "quarantine" },
      ],
    });
    expect(res).toEqual({ ok: true });
    expect(await whQty("FG", ids.stockLot["PST-B"])).toBe(fgB + 1);
    expect(await whQty("REJ")).toBe(rej + 1);
    expect(await stock()).toBe(s + 1);
    expect(await orderOf(r.orderId)).toMatchObject({ status: "returned", returnType: "delivery_failed" });
  });
});

describe("Đổi trả", () => {
  let ret = "";
  let comboOrder = "";

  it("AC-BH-23: đơn 2 chai (chiết khấu 59.000) đã thu: trả 1 chai gợi ý 199.500; trả 3 → lỗi", async () => {
    const r = await create({ lines: [], bundles: [{ bundleId: ids.bundle, qty: 1 }] });
    comboOrder = r.orderId;
    expect(await packAll(r.orderId)).toEqual({ ok: true });
    await ship(r.orderId);
    await deliver(r.orderId);
    expect((await orderOf(r.orderId)).paymentStatus).toBe("paid");
    const items = await itemsOf(r.orderId);
    const first = items[0]!;
    const total = items.reduce((s, i) => s + i.quantity, 0);
    expect(total).toBe(2);
    const tooMany = await createReturnRequest({ orderId: r.orderId, reason: "defect", reasonNote: "Vòi bơm hỏng", resolution: "refund", lines: items.map((i) => ({ orderItemId: i.id, qty: i.quantity + 1 })), refundAmount: null, extraCost: 0, note: null }, collab);
    expect(tooMany.ok === false && tooMany.message).toMatch(/vượt số đã giao/);
    const created = await createReturnRequest({ orderId: r.orderId, reason: "defect", reasonNote: "Vòi bơm hỏng", resolution: "refund", lines: [{ orderItemId: first.id, qty: 1 }], refundAmount: null, extraCost: 0, note: null }, collab);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.refundAmount).toBe(199_500);
    ret = created.id;
  });

  it("AC-BH-24: nhận hàng lỗi bắt buộc cách ly; cộng tác viên hoàn tiền → lỗi quyền; chủ → phiếu chi rma-refund", async () => {
    expect(await approveReturn(ret, collab)).toEqual({ ok: true });
    const view = await getReturn(ret);
    const lineId = view!.lines[0]!.line.id;
    const wrong = await receiveReturn(ret, [{ lineId, condition: "defective", disposition: "restock" }], collab);
    expect(wrong.ok).toBe(false);
    const rej = await whQty("REJ");
    const s = await stock();
    expect(await receiveReturn(ret, [{ lineId, condition: "defective", disposition: "quarantine" }], collab)).toEqual({ ok: true });
    expect(await whQty("REJ")).toBe(rej + 1);
    expect(await stock()).toBe(s);
    const db = await getDb();
    expect((await db.select().from(returnRequests).where(eq(returnRequests.id, ret)))[0]!.receiptId).not.toBeNull();

    const denied = await completeReturn(ret, {}, collab);
    expect(denied.ok).toBe(false);
    expect(await completeReturn(ret, {}, owner)).toMatchObject({ ok: true });
    const cash = await cashByKey(`rma-refund:${ret}`);
    expect(cash).toHaveLength(1);
    expect(cash[0]!.amount).toBe(199_500);
    expect((await orderOf(comboOrder)).status).toBe("delivered");
  });

  it("AC-BH-29: đổi trả lỗi sản phẩm → tạo phản ánh gắn lô", async () => {
    const r = await createComplaintFromReturn(ret, owner);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const db = await getDb();
    const [c] = await db.select().from(complaints).where(eq(complaints.id, r.complaintId));
    expect(c).toBeTruthy();
    expect((await db.select().from(returnRequests).where(eq(returnRequests.id, ret)))[0]!.complaintId).toBe(r.complaintId);
  });

  it("AC-BH-25, AC-BH-27: trả đủ đơn → returned/refunded, chỉ phiếu chi đổi trả; restock +1; chi phí phát sinh CHI-VAN-CHUYEN", async () => {
    const r = await create();
    expect(await packAll(r.orderId)).toEqual({ ok: true });
    await ship(r.orderId);
    await deliver(r.orderId);
    const [item] = await itemsOf(r.orderId);
    const lotBefore = item!.lotId;
    const c = await createReturnRequest({ orderId: r.orderId, reason: "changed_mind", reasonNote: "Không hợp mùi", resolution: "refund", lines: [{ orderItemId: item!.id, qty: 1 }], refundAmount: null, extraCost: 30_000, note: null }, owner);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(await approveReturn(c.id, owner)).toEqual({ ok: true });
    const view = await getReturn(c.id);
    const s = await stock();
    const fg = await whQty("FG");
    expect(await receiveReturn(c.id, [{ lineId: view!.lines[0]!.line.id, condition: "intact", disposition: "restock" }], owner)).toEqual({ ok: true });
    expect(await stock()).toBe(s + 1);
    expect(await whQty("FG")).toBe(fg + 1);
    expect(await completeReturn(c.id, {}, owner)).toMatchObject({ ok: true });
    expect(await stock()).toBe(s + 1);
    expect(await orderOf(r.orderId)).toMatchObject({ status: "returned", returnType: "customer_return", paymentStatus: "refunded" });
    expect(await cashByKey(`order-refund:${r.orderId}`)).toHaveLength(0);
    expect((await cashByKey(`rma-refund:${c.id}`))[0]!.amount).toBe(229_000);
    const cost = await cashByKey(`rma-cost:${c.id}`);
    expect(cost[0]!.amount).toBe(30_000);
    const db = await getDb();
    const [cat] = await db.select().from(financeCategories).where(eq(financeCategories.id, cost[0]!.categoryId!));
    expect(cat!.code).toBe("CHI-VAN-CHUYEN");
    expect((await itemsOf(r.orderId))[0]!.lotId).toBe(lotBefore);
  });

  it("AC-BH-26: đơn đại lý mua chịu đã giao, chưa trả: hoàn giảm khoản phải thu, không phiếu chi", async () => {
    const d = await createDealer(
      { name: "Salon Hồng", tier: "", contactName: null, phone: null, email: null, address: null, taxCode: null, contractNo: null, contractStart: null, contractEnd: null, priceListId: null, discountBp: 0, commissionBp: 500, creditLimit: 20_000_000, paymentTermsDays: 30, customerId: null, note: null },
      owner,
    );
    const r = await create({ channelCode: "DL", dealerId: d.id, paymentMethod: "credit", phone: null, consentConfirmed: false, lines: [{ productId: ids.pst, qty: 2 }] });
    expect(await packAll(r.orderId)).toEqual({ ok: true });
    await ship(r.orderId);
    await deliver(r.orderId);
    const db = await getDb();
    expect((await db.select().from(receivables).where(eq(receivables.orderId, r.orderId)))[0]!.amount).toBe(458_000);
    const items = await itemsOf(r.orderId);
    const c = await createReturnRequest({ orderId: r.orderId, reason: "damaged", reasonNote: "Vỡ nắp", resolution: "refund", lines: [{ orderItemId: items[0]!.id, qty: 1 }], refundAmount: 175_000, extraCost: 0, note: null }, owner);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    await approveReturn(c.id, owner);
    const view = await getReturn(c.id);
    expect(await receiveReturn(c.id, [{ lineId: view!.lines[0]!.line.id, condition: "damaged", disposition: "quarantine" }], owner)).toEqual({ ok: true });
    expect(await completeReturn(c.id, {}, owner)).toMatchObject({ ok: true });
    expect((await db.select().from(receivables).where(eq(receivables.orderId, r.orderId)))[0]!.amount).toBe(283_000);
    expect(await cashByKey(`rma-refund:${c.id}`)).toHaveLength(0);
  });

  it("AC-BH-28: đổi hàng → đơn mới cùng kênh miễn tiền hàng, giữ hàng", async () => {
    const r = await create();
    expect(await packAll(r.orderId)).toEqual({ ok: true });
    await ship(r.orderId);
    await deliver(r.orderId);
    const [item] = await itemsOf(r.orderId);
    const c = await createReturnRequest({ orderId: r.orderId, reason: "wrong_item", reasonNote: "Giao nhầm", resolution: "exchange", lines: [{ orderItemId: item!.id, qty: 1 }], refundAmount: null, extraCost: 0, note: null }, owner);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    await approveReturn(c.id, owner);
    const view = await getReturn(c.id);
    await receiveReturn(c.id, [{ lineId: view!.lines[0]!.line.id, condition: "intact", disposition: "restock" }], owner);
    const before = await stock();
    const done = await completeReturn(c.id, { exchangeLines: [{ productId: ids.pst, qty: 1 }] }, owner);
    expect(done.ok).toBe(true);
    const db = await getDb();
    const [rr] = await db.select().from(returnRequests).where(eq(returnRequests.id, c.id));
    expect(rr!.replacementOrderId).not.toBeNull();
    const repl = await orderOf(rr!.replacementOrderId!);
    expect(repl.channel).toBe("FB");
    expect(repl.discountTotal).toBe(repl.subtotal);
    expect(repl.total).toBe(repl.shippingFee);
    expect(await stock()).toBe(before - 1);
  });
});

describe("AC-BH-32: báo cáo", () => {
  it("doanh số không tính hủy/hoàn, có tỷ lệ thành công; không có quyền tài chính thì không có lợi nhuận góp", async () => {
    const rep = await getSalesReport({ from: addDays(today, -1), toExclusive: addDays(today, 1), granularity: "week", withCost: false });
    expect(rep.margin).toBeNull();
    expect(rep.summary.orders).toBeGreaterThan(0);
    expect(rep.successRate).not.toBeNull();
    const db = await getDb();
    const all = await db.select().from(orders);
    const counted = all.filter((o) => o.status !== "cancelled" && o.status !== "returned");
    expect(rep.summary.revenue).toBe(counted.reduce((s, o) => s + o.subtotal - o.discountTotal, 0));
    const withCost = await getSalesReport({ from: addDays(today, -1), toExclusive: addDays(today, 1), granularity: "day", withCost: true });
    expect(withCost.margin).not.toBeNull();
    expect(withCost.dealerCommissions.length).toBeGreaterThan(0);
  });
});
