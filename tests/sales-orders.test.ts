import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-sales-orders-"));
process.env.PGLITE_DIR = dir;

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cashAccounts, cashTransactions, consents, customers, dealers, orderEvents, orders, products, receivables, salesChannels, staffUsers, touchpoints, vouchers } from "@/db/schema";
import { addCareNote, addCustomerTag, getCustomerCrm } from "@/modules/customers/admin";
import { changeOrderStatus, setPaymentStatus } from "@/modules/orders/service";
import type { Actor } from "@/modules/sales/access";
import { saveBundle, savePriceList, saveVoucher, updateChannel, upsertPriceListItem } from "@/modules/sales/catalog";
import { createDealer } from "@/modules/sales/dealers";
import { createManualOrder, type ManualOrderInput, quoteManualOrder, updatePlatformFee } from "@/modules/sales/orders";
import { addDays, isoDateVn } from "@/modules/sales/rules";
import { vnToday } from "@/modules/numbering/rules";

const owner: Actor = { id: "", role: "owner" };
const collab: Actor = { id: "", role: "collaborator" };
const viewer: Actor = { id: "", role: "viewer" };
const pid: Record<string, string> = {};

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
    lines: [],
    bundles: [],
    voucherCode: null,
    manualDiscount: 0,
    shippingFee: 0,
    platformFee: null,
    externalRef: null,
    paymentMethod: "cod",
    consentConfirmed: true,
    confirmNow: false,
    priceOverrideReason: null,
    ...over,
  };
}
async function stockOf(code: string) {
  const db = await getDb();
  return (await db.select({ s: products.stock }).from(products).where(eq(products.code, code)))[0]!.s;
}
async function orderOf(id: string) {
  const db = await getDb();
  return (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
}
async function walk(id: string, ...to: ("confirmed" | "packing" | "shipping" | "delivered")[]) {
  for (const s of to) {
    const r = await changeOrderStatus(id, s, owner.id, null);
    expect(r).toEqual({ ok: true });
  }
}
async function newDealer(name: string, over: Partial<Parameters<typeof createDealer>[0]> = {}) {
  return createDealer(
    {
      name,
      tier: "Vàng",
      contactName: null,
      phone: null,
      email: null,
      address: null,
      taxCode: null,
      contractNo: null,
      contractStart: null,
      contractEnd: null,
      priceListId: null,
      discountBp: 0,
      commissionBp: 0,
      creditLimit: 0,
      paymentTermsDays: 0,
      customerId: null,
      note: null,
      ...over,
    },
    owner,
  );
}

beforeAll(async () => {
  const db = await getDb();
  for (const [role, a] of [["owner", owner], ["collaborator", collab], ["viewer", viewer]] as const) {
    const [s] = await db.insert(staffUsers).values({ email: `${role}@test.vn`, role, passwordHash: "x" }).returning({ id: staffUsers.id });
    a.id = s!.id;
  }
  for (const p of await db.select().from(products)) pid[p.code] = p.id;
  await db.update(products).set({ stock: 1000 }).where(eq(products.code, "PST"));
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("AC-BH-1, AC-BH-7: kênh và đơn tay", () => {
  it("WEB không tạo đơn tay; kênh FB tắt → 'Kênh đang tắt'", async () => {
    const web = await createManualOrder(input({ channelCode: "WEB", lines: [{ productId: pid.PST!, qty: 1 }] }), owner);
    expect(web.ok).toBe(false);
    await expect(updateChannel("WEB", { name: "Website", feeRateBp: 0, payoutDays: 0, priceListId: null, isActive: false, sort: 1, note: null }, owner)).rejects.toThrow();
    await updateChannel("FB", { name: "Facebook", feeRateBp: 0, payoutDays: 0, priceListId: null, isActive: false, sort: 4, note: null }, owner);
    const r = await createManualOrder(input({ lines: [{ productId: pid.PST!, qty: 1 }] }), owner);
    expect(r).toEqual({ ok: false, message: "Kênh đang tắt" });
    await updateChannel("FB", { name: "Facebook", feeRateBp: 0, payoutDays: 0, priceListId: null, isActive: true, sort: 4, note: null }, owner);
  });

  it("đơn TT tiền mặt không số, không địa chỉ: mã TT-YYMM-0001, không khách, trừ kho", async () => {
    const before = await stockOf("PST");
    const r = await createManualOrder(
      input({ channelCode: "TT", phone: null, recipientName: "", province: "", ward: "", addressLine: "", paymentMethod: "cash", consentConfirmed: false, lines: [{ productId: pid.PST!, qty: 1 }] }),
      collab,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).toMatch(/^TT-\d{4}-0001$/);
    const o = await orderOf(r.orderId);
    expect(o.customerId).toBeNull();
    expect(o.createdBy).toBe(collab.id);
    expect(await stockOf("PST")).toBe(before - 1);
  });

  it("SHP thanh toán cod → 'Đơn sàn dùng thanh toán qua sàn'", async () => {
    const r = await createManualOrder(input({ channelCode: "SHP", externalRef: "X1", lines: [{ productId: pid.PST!, qty: 1 }] }), owner);
    expect(r).toEqual({ ok: false, message: "Đơn sàn dùng thanh toán qua sàn" });
  });
});

describe("AC-BH-2, AC-BH-3: giá", () => {
  it("bảng giá đại lý, khuyến mãi, giá lẻ", async () => {
    const today = vnToday();
    const dl = await savePriceList(null, { code: "DL-SI", name: "Giá đại lý", kind: "dealer", channelCode: null, validFrom: null, validTo: null, priority: 0, isActive: true, note: null }, owner);
    await upsertPriceListItem(dl, { productId: pid.PST!, minQty: 1, unitPrice: 175_000 }, owner);
    await upsertPriceListItem(dl, { productId: pid.PST!, minQty: 50, unitPrice: 165_000 }, owner);
    const km = await savePriceList(null, { code: "KM-11", name: "Khuyến mãi", kind: "promo", channelCode: null, validFrom: today, validTo: addDays(today, 3), priority: 1, isActive: true, note: null }, owner);
    await upsertPriceListItem(km, { productId: pid.PST!, minQty: 1, unitPrice: 199_000 }, owner);
    const dealer = await newDealer("Salon Mai", { priceListId: dl, creditLimit: 50_000_000 });

    const price = async (over: Partial<ManualOrderInput>) => {
      const q = await quoteManualOrder(input(over), owner);
      if (!q.ok) throw new Error(q.message);
      return q.priced.lines[0]!.unitPrice;
    };
    const dlInput = { channelCode: "DL", dealerId: dealer.id, paymentMethod: "credit" as const };
    expect(await price({ ...dlInput, lines: [{ productId: pid.PST!, qty: 20 }] })).toBe(175_000);
    expect(await price({ ...dlInput, lines: [{ productId: pid.PST!, qty: 60 }] })).toBe(165_000);
    expect(await price({ lines: [{ productId: pid.PST!, qty: 1 }] })).toBe(199_000);
    await savePriceList(km, { code: "KM-11", name: "Khuyến mãi", kind: "promo", channelCode: null, validFrom: addDays(today, -10), validTo: addDays(today, -1), priority: 1, isActive: true, note: null }, owner);
    expect(await price({ lines: [{ productId: pid.PST!, qty: 1 }] })).toBe(229_000);
  });

  it("cộng tác viên sửa đơn giá → lỗi quyền; chủ có lý do → được, có event", async () => {
    const bad = await createManualOrder(input({ lines: [{ productId: pid.PST!, qty: 1, unitPrice: 200_000 }], priceOverrideReason: "Khách quen" }), collab);
    expect(bad.ok).toBe(false);
    const noReason = await createManualOrder(input({ lines: [{ productId: pid.PST!, qty: 1, unitPrice: 200_000 }] }), owner);
    expect(noReason.ok).toBe(false);
    const good = await createManualOrder(input({ lines: [{ productId: pid.PST!, qty: 1, unitPrice: 200_000 }], priceOverrideReason: "Khách quen" }), owner);
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.total).toBe(200_000);
    const db = await getDb();
    const ev = await db.select().from(orderEvents).where(and(eq(orderEvents.orderId, good.orderId), eq(orderEvents.type, "price_override")));
    expect(ev).toHaveLength(1);
  });
});

describe("AC-BH-4, AC-BH-5, AC-BH-6: combo, voucher, chiết khấu tay", () => {
  it("combo Bộ 2 Tonic + THU10 + phí giao 25.000 → 89.000 / 394.000, used_count +1", async () => {
    const bundleId = await saveBundle(null, { code: "BO2", name: "Bộ 2 Tonic", price: 399_000, channelCode: null, isActive: true, note: null, items: [{ productId: pid.PST!, qty: 2 }] }, owner);
    await saveVoucher(null, { code: "THU10", kind: "percent", value: 1000, minOrder: 0, maxDiscount: 30_000, channelCode: null, validFrom: null, validTo: null, usageLimit: null, isActive: true }, owner);
    const r = await createManualOrder(input({ bundles: [{ bundleId, qty: 1 }], voucherCode: "thu10", shippingFee: 25_000 }), collab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = await orderOf(r.orderId);
    expect(o).toMatchObject({ subtotal: 458_000, discountTotal: 89_000, total: 394_000, voucherCode: "THU10" });
    const db = await getDb();
    expect((await db.select().from(vouchers).where(eq(vouchers.code, "THU10")))[0]!.usedCount).toBe(1);
  });

  it("voucher hết hạn, hết lượt, dưới mức tối thiểu báo đúng câu", async () => {
    const line = [{ productId: pid.PST!, qty: 1 }];
    await saveVoucher(null, { code: "CUHAN", kind: "amount", value: 10_000, minOrder: 0, maxDiscount: null, channelCode: null, validFrom: null, validTo: new Date(Date.now() - 86_400_000), usageLimit: null, isActive: true }, owner);
    await saveVoucher(null, { code: "TOI", kind: "amount", value: 10_000, minOrder: 1_000_000, maxDiscount: null, channelCode: null, validFrom: null, validTo: null, usageLimit: null, isActive: true }, owner);
    expect(await createManualOrder(input({ lines: line, voucherCode: "CUHAN" }), owner)).toEqual({ ok: false, message: "Mã giảm giá đã hết hạn" });
    const toi = await createManualOrder(input({ lines: line, voucherCode: "TOI" }), owner);
    expect(toi.ok === false && toi.message).toMatch(/chưa đủ/);
  });

  it("voucher 1 lượt, hai đơn cùng lúc → chỉ một đơn dùng được", async () => {
    await saveVoucher(null, { code: "MOT", kind: "amount", value: 10_000, minOrder: 0, maxDiscount: null, channelCode: null, validFrom: null, validTo: null, usageLimit: 1, isActive: true }, owner);
    const before = await stockOf("PST");
    const both = await Promise.all([0, 1].map(() => createManualOrder(input({ lines: [{ productId: pid.PST!, qty: 1 }], voucherCode: "MOT" }), owner)));
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    const failed = both.find((r) => !r.ok);
    expect(failed && !failed.ok && failed.message).toBe("Mã đã dùng hết lượt");
    expect(await stockOf("PST")).toBe(before - 1);
  });

  it("cộng tác viên chiết khấu tay 50.000 / 458.000 → cần quyền giá; 45.000 → được", async () => {
    const line = [{ productId: pid.PST!, qty: 2 }];
    const bad = await createManualOrder(input({ lines: line, manualDiscount: 50_000 }), collab);
    expect(bad.ok).toBe(false);
    const ok = await createManualOrder(input({ lines: line, manualDiscount: 45_000 }), collab);
    expect(ok.ok && ok.total).toBe(413_000);
  });
});

describe("AC-BH-8, AC-BH-9, AC-BH-10: đồng ý dữ liệu, giữ hàng, đơn sàn trùng", () => {
  it("FB có số chưa tích đồng ý → lỗi; tích → có consents data_processing, khách gom theo số", async () => {
    const line = [{ productId: pid.PST!, qty: 1 }];
    const no = await createManualOrder(input({ phone: "0912000111", consentConfirmed: false, lines: line }), owner);
    expect(no.ok).toBe(false);
    const a = await createManualOrder(input({ phone: "0912000111", lines: line }), owner);
    const b = await createManualOrder(input({ phone: "0912 000 111", lines: line }), owner);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const oa = await orderOf(a.orderId);
    const ob = await orderOf(b.orderId);
    expect(oa.customerId).not.toBeNull();
    expect(ob.customerId).toBe(oa.customerId);
    const db = await getDb();
    const c = await db.select().from(consents).where(and(eq(consents.customerId, oa.customerId!), eq(consents.purpose, "data_processing")));
    expect(c.length).toBeGreaterThan(0);
    expect(c[0]!.source).toBe("admin");
  });

  it("stock 2, đặt 3 → 'chỉ còn 2 chai', không có đơn, stock vẫn 2", async () => {
    const db = await getDb();
    await db.update(products).set({ stock: 2, status: "active" }).where(eq(products.code, "PSH"));
    const name = (await db.select({ n: products.name }).from(products).where(eq(products.code, "PSH")))[0]!.n;
    const before = (await db.select().from(orders)).length;
    const r = await createManualOrder(input({ lines: [{ productId: pid.PSH!, qty: 3 }] }), owner);
    expect(r).toEqual({ ok: false, message: `${name} chỉ còn 2 chai` });
    expect((await db.select().from(orders)).length).toBe(before);
    expect(await stockOf("PSH")).toBe(2);
  });

  it("đơn sàn trùng mã → R-BH-31, không trừ kho lần hai", async () => {
    const shp = input({ channelCode: "SHP", paymentMethod: "platform", externalRef: "2711ABC", phone: null, consentConfirmed: false, lines: [{ productId: pid.PST!, qty: 1 }] });
    const first = await createManualOrder(shp, owner);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const before = await stockOf("PST");
    const again = await createManualOrder(shp, owner);
    expect(again).toEqual({ ok: false, message: `Đơn sàn 2711ABC đã có (${first.code})` });
    expect(await stockOf("PST")).toBe(before);
  });
});

describe("AC-BH-11: hạn mức công nợ", () => {
  it("dư nợ đơn đang xử lý + đơn mới vượt hạn mức → chặn với số còn lại", async () => {
    const d = await newDealer("Salon Hoa", { creditLimit: 5_000_000, paymentTermsDays: 30 });
    const base = { channelCode: "DL", dealerId: d.id, paymentMethod: "credit" as const, phone: null, consentConfirmed: false };
    const first = await createManualOrder(input({ ...base, confirmNow: true, lines: [{ productId: pid.PST!, qty: 15 }] }), owner); // 3.435.000
    expect(first.ok).toBe(true);
    const over = await createManualOrder(input({ ...base, lines: [{ productId: pid.PST!, qty: 8 }] }), owner);
    expect(over.ok === false && over.message).toMatch(/^Vượt hạn mức công nợ: còn 1\.565\.000/);
    const zero = await newDealer("Salon Không", { creditLimit: 0 });
    expect(await createManualOrder(input({ ...base, dealerId: zero.id, lines: [{ productId: pid.PST!, qty: 1 }] }), owner)).toEqual({ ok: false, message: "Đại lý chưa được mua chịu" });
    const old = await newDealer("Salon Cũ", { creditLimit: 5_000_000, contractEnd: "2020-01-31" });
    const exp = await createManualOrder(input({ ...base, dealerId: old.id, lines: [{ productId: pid.PST!, qty: 1 }] }), owner);
    expect(exp).toEqual({ ok: false, message: "Hợp đồng đại lý đã hết hạn ngày 31/01/2020" });
  });
});

describe("AC-BH-19, AC-BH-21, AC-BH-22: giao và thanh toán", () => {
  it("COD giao xong → paid, phiếu thu vào COD khóa order-paid; đánh dấu lại không tạo phiếu thứ hai", async () => {
    const r = await createManualOrder(input({ phone: "0933111222", lines: [{ productId: pid.PST!, qty: 2 }], shippingFee: 25_000 }), owner);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await walk(r.orderId, "confirmed", "packing", "shipping", "delivered");
    const o = await orderOf(r.orderId);
    expect(o.paymentStatus).toBe("paid");
    const db = await getDb();
    const tx = await db.select().from(cashTransactions).where(eq(cashTransactions.idempotencyKey, `order-paid:${r.orderId}`));
    expect(tx).toHaveLength(1);
    expect(tx[0]!.amount).toBe(r.total);
    const [cod] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, tx[0]!.accountId));
    expect(cod!.code).toBe("COD");
    expect(await setPaymentStatus(r.orderId, "paid", owner.id)).toEqual({ ok: true });
    expect(await db.select().from(cashTransactions).where(eq(cashTransactions.idempotencyKey, `order-paid:${r.orderId}`))).toHaveLength(1);
  });

  it("đơn credit: nhân viên bấm đã thu → lỗi; giao → phải thu total, hạn theo đại lý", async () => {
    const d = await newDealer("Salon Tre", { creditLimit: 10_000_000, paymentTermsDays: 30 });
    const r = await createManualOrder(input({ channelCode: "DL", dealerId: d.id, paymentMethod: "credit", phone: null, consentConfirmed: false, lines: [{ productId: pid.PST!, qty: 3 }] }), owner);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const paid = await setPaymentStatus(r.orderId, "paid", owner.id);
    expect(paid).toEqual({ ok: false, message: "Đơn công nợ: thu tiền ở mục Công nợ" });
    await walk(r.orderId, "confirmed", "packing", "shipping", "delivered");
    const db = await getDb();
    const [ar] = await db.select().from(receivables).where(eq(receivables.orderId, r.orderId));
    expect(ar).toMatchObject({ party: "dealer", dealerId: d.id, amount: r.total, dueOn: addDays(vnToday(), 30) });
  });

  it("đơn sàn 229.000 phí 2.150 bp, tiền về 14 ngày → phải thu 179.765; sửa phí 50.000 → 179.000", async () => {
    await updateChannel("SHP", { name: "Shopee", feeRateBp: 2150, payoutDays: 14, priceListId: null, isActive: true, sort: 2, note: null }, owner);
    const r = await createManualOrder(input({ channelCode: "SHP", paymentMethod: "platform", externalRef: "SHP-AC22", phone: null, consentConfirmed: false, lines: [{ productId: pid.PST!, qty: 1 }] }), owner);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await orderOf(r.orderId)).platformFee).toBe(49_235);
    await walk(r.orderId, "confirmed", "packing", "shipping", "delivered");
    const db = await getDb();
    const [ar] = await db.select().from(receivables).where(eq(receivables.orderId, r.orderId));
    expect(ar).toMatchObject({ party: "channel", channelCode: "SHP", amount: 179_765, dueOn: addDays(vnToday(), 14) });
    expect(await updatePlatformFee(r.orderId, 50_000, "Đối chiếu sàn", owner)).toEqual({ ok: true });
    const [after] = await db.select().from(receivables).where(eq(receivables.orderId, r.orderId));
    expect(after!.amount).toBe(179_000);
    expect((await orderOf(r.orderId)).platformFee).toBe(50_000);
  });
});

