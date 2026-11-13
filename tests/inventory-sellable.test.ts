import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-inv-sellable-"));
process.env.PGLITE_DIR = dir;

import { and, eq, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import {
  auditLog,
  inventoryItems,
  lots,
  lotTests,
  notifications,
  orderItems,
  orders,
  products,
  staffUsers,
  stockBalances,
  stockLots,
  stockMovements,
  stockReceipts,
  warehouseLocations,
  warehouses,
} from "@/db/schema";
import { adjustStock, createProduct, updateProduct } from "@/modules/catalog/service";
import { computeInventoryAlerts } from "@/modules/inventory/alerts";
import {
  enableInventoryTracking,
  getItemStock,
  issueOrderStock,
  postReceipt,
  previewInventoryTracking,
  receiveOrderReturn,
  refreshExpiredStock,
  reverseOrderStock,
  syncSellableStock,
} from "@/modules/inventory/ledger";
import { vnToday } from "@/modules/numbering/rules";
import { placeOrder } from "@/modules/orders/service";
import { setLotHold } from "@/modules/quality/admin";
import { releaseLot } from "@/modules/quality/service";
import { parseSettings } from "@/modules/settings/schema";

const today = vnToday();
const ids = { owner: "", wh: {} as Record<string, string>, loc: {} as Record<string, string>, item: {} as Record<string, string>, product: {} as Record<string, string> };

async function tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}
async function stockOf(code: string): Promise<number> {
  const db = await getDb();
  return (await db.select({ s: products.stock }).from(products).where(eq(products.code, code)))[0]!.s;
}
async function balance(stockLotId: string, locationId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ qty: stockBalances.qty }).from(stockBalances).where(and(eq(stockBalances.stockLotId, stockLotId), eq(stockBalances.locationId, locationId)));
  return row?.qty ?? 0;
}
async function newLot(productCode: string, lotNo: string, opts: { expiresOn: string; units: number; released?: boolean }) {
  const db = await getDb();
  const [row] = await db
    .insert(lots)
    .values({
      lotNo,
      productId: ids.product[productCode]!,
      formulaVersion: "v1",
      manufacturedOn: "2026-10-01",
      expiresOn: opts.expiresOn,
      unitsProduced: opts.units,
      releaseStatus: opts.released ? "released" : "quarantine",
    })
    .returning({ id: lots.id });
  return row!.id;
}
async function opening(productCode: string, productLotId: string, qty: number, receivedOn = today) {
  return tx((t) =>
    postReceipt(
      t,
      { kind: "opening", warehouseId: ids.wh.FG!, receivedOn, paymentMode: "none", lines: [{ itemId: ids.item[productCode]!, qty, lineCost: qty * 65_000, productLotId }] },
      ids.owner,
    ),
  );
}
async function insertOrder(productCode: string, qty: number, status: "pending" | "confirmed") {
  const db = await getDb();
  const [o] = await db
    .insert(orders)
    .values({
      code: `TEST-${Math.random().toString(36).slice(2, 8)}`,
      status,
      paymentMethod: "cod",
      recipientName: "Khách thử",
      phoneE164: "84900000000",
      province: "Hà Nội",
      ward: "Phường thử",
      addressLine: "1 Đường thử",
      subtotal: 229_000 * qty,
      shippingFee: 0,
      total: 229_000 * qty,
      accessToken: "t",
    })
    .returning({ id: orders.id });
  const [i] = await db
    .insert(orderItems)
    .values({ orderId: o!.id, productId: ids.product[productCode]!, productName: `SP ${productCode}`, unitPrice: 229_000, quantity: qty, lineTotal: 229_000 * qty })
    .returning({ id: orderItems.id });
  return { orderId: o!.id, itemId: i!.id };
}

