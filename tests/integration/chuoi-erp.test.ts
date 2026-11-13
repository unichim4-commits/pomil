// T-19 (QA): chuỗi xuyên 5 phân hệ trên MỘT DB, chạy tuần tự theo 00-tong-quan.md mục 14 (AC-TICHHOP-*).
// Nhập NVL → IQC → kế hoạch → LSX gia công → xuất FEFO → IPQC → sản lượng → FQC → bán web → giao → thu COD
// → giá vốn, lãi lỗ → đổi trả → hoàn về → hủy đã đóng gói → truy xuất → phản ánh khóa lô → NCR/CAPA → thu hồi
// → IQC trả NCC → hủy phiếu nhập → lô hết hạn → bất biến INV-1…9.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-qa-chuoi-"));
process.env.PGLITE_DIR = dir;

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  capaActions,
  capas,
  cashAccounts,
  cashTransactions,
  complaints,
  inventoryItems,
  lots,
  lotTests,
  ncrs,
  notifications,
  orderItems,
  orders,
  payables,
  productionOrders,
  productionOrderSteps,
  products,
  qcInspections,
  recallContacts,
  stockBalances,
  stockIssues,
  stockLots,
  stockMovements,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { profitAndLoss } from "@/modules/finance/reports";
import { getAlerts as inventoryAlerts } from "@/modules/inventory/alerts";
import { cancelReceipt, enableInventoryTracking, getItemStock, issueOrderStock, postIssueDraft, postReceipt, refreshExpiredStock } from "@/modules/inventory/ledger";
import { vnToday } from "@/modules/numbering/rules";
import { changeOrderStatus, packOrder, placeOrder } from "@/modules/orders/service";
import { approveOrder, completeOrder, createOrderFromPlanLine, addMaterialLine, finishStep, issueMaterial, planOrder, recordOutput, setMaterialSource, skipStep, startStep, updateOrder } from "@/modules/production/orders";
import { addPlanLine, createPlan } from "@/modules/production/plans";
import { createCapaFromComplaint } from "@/modules/qms/capa";
import { decideInspection } from "@/modules/qms/decisions";
import { createNcrFromComplaint } from "@/modules/qms/ncr";
import { openRecall, recallStats, receiveRecallReturn } from "@/modules/qms/recall";
import { lotBalance, traceBackward, traceForward, type TraceNode } from "@/modules/qms/trace";
import { setLotHold } from "@/modules/quality/admin";
import { submitComplaint } from "@/modules/quality/service";
import { approveReturn, completeReturn, createReturnRequest, getReturn, receiveReturn } from "@/modules/sales/returns";
import { parseSettings } from "@/modules/settings/schema";
import { checkInvariants, makeStaff, tx, type TestActor } from "./_helpers";

const today = vnToday();
const MFG = "2027-11-20";
// 00 mục 14 tính đơn 2 chai có phí giao 25.000đ; mặc định miễn phí giao từ 450.000đ nên nâng ngưỡng để khớp đặc tả
const settings = parseSettings({ shippingFreeThreshold: 1_000_000 });
const consentTexts = { dataProcessing: "dp", marketing: "mk" };
let owner: TestActor, collab: TestActor;

const ids = {
  pst: "",
  pstm: "",
  fgItem: "",
  fgItemM: "",
  td: "",
  bb: [] as string[],
  ncc004: "",
  factory: "",
  pkgSupplier: "",
  wh: {} as Record<string, string>,
  acc: {} as Record<string, string>,
  tdLot: "",
  tdReceiptCode: "",
  iqcCode: "",
  order: "",
  orderCode: "",
  lot: "",
  lotStock: "",
  fqc: "",
  web1: "",
  web1Code: "",
};