describe("AC-BH-31: nhãn và ghi chú khách", () => {
  it("chuẩn hóa nhãn, tối đa 10; ghi chú vào touchpoints care_note", async () => {
    const db = await getDb();
    const [c] = await db.insert(customers).values({ phoneE164: "84977000111", name: "Khách nhãn", referralCode: "NHAN01" }).returning({ id: customers.id });
    await addCustomerTag(c!.id, "  Khách Salon  ", collab);
    expect((await db.select().from(customers).where(eq(customers.id, c!.id)))[0]!.tags).toEqual(["khách salon"]);
    for (let i = 1; i < 10; i++) await addCustomerTag(c!.id, `nhãn ${i}`, owner);
    await expect(addCustomerTag(c!.id, "nhãn 11", owner)).rejects.toThrow("Mỗi khách tối đa 10 nhãn");
    await addCareNote(c!.id, "Gọi lại sau 2 tuần", collab);
    const notes = await db.select().from(touchpoints).where(and(eq(touchpoints.customerId, c!.id), eq(touchpoints.type, "care_note")));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.payload).toMatchObject({ text: "Gọi lại sau 2 tuần", staffId: collab.id });
    const crm = await getCustomerCrm(c!.id);
    expect(crm!.notes).toHaveLength(1);
  });
});