beforeAll(async () => {
  const db = await getDb();
  const [owner] = await db.insert(staffUsers).values({ email: "owner@test.vn", role: "owner", passwordHash: "x" }).returning({ id: staffUsers.id });
  ids.owner = owner!.id;
  for (const w of await db.select().from(warehouses)) ids.wh[w.code] = w.id;
  for (const l of await db.select().from(warehouseLocations).where(eq(warehouseLocations.isDefault, true))) {
    ids.loc[Object.entries(ids.wh).find(([, id]) => id === l.warehouseId)![0]] = l.id;
  }
  for (const p of await db.select().from(products)) ids.product[p.code] = p.id;
  for (const i of await db.select().from(inventoryItems)) if (i.productId) ids.item[i.code] = i.id;
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Tonic: nhập lô có sẵn, bật quản lý kho, đồng bộ số bán được", () => {
  let lotB = "";
  let lotA = "";
  it("AC-KHO-34: nhập tồn đầu 265 rồi 35 vào một lô kho; thêm 1 bị chặn", async () => {
    const db = await getDb();
    lotB = (await db.select().from(lots).where(eq(lots.lotNo, "PST-271101-01")))[0]!.id;
    // Lô mẫu sản xuất 2027-11-01: ngày nhập phải sau ngày sản xuất
    await opening("PST", lotB, 265, "2027-11-02");
    await opening("PST", lotB, 35, "2027-11-02");
    const sl = await db.select().from(stockLots).where(eq(stockLots.productLotId, lotB));
    expect(sl).toHaveLength(1);
    expect(sl[0]).toMatchObject({ code: "PST-271101-01", receivedQty: 300, qcStatus: null, expiresOn: "2029-11-01" });
    expect(await balance(sl[0]!.id, ids.loc.FG!)).toBe(300);
    await expect(opening("PST", lotB, 1, "2027-11-02")).rejects.toThrow("Lô PST-271101-01 sản xuất 300 chai, đã nhập 300");
    // Chưa bật quản lý kho: số bán được không đổi
    expect(await stockOf("PST")).toBe(265);
  });

  it("AC-KHO-27: xem trước 265 → 0, bật thì stock = 0 có audit, adjustStock bị từ chối", async () => {
    const db = await getDb();
    expect(await previewInventoryTracking(db, ids.product.PST!)).toEqual({ before: 265, after: 0, availableFg: 0, reserved: 0 });
    expect(await enableInventoryTracking(ids.product.PST!, true, ids.owner)).toEqual({ before: 265, after: 0 });
    const [p] = await db.select().from(products).where(eq(products.id, ids.product.PST!));
    expect(p).toMatchObject({ trackInventory: true, stock: 0 });
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.action, "product.inventory_tracking"), eq(auditLog.entityId, ids.product.PST!)));
    expect(audit).toHaveLength(1);
    expect(await adjustStock(ids.product.PST!, 5, "thử", ids.owner)).toEqual({ ok: false, message: "Sản phẩm này quản lý tồn theo kho: nhập, xuất hoặc kiểm kê ở mục Kho" });
    expect(await stockOf("PST")).toBe(0);
  });

  it("AC-KHO-28: lô A 120 đã duyệt, đơn giữ 5 → 115; duyệt B → +300; giữ A → −120; bỏ giữ → lại", async () => {
    const db = await getDb();
    lotA = await newLot("PST", "PST-261001-01", { expiresOn: "2028-10-01", units: 120, released: true });
    await opening("PST", lotA, 120);
    expect(await stockOf("PST")).toBe(120);
    const placed = await placeOrder(
      {
        recipientName: "Khách thử",
        phoneE164: "84901234567",
        email: null,
        province: "Hà Nội",
        ward: "Phường thử",
        addressLine: "1 Đường thử",
        customerNote: null,
        paymentMethod: "cod",
        marketingConsent: false,
        consentTexts: { dataProcessing: "dp", marketing: "mk" },
        utm: null,
        landingVariant: "A",
        lines: [{ productId: ids.product.PST!, quantity: 5 }],
      },
      parseSettings({}),
    );
    expect(placed.ok).toBe(true);
    expect(await stockOf("PST")).toBe(115);
    expect((await tx((t) => syncSellableStock(t, ids.product.PST!))).stock).toBe(115);

    await db.insert(lotTests).values([
      { lotId: lotB, type: "microbial", result: "pass" },
      { lotId: lotB, type: "heavy_metals", result: "pass" },
    ]);
    await db.insert(notifications).values({ productId: ids.product.PST!, number: "TEST-CB", issuedAt: "2026-01-01", expiresAt: "2031-01-01" });
    expect((await releaseLot(lotB, ids.owner)).ok).toBe(true);
    expect(await stockOf("PST")).toBe(415);
    expect((await setLotHold(lotA, true, "Thử giữ", ids.owner)).ok).toBe(true);
    expect(await stockOf("PST")).toBe(295);
    expect((await setLotHold(lotA, false, null, ids.owner)).ok).toBe(true);
    expect(await stockOf("PST")).toBe(415);
  });
});