function flatten(n: TraceNode): TraceNode[] {
  return [n, ...n.children.flatMap(flatten)];
}
async function productStock(id = ids.pst) {
  const db = await getDb();
  return (await db.select({ s: products.stock }).from(products).where(eq(products.id, id)))[0]!.s;
}
async function fg(itemId = ids.fgItem) {
  return (await getItemStock(await getDb(), [itemId])).get(itemId)!;
}
async function qtyIn(stockLotId: string, wh: string) {
  const db = await getDb();
  const [r] = await db
    .select({ q: sql<string>`coalesce(sum(${stockBalances.qty}),0)` })
    .from(stockBalances)
    .where(and(eq(stockBalances.stockLotId, stockLotId), eq(stockBalances.warehouseId, ids.wh[wh]!)));
  return Number(r?.q ?? 0);
}
async function orderRow(id: string) {
  return (await (await getDb()).select().from(orders).where(eq(orders.id, id)))[0]!;
}
async function itemsOf(id: string) {
  return (await getDb()).select().from(orderItems).where(eq(orderItems.orderId, id));
}
async function web(qty: number, phone = "84901234567", productId = ids.pst) {
  const r = await placeOrder(
    {
      recipientName: "Khách QA",
      phoneE164: phone,
      email: null,
      province: "Hà Nội",
      ward: "Phường Láng",
      addressLine: "1 Láng Hạ",
      customerNote: null,
      paymentMethod: "cod",
      marketingConsent: false,
      consentTexts,
      utm: null,
      landingVariant: "A",
      lines: [{ productId, quantity: qty }],
    },
    settings,
  );
  if (!r.ok) throw new Error(JSON.stringify(r));
  const o = (await (await getDb()).select().from(orders).where(eq(orders.code, r.code)))[0]!;
  return { id: o.id, code: r.code };
}
async function step(id: string, to: Parameters<typeof changeOrderStatus>[1], opts?: Parameters<typeof changeOrderStatus>[4]) {
  expect(await changeOrderStatus(id, to, owner.id, to === "cancelled" ? "QA hủy" : null, opts)).toEqual({ ok: true });
}
function monthRange() {
  const from = `${today.slice(0, 7)}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { from, to: d.toISOString().slice(0, 10) };
}
async function pnl() {
  return profitAndLoss(await getDb(), monthRange());
}
async function pendingInspection(where: ReturnType<typeof eq>) {
  const db = await getDb();
  const [r] = await db
    .select()
    .from(qcInspections)
    .where(and(where, eq(qcInspections.status, "pending")));
  return r!;
}

beforeAll(async () => {
  const db = await getDb();
  ({ owner, collab } = await makeStaff("chuoi"));
  for (const w of await db.select().from(warehouses)) ids.wh[w.code] = w.id;
  for (const a of await db.select().from(cashAccounts)) ids.acc[a.code] = a.id;
  const [pst] = await db.update(products).set({ netQty: 100_000, netUom: "ul" }).where(eq(products.code, "PST")).returning({ id: products.id });
  ids.pst = pst!.id;
  ids.pstm = (await db.select().from(products).where(eq(products.code, "PSTM")))[0]!.id;
  await db.insert(notifications).values({ productId: ids.pst, number: "QA-CB-01", issuedAt: "2026-01-01", expiresAt: "2031-01-01" });

  const sup = async (code: string, name: string, kind: "material" | "factory" | "packaging") =>
    (await db.insert(suppliers).values({ code, name, kind, paymentTermsDays: 30 }).returning({ id: suppliers.id }))[0]!.id;
  ids.ncc004 = await sup("NCC-004", "Tinh dầu QA", "material");
  ids.factory = await sup("NCC-QA-NM", "Nhà máy QA", "factory");
  ids.pkgSupplier = await sup("NCC-QA-BB", "Bao bì QA", "packaging");

  const [td] = await db
    .insert(inventoryItems)
    .values({ code: "QA-TD-001", name: "Tinh dầu vỏ bưởi QA", kind: "extract", baseUom: "ul", displayUom: "ml", purchaseUom: "l", requiresIqc: true, refUnitPrice: 2_000_000 })
    .returning({ id: inventoryItems.id });
  ids.td = td!.id;
  for (const [k, price] of [6_000, 3_000, 1_500, 4_500].entries()) {
    const i = k + 1;
    const [b] = await db
      .insert(inventoryItems)
      .values({ code: `QA-BB-00${i}`, name: `Bao bì QA ${i}`, kind: "packaging", baseUom: "pcs", displayUom: "cái", purchaseUom: "cái", requiresIqc: false, refUnitPrice: price })
      .returning({ id: inventoryItems.id });
    ids.bb.push(b!.id);
  }
  // Bật quản lý kho cho Tonic: tạo hàng thành phẩm; hạn dùng 730 ngày
  await enableInventoryTracking(ids.pst, true, owner.id);
  const [fgRow] = await db.update(inventoryItems).set({ shelfLifeDays: 730 }).where(eq(inventoryItems.productId, ids.pst)).returning({ id: inventoryItems.id });
  ids.fgItem = fgRow!.id;
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("chuỗi sản xuất → mở bán", { timeout: 60_000 }, () => {
  it("AC-TICHHOP-1: PN 1 l tinh dầu ghi công nợ → lô pending, cách ly 1 l, IQC chờ, phải trả 2.000.000đ; IQC Đạt → khả dụng 1 l", async () => {
    const db = await getDb();
    const r = await tx((t) =>
      postReceipt(t, { kind: "purchase", warehouseId: ids.wh.EXT!, supplierId: ids.ncc004, receivedOn: today, paymentMode: "payable", lines: [{ itemId: ids.td, qty: 1_000_000, lineCost: 2_000_000, supplierLotNo: "SL-QA-77", expiresOn: "2029-06-30" }] }, owner.id),
    );
    ids.tdLot = r.lines[0]!.stockLotId;
    ids.tdReceiptCode = r.code;
    const [sl] = await db.select().from(stockLots).where(eq(stockLots.id, ids.tdLot));
    expect(sl!.qcStatus).toBe("pending");
    expect(sl!.code).toMatch(/^VT-/);
    let s = (await getItemStock(db, [ids.td])).get(ids.td)!;
    expect(s).toMatchObject({ available: 0, quarantine: 1_000_000 });
    const iqc = await pendingInspection(eq(qcInspections.stockReceiptId, r.receiptId));
    expect(iqc.stage).toBe("iqc");
    ids.iqcCode = iqc.code;
    const [pay] = await db.select().from(payables).where(eq(payables.sourceId, r.receiptId));
    const due = new Date(`${today}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 30);
    expect(pay).toMatchObject({ amount: 2_000_000, supplierId: ids.ncc004, dueOn: due.toISOString().slice(0, 10) });

    await tx((t) => decideInspection(t, iqc.id, { disposition: "accept" }, owner));
    expect((await db.select().from(stockLots).where(eq(stockLots.id, ids.tdLot)))[0]!.qcStatus).toBe("released");
    s = (await getItemStock(db, [ids.td])).get(ids.td)!;
    expect(s.available).toBe(1_000_000);
  });

  it("AC-TICHHOP-2: kế hoạch → LSX gia công 300 chai, duyệt (16.800.000đ), xuất FEFO: TD còn 850 ml, bao bì −300, cam kết 0, NVL 300.000đ, bao bì 4.500.000đ", async () => {
    const db = await getDb();
    for (const [i, unit] of [6_000, 3_000, 1_500, 4_500].entries()) {
      await tx((t) =>
        postReceipt(t, { kind: "purchase", warehouseId: ids.wh.PKG!, supplierId: ids.pkgSupplier, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.bb[i]!, qty: 300, lineCost: 300 * unit, qcRequired: false }] }, owner.id),
      );
    }
    const plan = await tx((t) => createPlan(t, owner, { period: "week", periodStart: "2027-11-15", periodEnd: "2027-11-21" }));
    await tx((t) => addPlanLine(t, owner, plan.id, { productId: ids.pst, formulaVersionId: null, targetUnits: 300 }));
    const { productionPlanLines } = await import("@/db/schema");
    const [line] = await db.select().from(productionPlanLines).where(eq(productionPlanLines.planId, plan.id));
    const o = await tx((t) => createOrderFromPlanLine(t, owner, line!.id, { kind: "outsourced", supplierId: ids.factory, outsourcingUnitPrice: 40_000 }));
    ids.order = o.id;
    // Kế hoạch chưa có công thức PST đã duyệt → lệnh gia công sinh ra không có nhãn công thức; sửa lệnh ghi nhãn nhà máy
    await tx((t) =>
      updateOrder(t, owner, o.id, { kind: "outsourced", productId: ids.pst, formulaVersionId: null, formulaLabel: "Công thức nhà máy", supplierId: ids.factory, outsourcingUnitPrice: 40_000, plannedUnits: 300 }),
    );
    await tx(async (t) => {
      await addMaterialLine(t, owner, o.id, { itemId: ids.td, plannedQty: 150_000 });
      for (const b of ids.bb) await addMaterialLine(t, owner, o.id, { itemId: b, plannedQty: 300 });
    });
    const { productionOrderMaterials } = await import("@/db/schema");
    const mats = await db.select().from(productionOrderMaterials).where(eq(productionOrderMaterials.productionOrderId, o.id));
    await tx(async (t) => {
      for (const m of mats) await setMaterialSource(t, owner, m.id, "pomil");
    });
    await tx((t) => planOrder(t, owner, o.id));
    const ap = await tx((t) => approveOrder(t, owner, o.id));
    expect(ap).toMatchObject({ plannedCost: 16_800_000, missingPrice: [] });

    const before = await getItemStock(db, [ids.td, ...ids.bb]);
    expect(before.get(ids.td)!.committed).toBe(150_000);
    await tx((t) => issueMaterial(t, collab, o.id, { itemId: ids.td, qty: 150_000 }));
    for (const b of ids.bb) await tx((t) => issueMaterial(t, collab, o.id, { itemId: b, qty: 300 }));
    const after = await getItemStock(db, [ids.td, ...ids.bb]);
    expect(after.get(ids.td)!.onHand).toBe(850_000);
    for (const b of ids.bb) expect(after.get(b)).toMatchObject({ onHand: 0, committed: 0 });
    expect(after.get(ids.td)!.committed).toBe(0);
    const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.type, "production_issue"), eq(stockMovements.productionOrderId, o.id)));
    expect(moves).toHaveLength(5);
    expect(moves.find((m) => m.itemId === ids.td)!.stockLotId).toBe(ids.tdLot);
    const [row] = await db.select().from(productionOrders).where(eq(productionOrders.id, o.id));
    expect(row).toMatchObject({ status: "in_progress", materialCost: 300_000, packagingCost: 4_500_000 });
    ids.orderCode = row!.code;
  });

  it("AC-TICHHOP-3: IPQC thật qua decideInspection; ghi 296/4 → lô PST-271120-01 cách ly, FG cách ly 296, stock không đổi, FQC chờ, phải trả 12.000.000đ, 16.800.000đ, lệnh qc", async () => {
    const db = await getDb();
    const steps = await db.select().from(productionOrderSteps).where(eq(productionOrderSteps.productionOrderId, ids.order)).orderBy(productionOrderSteps.seq);
    for (const s of steps) {
      if (s.status !== "pending") continue;
      if (s.needsQc) {
        await tx((t) => startStep(t, owner, s.id));
        const ip = await pendingInspection(eq(qcInspections.productionStepId, s.id));
        expect(ip.stage).toBe("ipqc");
        await tx((t) => decideInspection(t, ip.id, { disposition: "accept" }, owner));
        await tx((t) => finishStep(t, owner, s.id));
      } else await tx((t) => skipStep(t, owner, s.id, "QA bỏ qua"));
    }
    const stockBefore = await productStock();
    const r = await tx((t) => recordOutput(t, owner, ids.order, { goodUnits: 296, rejectedUnits: 4, manufacturedOn: MFG }, MFG));
    expect(r.lotNo).toBe("PST-271120-01");
    expect(r.totalCost).toBe(16_800_000);
    ids.lot = r.lotId;
    const [lot] = await db.select().from(lots).where(eq(lots.id, r.lotId));
    expect(lot).toMatchObject({ releaseStatus: "quarantine", unitsProduced: 296 });
    const [sl] = await db.select().from(stockLots).where(eq(stockLots.productLotId, r.lotId));
    ids.lotStock = sl!.id;
    expect(await fg()).toMatchObject({ quarantine: 296, available: 0 });
    expect(await productStock()).toBe(stockBefore);
    const fqc = await pendingInspection(eq(qcInspections.lotId, r.lotId));
    expect(fqc.stage).toBe("fqc");
    ids.fqc = fqc.id;
    const [pay] = await db.select().from(payables).where(and(eq(payables.sourceId, ids.order), eq(payables.supplierId, ids.factory)));
    expect(pay!.amount).toBe(12_000_000);
    const [o] = await db.select().from(productionOrders).where(eq(productionOrders.id, ids.order));
    expect(o).toMatchObject({ status: "qc", totalCost: 16_800_000 });
    expect(Math.round(o!.totalCost / 296)).toBe(56_757);
  });

  it("AC-TICHHOP-4, AC-TICHHOP-17 (FQC): thiếu kim loại nặng → chặn, không đổi gì; đủ → released, stock 296, lệnh hoàn thành pass; bấm lần hai bị chặn", async () => {
    const db = await getDb();
    await db.insert(lotTests).values({ lotId: ids.lot, type: "microbial", result: "pass" });
    await expect(tx((t) => decideInspection(t, ids.fqc, { disposition: "accept" }, owner))).rejects.toThrow("Thiếu phiếu kiểm nghiệm Kim loại nặng");
    expect((await db.select().from(lots).where(eq(lots.id, ids.lot)))[0]!.releaseStatus).toBe("quarantine");
    expect((await db.select().from(qcInspections).where(eq(qcInspections.id, ids.fqc)))[0]!.status).toBe("pending");
    expect(await productStock()).toBe(0);

    await db.insert(lotTests).values({ lotId: ids.lot, type: "heavy_metals", result: "pass" });
    await tx((t) => decideInspection(t, ids.fqc, { disposition: "accept" }, owner));
    expect((await db.select().from(lots).where(eq(lots.id, ids.lot)))[0]!.releaseStatus).toBe("released");
    expect(await productStock()).toBe(296);
    await expect(tx((t) => decideInspection(t, ids.fqc, { disposition: "accept" }, owner))).rejects.toThrow(/vừa được người khác cập nhật|đã có kết luận|tải lại/);
    expect((await tx((t) => completeOrder(t, owner, ids.order))).qcResult).toBe("pass");
  });
});