describe("AC-BH-35: Chỉ xem không ghi được", () => {
  it("tạo đơn, bảng giá, đại lý, nhãn đều lỗi quyền, không ghi gì", async () => {
    const db = await getDb();
    const before = (await db.select().from(orders)).length;
    await expect(createManualOrder(input({ lines: [{ productId: pid.PST!, qty: 1 }] }), viewer)).rejects.toThrow();
    await expect(savePriceList(null, { code: "XEM", name: "x", kind: "retail", channelCode: null, validFrom: null, validTo: null, priority: 0, isActive: true, note: null }, viewer)).rejects.toThrow();
    await expect(createDealer({ name: "X", tier: "", contactName: null, phone: null, email: null, address: null, taxCode: null, contractNo: null, contractStart: null, contractEnd: null, priceListId: null, discountBp: 0, commissionBp: 0, creditLimit: 0, paymentTermsDays: 0, customerId: null, note: null }, viewer)).rejects.toThrow();
    const [c] = await db.select().from(customers).limit(1);
    if (c) await expect(addCustomerTag(c.id, "x", viewer)).rejects.toThrow();
    expect((await db.select().from(orders)).length).toBe(before);
    expect(await db.select().from(dealers).where(eq(dealers.name, "X"))).toHaveLength(0);
    // Cộng tác viên cũng không sửa bảng giá (sales.pricing)
    await expect(savePriceList(null, { code: "CTV", name: "x", kind: "retail", channelCode: null, validFrom: null, validTo: null, priority: 0, isActive: true, note: null }, collab)).rejects.toThrow();
    expect(isoDateVn(new Date())).toBe(vnToday());
    expect(await db.select().from(salesChannels).where(eq(salesChannels.code, "WEB"))).toHaveLength(1);
  });
});