describe("xuất kho cho đơn (R-KHO-32…R-KHO-34)", () => {
  let order = { orderId: "", itemId: "" };
  let l1 = "";
  let l2 = "";
  let sl1 = "";
  let sl2 = "";
  beforeAll(async () => {
    await enableInventoryTracking(ids.product.PSH!, true, ids.owner);
    l1 = await newLot("PSH", "PSH-261001-01", { expiresOn: "2028-03-01", units: 50, released: true });
    l2 = await newLot("PSH", "PSH-261001-02", { expiresOn: "2028-09-01", units: 50, released: true });
    sl1 = (await opening("PSH", l1, 2)).lines[0]!.stockLotId;
    sl2 = (await opening("PSH", l2, 10)).lines[0]!.stockLotId;
    order = await insertOrder("PSH", 3, "confirmed");
    await tx((t) => syncSellableStock(t, ids.product.PSH!));
  });

  it("AC-KHO-30: tách dòng theo FEFO, tổng tiền không đổi, stock không đổi, gọi lần hai bị chặn", async () => {
    const db = await getDb();
    expect(await stockOf("PSH")).toBe(9);
    const r = await tx((t) => issueOrderStock(t, order.orderId, {}, ids.owner));
    expect(r.ok).toBe(true);
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.orderId));
    const orig = items.find((i) => i.id === order.itemId)!;
    const split = items.find((i) => i.id !== order.itemId)!;
    expect(orig).toMatchObject({ quantity: 2, lineTotal: 458_000, lotId: l1 });
    expect(split).toMatchObject({ quantity: 1, lineTotal: 229_000, lotId: l2, splitFromId: order.itemId });
    const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.docId, order.orderId), eq(stockMovements.type, "sale_issue")));
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.orderItemId)).toBe(true);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.orderId));
    expect(o!.stockIssuedAt).not.toBeNull();
    expect(await stockOf("PSH")).toBe(9);
    expect((await getItemStock(db, [ids.item.PSH!])).get(ids.item.PSH!)!.reserved).toBe(0);
    const again = await tx((t) => issueOrderStock(t, order.orderId, {}, ids.owner));
    expect(again).toEqual({ ok: false, message: "Chứng từ vừa được người khác cập nhật, tải lại trang." });
    expect(await db.select().from(stockMovements).where(eq(stockMovements.docId, order.orderId))).toHaveLength(2);
  });

  it("AC-KHO-31: đảo xuất kho trả số dư, bỏ lô của dòng; lần hai đảo 0", async () => {
    const db = await getDb();
    expect(await tx((t) => reverseOrderStock(t, order.orderId, ids.owner))).toEqual({ reversed: 2 });
    expect(await balance(sl1, ids.loc.FG!)).toBe(2);
    expect(await balance(sl2, ids.loc.FG!)).toBe(10);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.orderId));
    expect(o!.stockIssuedAt).toBeNull();
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.orderId));
    expect(items.every((i) => i.lotId === null)).toBe(true);
    expect(await tx((t) => reverseOrderStock(t, order.orderId, ids.owner))).toEqual({ reversed: 0 });
    expect(await stockOf("PSH")).toBe(9);
  });

  it("AC-KHO-32, AC-KHO-33: nhập hàng trả về FG và REJ, không đổi received_qty; vượt số đã xuất bị chặn; lô đang giữ thì vào REJ", async () => {
    const db = await getDb();
    expect((await tx((t) => issueOrderStock(t, order.orderId, {}, ids.owner))).ok).toBe(true);
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.orderId));
    const first = items.find((i) => i.lotId === l1)!;
    const second = items.find((i) => i.lotId === l2)!;
    expect(first.quantity).toBe(2);
    const before = await stockOf("PSH");
    const r = await tx((t) =>
      receiveOrderReturn(
        t,
        {
          orderId: order.orderId,
          source: { type: "order", id: order.orderId, code: "TEST" },
          lines: [
            { orderItemId: first.id, qty: 1, disposition: "restock" },
            { orderItemId: first.id, qty: 1, disposition: "quarantine" },
          ],
        },
        ids.owner,
      ),
    );
    const [rc] = await db.select().from(stockReceipts).where(eq(stockReceipts.id, r.receiptId));
    expect(rc).toMatchObject({ kind: "customer_return", status: "posted" });
    expect(await balance(sl1, ids.loc.FG!)).toBe(1);
    expect(await balance(sl1, ids.loc.REJ!)).toBe(1);
    expect((await db.select().from(stockLots).where(eq(stockLots.id, sl1)))[0]!.receivedQty).toBe(2);
    expect(await stockOf("PSH")).toBe(before + 1);
    const ret = await db.select().from(stockMovements).where(and(eq(stockMovements.docId, r.receiptId), eq(stockMovements.type, "return_receipt")));
    expect(ret.every((m) => m.orderItemId === first.id)).toBe(true);
    await expect(
      tx((t) => receiveOrderReturn(t, { orderId: order.orderId, source: { type: "order", id: order.orderId, code: "TEST" }, lines: [{ orderItemId: first.id, qty: 1, disposition: "restock" }] }, ids.owner)),
    ).rejects.toThrow("vượt số đã xuất");

    await setLotHold(l2, true, "Thử", ids.owner);
    const r2 = await tx((t) =>
      receiveOrderReturn(t, { orderId: order.orderId, source: { type: "order", id: order.orderId, code: "TEST" }, lines: [{ orderItemId: second.id, qty: 1, disposition: "restock" }] }, ids.owner),
    );
    const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.docId, r2.receiptId));
    expect(mv!.locationId).toBe(ids.loc.REJ);
    expect(mv!.note).toBe("Lô đang bị giữ/hết hạn, đưa vào kho cách ly");
    await setLotHold(l2, false, null, ids.owner);
  });

  it("thiếu hàng: không ghi gì, câu báo theo đặc tả", async () => {
    const big = await insertOrder("PSH", 100, "confirmed");
    const r = await tx((t) => issueOrderStock(t, big.orderId, {}, ids.owner));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/^Không đủ hàng khả dụng cho SP PSH: cần 100, còn \d+$/);
    const db = await getDb();
    expect((await db.select().from(orders).where(eq(orders.id, big.orderId)))[0]!.stockIssuedAt).toBeNull();
    await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, big.orderId));
    await tx((t) => syncSellableStock(t, ids.product.PSH!));
  });
});