describe("bán, giao, thu tiền, lãi lỗ", { timeout: 60_000 }, () => {
  let pnl0: Awaited<ReturnType<typeof pnl>>;

  it("AC-TICHHOP-5: khách web đặt 2 chai COD → stock 294, đã giữ 2, FG khả dụng 296", async () => {
    pnl0 = await pnl();
    const o = await web(2);
    ids.web1 = o.id;
    ids.web1Code = o.code;
    expect(await productStock()).toBe(294);
    expect(await fg()).toMatchObject({ available: 296, reserved: 2 });
  });

  it("AC-TICHHOP-6: sang đang giao chưa xuất kho → tự xuất FEFO lô PST-271120-01, sale_issue −2", async () => {
    const db = await getDb();
    await step(ids.web1, "confirmed");
    await step(ids.web1, "packing");
    await step(ids.web1, "shipping");
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.type, "sale_issue"), eq(stockMovements.stockLotId, ids.lotStock)));
    expect(mv.map((m) => m.qty)).toEqual([-2]);
    const items = await itemsOf(ids.web1);
    expect(items.every((i) => i.lotId === ids.lot)).toBe(true);
    expect((await orderRow(ids.web1)).stockIssuedAt).not.toBeNull();
    expect(await fg()).toMatchObject({ available: 294, reserved: 0 });
    expect(await productStock()).toBe(294);
  });

  it("AC-TICHHOP-7: đã giao → paid, phiếu thu 483.000đ vào COD khóa order-paid; lãi lỗ +458.000 / 25.000 / giá vốn 113.514 / lãi gộp 369.486", async () => {
    const db = await getDb();
    await step(ids.web1, "delivered");
    expect((await orderRow(ids.web1)).paymentStatus).toBe("paid");
    const cash = await db.select().from(cashTransactions).where(eq(cashTransactions.idempotencyKey, `order-paid:${ids.web1}`));
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({ amount: 483_000, accountId: ids.acc.COD, direction: "in" });
    const p = await pnl();
    expect(p.goodsRevenue - pnl0.goodsRevenue).toBe(458_000);
    expect(p.shippingIncome - pnl0.shippingIncome).toBe(25_000);
    expect(p.cogs - pnl0.cogs).toBe(113_514);
    expect(p.grossProfit - pnl0.grossProfit).toBe(369_486);
  });

  it("AC-TICHHOP-8: trả 1 chai lỗi → REJ, stock không tăng, phiếu chi 229.000đ từ NH, lãi lỗ hàng trả lại 229.000đ, giá vốn không giảm", async () => {
    const db = await getDb();
    const p1 = await pnl();
    const [item] = await itemsOf(ids.web1);
    const c = await createReturnRequest({ orderId: ids.web1, reason: "defect", reasonNote: "Vòi bơm kẹt", resolution: "refund", lines: [{ orderItemId: item!.id, qty: 1 }], refundAmount: 229_000, extraCost: 0, note: null }, owner);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(await approveReturn(c.id, owner)).toEqual({ ok: true });
    const view = await getReturn(c.id);
    const rej = await qtyIn(ids.lotStock, "REJ");
    const s = await productStock();
    expect(await receiveReturn(c.id, [{ lineId: view!.lines[0]!.line.id, condition: "defective", disposition: "quarantine" }], owner)).toEqual({ ok: true });
    expect(await qtyIn(ids.lotStock, "REJ")).toBe(rej + 1);
    expect(await productStock()).toBe(s);
    expect(await completeReturn(c.id, { refundAmount: 229_000, refundAccountId: ids.acc.NH }, owner)).toMatchObject({ ok: true });
    const cash = await db.select().from(cashTransactions).where(eq(cashTransactions.idempotencyKey, `rma-refund:${c.id}`));
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({ amount: 229_000, accountId: ids.acc.NH, direction: "out" });
    const p2 = await pnl();
    expect(p2.returns - p1.returns).toBe(229_000);
    expect(p2.cogs - p1.cogs).toBe(0);
    // "có nút tạo phản ánh gắn lô": phần dịch vụ createComplaintFromReturn đã có test ở sales-flow; nút trên trang kiểm ở trình duyệt
  });

  it("AC-TICHHOP-9: hoàn về do giao thất bại, nhập lại kho bán được → return_receipt +1 đúng lô, stock +1, delivery_failed, không doanh thu", async () => {
    const db = await getDb();
    const o = await web(1, "84901234568");
    await step(o.id, "confirmed");
    await step(o.id, "packing");
    await step(o.id, "shipping");
    const p1 = await pnl();
    const s = await productStock();
    const [item] = await itemsOf(o.id);
    await step(o.id, "returned", { returnLines: [{ orderItemId: item!.id, disposition: "restock" }] });
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.type, "return_receipt"), eq(stockMovements.orderItemId, item!.id)));
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ qty: 1, stockLotId: ids.lotStock, warehouseId: ids.wh.FG });
    expect(await productStock()).toBe(s + 1);
    expect(await orderRow(o.id)).toMatchObject({ status: "returned", returnType: "delivery_failed" });
    const p2 = await pnl();
    expect(p2.goodsRevenue - p1.goodsRevenue).toBe(0);
  });

  it("AC-TICHHOP-10: hủy đơn đã đóng gói → reversal +1 trỏ dòng xuất gốc, stock_issued_at null, stock +1; hủy lần hai không cộng thêm", async () => {
    const db = await getDb();
    const o = await web(1, "84901234569");
    await step(o.id, "confirmed");
    const items = await itemsOf(o.id);
    expect(await packOrder(o.id, { checkedItemIds: items.map((i) => i.id) }, owner.id)).toEqual({ ok: true });
    const s = await productStock();
    const [issue] = await db.select().from(stockMovements).where(and(eq(stockMovements.type, "sale_issue"), eq(stockMovements.orderItemId, items[0]!.id)));
    await step(o.id, "cancelled");
    const rev = await db.select().from(stockMovements).where(eq(stockMovements.reversalOf, issue!.id));
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ type: "reversal", qty: 1 });
    expect((await orderRow(o.id)).stockIssuedAt).toBeNull();
    expect(await productStock()).toBe(s + 1);
    const again = await changeOrderStatus(o.id, "cancelled", owner.id, "lần hai");
    expect(again.ok).toBe(false);
    expect(await productStock()).toBe(s + 1);
  });

  it("AC-TICHHOP-17: xuất kho đơn (2 lần đồng thời), đánh dấu đã thu (2 lần đồng thời) → một nhóm biến động, một phiếu thu", async () => {
    const db = await getDb();
    const o = await web(1, "84901234570");
    await step(o.id, "confirmed");
    const items = await itemsOf(o.id);
    const both = await Promise.all([tx((t) => issueOrderStock(t, o.id, {}, owner.id)), tx((t) => issueOrderStock(t, o.id, {}, owner.id))]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    const lost = both.find((r) => !r.ok) as { ok: false; message: string };
    expect(lost.message).toMatch(/vừa được người khác cập nhật/);
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.type, "sale_issue"), eq(stockMovements.orderItemId, items[0]!.id)));
    expect(mv).toHaveLength(1);
    // Bấm "Đóng gói" hai lần cùng lúc: không xuất kho lần hai
    await Promise.all([packOrder(o.id, { checkedItemIds: items.map((i) => i.id) }, owner.id), packOrder(o.id, { checkedItemIds: items.map((i) => i.id) }, owner.id)]);
    expect(await db.select().from(stockMovements).where(and(eq(stockMovements.type, "sale_issue"), eq(stockMovements.orderItemId, items[0]!.id)))).toHaveLength(1);
    const { setPaymentStatus } = await import("@/modules/orders/service");
    await Promise.all([setPaymentStatus(o.id, "paid", owner.id, null), setPaymentStatus(o.id, "paid", owner.id, null)]);
    expect(await db.select().from(cashTransactions).where(eq(cashTransactions.idempotencyKey, `order-paid:${o.id}`))).toHaveLength(1);
    await step(o.id, "shipping");
    await step(o.id, "delivered");
    expect(await db.select().from(cashTransactions).where(eq(cashTransactions.idempotencyKey, `order-paid:${o.id}`))).toHaveLength(1);
  });

  it("BUG-3 AC-TICHHOP-17: bấm Đóng gói hai lần → lần hai phải nhận 'vừa được người khác cập nhật', không ghi thêm sự kiện packed", async () => {
    const db = await getDb();
    const { orderEvents } = await import("@/db/schema");
    const o = await web(1, "84901234571");
    await step(o.id, "confirmed");
    const items = await itemsOf(o.id);
    const r = await Promise.all([packOrder(o.id, { checkedItemIds: items.map((i) => i.id) }, owner.id), packOrder(o.id, { checkedItemIds: items.map((i) => i.id) }, owner.id)]);
    const packed = await db.select().from(orderEvents).where(and(eq(orderEvents.orderId, o.id), eq(orderEvents.type, "packed")));
    // dọn trước khi kiểm để phần sau của chuỗi không bị lệch
    await step(o.id, "shipping");
    await step(o.id, "delivered");
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(packed).toHaveLength(1);
  });
});

describe("truy xuất, phản ánh, thu hồi", { timeout: 60_000 }, () => {
  it("AC-TICHHOP-13: ngược ra LSX, lô VT, PN, NCC-004, IQC; xuôi từ lô VT ra LSX → lô TP → các đơn", async () => {
    const db = await getDb();
    const nodes = flatten((await traceBackward(db, ids.lot))!);
    expect(nodes.find((n) => n.kind === "production_order")!.code).toBe(ids.orderCode);
    const tdCode = (await db.select().from(stockLots).where(eq(stockLots.id, ids.tdLot)))[0]!.code;
    const td = nodes.find((n) => n.code === tdCode)!;
    expect(td).toBeTruthy();
    expect(td.qty).toBe("150 ml");
    const meta = td.meta.join(" | ");
    expect(meta).toContain("NCC-004");
    expect(meta).toContain(ids.tdReceiptCode);
    expect(meta).toContain(ids.iqcCode);

    const fwd = await traceForward(db, { kind: "stock_lot", id: ids.tdLot }, true);
    const fn = flatten(fwd.tree!);
    expect(fn.find((n) => n.kind === "production_order")!.code).toBe(ids.orderCode);
    expect(fn.find((n) => n.kind === "lot")!.code).toBe("PST-271120-01");
    const web1 = fwd.orders.find((r) => r.orderCode === ids.web1Code);
    expect(web1).toMatchObject({ qty: 2, phone: "84901234567" });
  });

  it("AC-TICHHOP-14, AC-CL-28: 2 đơn giữ 3 chai; phản ánh thứ 3 trong 7 ngày → on_hold, stock 0, xuất kho bị từ chối, cảnh báo 2 đơn", async () => {
    const db = await getDb();
    // Đặc tả: 294; ở đây ít hơn 2 vì test bấm hai lần phía trên đã bán thêm 2 chai
    const avail = (await fg()).available;
    expect(avail).toBe(292);
    const a = await web(2, "84901230001");
    const b = await web(1, "84901230002");
    await step(a.id, "confirmed");
    await step(b.id, "confirmed");
    const ids3: string[] = [];
    for (const [i, phone] of ["0901000001", "0901000002", "0901000003"].entries()) {
      const r = await submitComplaint({ lotNo: "PST-271120-01", sampleCode: null, contactPhone: phone, startedUsingOn: null, symptoms: `Ngứa nhẹ ${i}`, severity: "mild" });
      ids3.push(r.complaintId);
      if (i < 2) expect((await db.select().from(lots).where(eq(lots.id, ids.lot)))[0]!.releaseStatus).toBe("released");
    }
    expect((await db.select().from(lots).where(eq(lots.id, ids.lot)))[0]!.releaseStatus).toBe("on_hold");
    expect(await productStock()).toBe(0);
    const ra = await tx((t) => issueOrderStock(t, a.id, {}, owner.id));
    expect(ra).toMatchObject({ ok: false, message: "Không đủ hàng khả dụng cho Pomelo Scalp Tonic: cần 2, còn 0" });
    const rb = await tx((t) => issueOrderStock(t, b.id, {}, owner.id));
    expect(rb).toMatchObject({ ok: false, message: "Không đủ hàng khả dụng cho Pomelo Scalp Tonic: cần 1, còn 0" });
    const alerts = await inventoryAlerts("owner");
    expect(alerts.map((x) => x.text)).toContain("2 đơn đang giữ vượt tồn khả dụng");

    // phản ánh → NCR → CAPA (xuyên Bán hàng/Chất lượng)
    const n = await tx((t) => createNcrFromComplaint(t, ids3[2]!, collab));
    const [ncr] = await db.select().from(ncrs).where(eq(ncrs.id, n.id));
    expect(ncr).toMatchObject({ category: "customer_complaint", lotId: ids.lot });
    const capa = await tx((t) => createCapaFromComplaint(t, ids3[2]!, collab));
    expect((await db.select().from(capas).where(eq(capas.id, capa.id)))[0]!.ncrId).toBe(n.id);
    expect(await db.select().from(capaActions).where(eq(capaActions.capaId, capa.id))).toHaveLength(7);
    expect((await db.select().from(complaints).where(eq(complaints.id, ids3[2]!)))[0]!.status).toBe("investigating");

    // mở khóa → bán lại được; hủy 2 đơn giữ để phần thu hồi sạch
    await setLotHold(ids.lot, false, "QA kiểm xong", owner.id);
    expect((await db.select().from(lots).where(eq(lots.id, ids.lot)))[0]!.releaseStatus).toBe("released");
    expect(await productStock()).toBe(avail - 3);
    await step(a.id, "cancelled");
    await step(b.id, "cancelled");
    expect(await productStock()).toBe(avail);
  });

  it("AC-TICHHOP-15: thu hồi → recalled, FG của lô sang REJ, liên hệ theo đơn đã nhận; nhập 1 chai thu về, số liệu khớp sổ", async () => {
    const db = await getDb();
    const fgBefore = await qtyIn(ids.lotStock, "FG");
    const rejBefore = await qtyIn(ids.lotStock, "REJ");
    const r = await tx((t) => openRecall(t, { reason: "QA thử thu hồi", severity: "major", lotIds: [ids.lot] }, owner));
    expect(r.movedQty).toBe(fgBefore);
    expect((await db.select().from(lots).where(eq(lots.id, ids.lot)))[0]!.releaseStatus).toBe("recalled");
    expect(await qtyIn(ids.lotStock, "FG")).toBe(0);
    expect(await qtyIn(ids.lotStock, "REJ")).toBe(rejBefore + fgBefore);
    expect(await productStock()).toBe(0);
    const contacts = await db.select().from(recallContacts).where(eq(recallContacts.recallId, r.id));
    const c1 = contacts.find((c) => c.orderId === ids.web1);
    expect(c1).toBeTruthy();
    const [item] = await itemsOf(ids.web1);
    await tx((t) => receiveRecallReturn(t, c1!.id, [{ orderItemId: item!.id, qty: 1 }], collab));
    const stats = await recallStats(db, r.id);
    const bal = await lotBalance(db, ids.lot);
    expect(stats[0]!.recovered).toBe(1);
    expect(stats[0]!.onHand).toBe(bal.onHand);
    expect(bal.balanced).toBe(true);
  });
});