describe("cảnh báo Kho (mục 8.7)", () => {
  it("AC-KHO-24: hàng dưới tối thiểu có cảnh báo warn trỏ tới hàng", async () => {
    const db = await getDb();
    const [bb] = await db.insert(inventoryItems).values({ code: "BB-001", name: "Chai 100 ml", kind: "packaging", baseUom: "pcs", displayUom: "cái", purchaseUom: "cái", minStock: 100 }).returning({ id: inventoryItems.id });
    await tx((t) => postReceipt(t, { kind: "other", warehouseId: ids.wh.PKG!, receivedOn: today, paymentMode: "none", lines: [{ itemId: bb!.id, qty: 80, lineCost: 0, qcRequired: false }] }, ids.owner));
    const alerts = await computeInventoryAlerts(db, "owner", today);
    expect(alerts).toContainEqual({ module: "kho", level: "warn", text: "BB-001 Chai 100 ml còn 80 cái, dưới mức 100", href: `/admin/kho/hang-hoa/${bb!.id}` });
  });

  it("AC-KHO-29: khả dụng 2, đơn giữ 3 → stock 0 và cảnh báo 1 đơn vượt tồn", async () => {
    await enableInventoryTracking(ids.product.PCD!, true, ids.owner);
    const lot = await newLot("PCD", "PCD-261001-01", { expiresOn: "2028-10-01", units: 2, released: true });
    await opening("PCD", lot, 2);
    await insertOrder("PCD", 3, "pending");
    expect((await tx((t) => syncSellableStock(t, ids.product.PCD!))).stock).toBe(0);
    const db = await getDb();
    const alerts = await computeInventoryAlerts(db, "owner", today);
    expect(alerts.find((a) => a.text === "1 đơn đang giữ vượt tồn khả dụng")?.level).toBe("danger");
  });
});