describe("IQC trả NCC, hủy phiếu nhập", { timeout: 60_000 }, () => {
  it("AC-TICHHOP-16: 300 nhãn chờ IQC, phải trả 450.000đ; trả NCC → rejected, REJ, NCR; ghi sổ PX trả NCC → phải trả cancelled, lý do có mã PX, REJ 0", async () => {
    const db = await getDb();
    const r = await tx((t) =>
      postReceipt(t, { kind: "purchase", warehouseId: ids.wh.PKG!, supplierId: ids.pkgSupplier, receivedOn: today, paymentMode: "payable", lines: [{ itemId: ids.bb[2]!, qty: 300, lineCost: 450_000, qcRequired: true }] }, owner.id),
    );
    const lotId = r.lines[0]!.stockLotId;
    const iqc = await pendingInspection(eq(qcInspections.stockReceiptId, r.receiptId));
    await tx((t) => decideInspection(t, iqc.id, { disposition: "return_to_supplier", note: "In sai màu" }, owner));
    expect((await db.select().from(stockLots).where(eq(stockLots.id, lotId)))[0]!.qcStatus).toBe("rejected");
    expect(await qtyIn(lotId, "REJ")).toBe(300);
    const [ncr] = await db.select().from(ncrs).where(eq(ncrs.inspectionId, iqc.id));
    expect(ncr).toBeTruthy();
    // 00 TICHHOP-16 ghi "loại supplier"; 03 R-CL-8 ghi loại theo hàng (bao bì → packaging). Ghi nhận thực tế:
    expect(["supplier", "packaging"]).toContain(ncr!.category);
    const [issue] = await db.select().from(stockIssues).where(and(eq(stockIssues.kind, "supplier_return"), eq(stockIssues.status, "draft")));
    expect(issue).toBeTruthy();
    await tx((t) => postIssueDraft(t, issue!.id, owner.id));
    const [pay] = await db.select().from(payables).where(eq(payables.sourceId, r.receiptId));
    expect(pay!.status).toBe("cancelled");
    expect(`${pay!.cancelReason ?? ""} ${pay!.note ?? ""}`).toContain(issue!.code);
    expect(await qtyIn(lotId, "REJ")).toBe(0);
  });

  it("hủy phiếu nhập chưa dùng → IQC chờ bị hủy, phải trả hủy; phiếu nhập đã xuất thì bị chặn", async () => {
    const db = await getDb();
    const r = await tx((t) =>
      postReceipt(t, { kind: "purchase", warehouseId: ids.wh.EXT!, supplierId: ids.ncc004, receivedOn: today, paymentMode: "payable", lines: [{ itemId: ids.td, qty: 500_000, lineCost: 1_000_000 }] }, owner.id),
    );
    const iqc = await pendingInspection(eq(qcInspections.stockReceiptId, r.receiptId));
    await tx((t) => cancelReceipt(t, r.receiptId, "Nhập nhầm", owner.id));
    expect((await db.select().from(qcInspections).where(eq(qcInspections.id, iqc.id)))[0]!.status).toBe("cancelled");
    expect((await db.select().from(payables).where(eq(payables.sourceId, r.receiptId)))[0]!.status).toBe("cancelled");
    expect((await db.select().from(stockReceipts).where(eq(stockReceipts.id, r.receiptId)))[0]!.status).toBe("cancelled");
    // phiếu nhập tinh dầu đầu chuỗi đã xuất cho LSX → không hủy được
    const [first] = await db.select().from(stockReceipts).where(eq(stockReceipts.code, ids.tdReceiptCode));
    await expect(tx((t) => cancelReceipt(t, first!.id, "thử", owner.id))).rejects.toThrow(/đã có xuất kho|đã xuất/);
  });
});

describe("lô hết hạn (AC-TICHHOP-18)", { timeout: 60_000 }, () => {
  it("AC-TICHHOP-18: lô A hết hạn 5 chai, lô B 10 chai → stock chỉ tính B; FEFO bỏ A; chọn tay A bị từ chối 'đã hết hạn'", async () => {
    const db = await getDb();
    await db.update(products).set({ status: "active" }).where(eq(products.id, ids.pstm));
    await enableInventoryTracking(ids.pstm, true, owner.id);
    ids.fgItemM = (await db.select().from(inventoryItems).where(eq(inventoryItems.productId, ids.pstm)))[0]!.id;
    const mk = async (lotNo: string, expiresOn: string, units: number) => {
      const [row] = await db
        .insert(lots)
        .values({ lotNo, productId: ids.pstm, formulaVersion: "v1", manufacturedOn: "2025-11-01", expiresOn, unitsProduced: units, releaseStatus: "released", releasedAt: new Date() })
        .returning({ id: lots.id });
      await tx((t) =>
        postReceipt(t, { kind: "opening", warehouseId: ids.wh.FG!, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.fgItemM, qty: units, lineCost: units * 30_000, productLotId: row!.id }] }, owner.id),
      );
      return { lotId: row!.id, stockLotId: (await db.select().from(stockLots).where(eq(stockLots.productLotId, row!.id)))[0]!.id };
    };
    // Nhập lô A còn hạn, rồi giả lập thời gian trôi: dời hạn lô A về trước hôm nay (không nhập được hàng đã hết hạn)
    const A = await mk("PSTM-QA-A", "2027-12-01", 5);
    const B = await mk("PSTM-QA-B", "2029-06-01", 10);
    expect(await productStock(ids.pstm)).toBe(15);
    await db.update(lots).set({ expiresOn: "2026-11-10" }).where(eq(lots.id, A.lotId));
    await db.update(stockLots).set({ expiresOn: "2026-11-10" }).where(eq(stockLots.id, A.stockLotId));
    await refreshExpiredStock(db, new Date());
    expect(await productStock(ids.pstm)).toBe(10);

    const o = await web(1, "84901239999", ids.pstm);
    await step(o.id, "confirmed");
    const items = await itemsOf(o.id);
    const bad = await packOrder(o.id, { checkedItemIds: items.map((i) => i.id), picks: [{ orderItemId: items[0]!.id, stockLotId: A.stockLotId, qty: 1 }] }, owner.id);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.message).toContain("đã hết hạn");
    expect(await packOrder(o.id, { checkedItemIds: items.map((i) => i.id) }, owner.id)).toEqual({ ok: true });
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.type, "sale_issue"), eq(stockMovements.orderItemId, items[0]!.id)));
    expect(mv.map((m) => m.stockLotId)).toEqual([B.stockLotId]);
  });

  it("BUG-2 AC-TICHHOP-18: câu từ chối nêu đúng tên lô 'Lô PSTM-QA-A đã hết hạn' (hiện là câu gộp 'chưa duyệt, đang bị giữ hoặc đã hết hạn')", async () => {
    const db = await getDb();
    const [a] = await db.select().from(stockLots).innerJoin(lots, eq(lots.id, stockLots.productLotId)).where(eq(lots.lotNo, "PSTM-QA-A"));
    const o = await web(1, "84901239998", ids.pstm);
    await step(o.id, "confirmed");
    const items = await itemsOf(o.id);
    const bad = await packOrder(o.id, { checkedItemIds: items.map((i) => i.id), picks: [{ orderItemId: items[0]!.id, stockLotId: a!.stock_lots.id, qty: 1 }] }, owner.id);
    expect(!bad.ok && bad.message).toMatch(/^Lô PSTM-QA-A đã hết hạn/);
  });
});

describe("bất biến (AC-TICHHOP-20)", { timeout: 120_000 }, () => {
  it("AC-TICHHOP-20: sau toàn chuỗi, INV-1…INV-9 đúng", async () => {
    const v = await checkInvariants({ releasedLotIds: [ids.lot], productLotIds: [ids.lot] });
    expect(v).toEqual([]);
  });
});