describe("R-KHO-27, R-KHO-3", () => {
  it("AC-KHO-37: chạy lại sau 60 phút, chưa tới thì bỏ qua", async () => {
    const db = await getDb();
    const t0 = new Date();
    const first = await refreshExpiredStock(db, t0);
    expect(first.skipped).toBe(false);
    expect(first.productsSynced).toBeGreaterThanOrEqual(3);
    expect(await refreshExpiredStock(db, new Date(t0.getTime() + 10 * 60_000))).toEqual({ productsSynced: 0, skipped: true });
    expect((await refreshExpiredStock(db, new Date(t0.getTime() + 61 * 60_000))).skipped).toBe(false);
  });

  it("tạo sản phẩm thì có hàng thành phẩm; đổi tên thì hàng đổi theo", async () => {
    const id = await createProduct({ code: "PTEST", name: "Sản phẩm thử", slug: "san-pham-thu", price: 100_000 }, ids.owner);
    const db = await getDb();
    const [it1] = await db.select().from(inventoryItems).where(eq(inventoryItems.productId, id));
    expect(it1).toMatchObject({ code: "PTEST", kind: "finished", baseUom: "pcs", displayUom: "chai", requiresIqc: false });
    await updateProduct(id, { name: "Tên mới" }, ids.owner);
    expect((await db.select().from(inventoryItems).where(eq(inventoryItems.productId, id)))[0]!.name).toBe("Tên mới");
  });
});

describe("bất biến (INV-1, INV-2, INV-3, INV-5)", () => {
  it("đúng cho mọi (vị trí, lô) và mọi sản phẩm bật quản lý kho", async () => {
    const db = await getDb();
    const rowsOf = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, unknown>[];
    // INV-1
    expect(await db.select().from(stockBalances).where(sql`${stockBalances.qty} < 0`)).toHaveLength(0);
    // INV-2
    const inv2 = rowsOf(
      await db.execute(sql`
      with s as (select location_id, stock_lot_id, sum(qty) as total from stock_movements group by 1, 2),
      last as (select distinct on (location_id, stock_lot_id) location_id, stock_lot_id, balance_after from stock_movements order by location_id, stock_lot_id, occurred_at desc, created_at desc)
      select b.location_id from stock_balances b
      full join s on s.location_id = b.location_id and s.stock_lot_id = b.stock_lot_id
      left join last on last.location_id = coalesce(b.location_id, s.location_id) and last.stock_lot_id = coalesce(b.stock_lot_id, s.stock_lot_id)
      where coalesce(b.qty, 0) <> coalesce(s.total, 0) or (last.balance_after is not null and last.balance_after <> coalesce(b.qty, 0))`),
    );
    expect(inv2).toHaveLength(0);
    // INV-3
    const tracked = await db.select({ id: products.id, stock: products.stock }).from(products).where(eq(products.trackInventory, true));
    expect(tracked.length).toBeGreaterThanOrEqual(3);
    for (const p of tracked) {
      const r = await tx((t) => syncSellableStock(t, p.id));
      expect(r.stock, `INV-3 sản phẩm ${p.id}`).toBe(p.stock);
      expect(p.stock).toBe(Math.max(0, r.availableFg - r.reserved));
    }
    // INV-5: với mỗi lô thành phẩm, nhập FG − bán ròng − mẫu − hủy + hàng trả (+ kiểm kê) = tồn mọi kho; điều chuyển tự triệt tiêu
    const inv5 = rowsOf(
      await db.execute(sql`
      select sl.id,
        coalesce((select sum(m.qty) from stock_movements m where m.stock_lot_id = sl.id), 0) as moved,
        coalesce((select sum(m.qty) from stock_movements m where m.stock_lot_id = sl.id and m.type in ('transfer_in','transfer_out')), 0) as transfers,
        coalesce((select sum(b.qty) from stock_balances b where b.stock_lot_id = sl.id), 0) as on_hand
      from stock_lots sl where sl.product_lot_id is not null`),
    );
    expect(inv5.length).toBeGreaterThanOrEqual(5);
    for (const r of inv5) {
      expect(Number(r.transfers)).toBe(0);
      expect(Number(r.moved)).toBe(Number(r.on_hand));
    }
  });
});
