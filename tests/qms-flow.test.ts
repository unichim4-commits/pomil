import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-qms-flow-"));
process.env.PGLITE_DIR = dir;
process.env.PGLITE_SEED = "production"; // dữ liệu chạy thử ERP (seed-erp-demo) tạo sẵn tiêu chuẩn TC-002 và lô; test tự dựng dữ liệu

import { and, eq } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import {
  auditLog,
  capaActions,
  capas,
  complaints,
  extractionRuns,
  inventoryItems,
  lots,
  lotTests,
  ncrs,
  notifications,
  orderItems,
  orders,
  productionOrders,
  productionOrderSteps,
  products,
  qcInspectionResults,
  qcInspections,
  qcStandards,
  recallContacts,
  retainedSamples,
  staffUsers,
  stockBalances,
  stockIssues,
  stockLots,
  stockTransfers,
  suppliers,
  warehouses,
} from "@/db/schema";
import { enableInventoryTracking, getItemStock, issueOrderStock, postIssue, postReceipt } from "@/modules/inventory/ledger";
import { addDays } from "@/modules/inventory/rules";
import { vnToday } from "@/modules/numbering/rules";
import { computeQmsAlerts } from "@/modules/qms/alerts";
import { addCapaAction, createCapa, createCapaFromComplaint, recordCapaEffectiveness, setCapaActionDone, transitionCapa } from "@/modules/qms/capa";
import { addInspectionParam, decideInspection, evaluateInspection, openFqcForLot, openRecheck, saveInspectionResults } from "@/modules/qms/decisions";
import { cancelInspection, createInspection, hasBlockingDeviation } from "@/modules/qms/inspections";
import { createRetainedSample, setStockLotHold } from "@/modules/qms/lots";
import { createNcr, createNcrFromComplaint, transitionNcr, updateNcr } from "@/modules/qms/ncr";
import { closeRecall, openRecall, recallStats, receiveRecallReturn, recordRecallContact } from "@/modules/qms/recall";
import { INSPECTION_STALE, PERMISSION_DENIED, type Actor } from "@/modules/qms/rules";
import { activateStandard, createStandard, newStandardVersion, updateStandardDraft } from "@/modules/qms/standards";
import { lotBalance, resolveTraceCode, traceBackward, traceForward, type TraceNode } from "@/modules/qms/trace";
import { submitComplaint } from "@/modules/quality/service";

// T-16: luồng chính của phân hệ Chất lượng trên PGlite (03-chat-luong.md AC-CL-*)

const today = vnToday();
const owner: Actor = { id: "", role: "owner" };
const collab: Actor = { id: "", role: "collaborator" };
const viewer: Actor = { id: "", role: "viewer" };
const ids = { supplier: "", nl: "", bb: "", td: "", pst: "", pstItem: "", wh: {} as Record<string, string> };

async function tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}
async function item(code: string, kind: "raw_material" | "extract" | "packaging", baseUom: "mg" | "ul" | "pcs", requiresIqc = true) {
  const db = await getDb();
  const [row] = await db
    .insert(inventoryItems)
    .values({ code, name: code, kind, baseUom, displayUom: baseUom === "ul" ? "ml" : baseUom === "mg" ? "g" : "cái", purchaseUom: baseUom === "ul" ? "l" : "cái", requiresIqc })
    .returning({ id: inventoryItems.id });
  return row!.id;
}
async function purchase(itemId: string, wh: string, qty: number, qcRequired = true, supplierLotNo: string | null = null) {
  const r = await tx((t) =>
    postReceipt(t, { kind: "purchase", warehouseId: ids.wh[wh]!, supplierId: ids.supplier, receivedOn: today, paymentMode: "none", lines: [{ itemId, qty, lineCost: 0, qcRequired, supplierLotNo }] }, owner.id),
  );
  return { receiptId: r.receiptId, receiptCode: r.code, stockLotId: r.lines[0]!.stockLotId };
}
async function pendingInspectionOf(where: { stockLotId?: string; lotId?: string }) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(qcInspections)
    .where(and(eq(qcInspections.status, "pending"), where.stockLotId ? eq(qcInspections.stockLotId, where.stockLotId) : eq(qcInspections.lotId, where.lotId!)));
  return row!;
}
async function qtyIn(stockLotId: string, whCode: string) {
  const db = await getDb();
  const rows = await db.select({ qty: stockBalances.qty }).from(stockBalances).where(and(eq(stockBalances.stockLotId, stockLotId), eq(stockBalances.warehouseId, ids.wh[whCode]!)));
  return rows.reduce((s, r) => s + r.qty, 0);
}
async function stockOf(productId: string) {
  const db = await getDb();
  return (await db.select({ s: products.stock }).from(products).where(eq(products.id, productId)))[0]!.s;
}
function flatten(n: TraceNode | null): TraceNode[] {
  return n ? [n, ...n.children.flatMap(flatten)] : [];
}
async function newProductLot(lotNo: string, units: number) {
  const db = await getDb();
  const [lot] = await db.insert(lots).values({ lotNo, productId: ids.pst, formulaVersion: "PST-v1", manufacturedOn: "2026-11-01", expiresOn: "2029-11-01", unitsProduced: units }).returning({ id: lots.id });
  return lot!.id;
}
async function insertOrder(code: string, qty: number, status: "confirmed" | "cancelled", phone: string) {
  const db = await getDb();
  const [o] = await db
    .insert(orders)
    .values({ code, status, paymentMethod: "cod", recipientName: `Khách ${code}`, phoneE164: phone, province: "Hà Nội", ward: "P", addressLine: "1", subtotal: 229_000 * qty, shippingFee: 0, total: 229_000 * qty, accessToken: "t" })
    .returning({ id: orders.id });
  const [i] = await db.insert(orderItems).values({ orderId: o!.id, productId: ids.pst, productName: "Tonic", unitPrice: 229_000, quantity: qty, lineTotal: 229_000 * qty }).returning({ id: orderItems.id });
  return { orderId: o!.id, itemId: i!.id };
}

beforeAll(async () => {
  const db = await getDb();
  const staff = await db
    .insert(staffUsers)
    .values([
      { email: "owner@qms.vn", role: "owner", passwordHash: "x" },
      { email: "ctv@qms.vn", role: "collaborator", passwordHash: "x" },
      { email: "view@qms.vn", role: "viewer", passwordHash: "x" },
    ])
    .returning({ id: staffUsers.id, role: staffUsers.role });
  owner.id = staff.find((s) => s.role === "owner")!.id;
  collab.id = staff.find((s) => s.role === "collaborator")!.id;
  viewer.id = staff.find((s) => s.role === "viewer")!.id;
  for (const w of await db.select().from(warehouses)) ids.wh[w.code] = w.id;
  const [sup] = await db.insert(suppliers).values({ code: "NCC-Q04", name: "Tinh dầu thử", kind: "material", qualified: false }).returning({ id: suppliers.id });
  ids.supplier = sup!.id;
  ids.nl = await item("QNL-003", "raw_material", "mg");
  ids.bb = await item("QBB-003", "packaging", "pcs");
  ids.td = await item("QTD-001", "extract", "ul");
  ids.pst = (await db.select().from(products).where(eq(products.code, "PST")))[0]!.id;
  ids.pstItem = (await db.select().from(inventoryItems).where(eq(inventoryItems.productId, ids.pst)))[0]!.id;
  await db.insert(notifications).values({ productId: ids.pst, number: "QMS-CB", issuedAt: "2026-01-01", expiresAt: "2031-01-01" });
  await enableInventoryTracking(ids.pst, true, owner.id);
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Tiêu chuẩn và IQC", { timeout: 60_000 }, () => {
  let stdId = "";
  let iqcV1 = "";

  it("AC-CL-1, AC-CL-2: TC v1 gắn hàng; phiếu IQC chụp giới hạn v1; v2 kích hoạt → v1 archived, phiếu cũ giữ v1", async () => {
    const db = await getDb();
    const params = [
      { name: "pH", paramGroup: "physicochemical" as const, kind: "range" as const, minMilli: 4500, maxMilli: 5500 },
      { name: "Cảm quan", paramGroup: "sensory" as const, kind: "pass_fail" as const },
      { name: "Tạp chất", paramGroup: "physicochemical" as const, kind: "pass_fail" as const, isCritical: false },
      { name: "Vi sinh", paramGroup: "microbial" as const, kind: "pass_fail" as const },
    ];
    const created = await tx((t) => createStandard(t, { name: "Nguyên liệu NL-003", appliesTo: "raw_material", itemId: ids.nl, params }, collab));
    stdId = created.id;
    expect(created.code).toMatch(/^TC-\d{3}$/);
    await expect(tx((t) => activateStandard(t, stdId, collab))).rejects.toThrow(PERMISSION_DENIED);
    await tx((t) => activateStandard(t, stdId, owner));
    // Tiêu chuẩn chung nhóm raw_material (không dùng cho NL-003 vì đã có tiêu chuẩn gắn hàng)
    const general = await tx((t) => createStandard(t, { name: "Chung nguyên liệu", appliesTo: "raw_material", params: [{ name: "Độ ẩm", paramGroup: "physicochemical", kind: "range", maxMilli: 10_000 }] }, owner));
    await tx((t) => activateStandard(t, general.id, owner));

    const lot = await purchase(ids.nl, "RAW", 5_000_000);
    const insp = await pendingInspectionOf({ stockLotId: lot.stockLotId });
    iqcV1 = insp.id;
    expect(insp.standardId).toBe(stdId);
    expect(insp.stockReceiptId).toBe(lot.receiptId);

    const v2 = await tx((t) => newStandardVersion(t, stdId, owner));
    expect(v2).toMatchObject({ version: 2, created: true });
    await tx((t) => updateStandardDraft(t, v2.id, { name: "Nguyên liệu NL-003", appliesTo: "raw_material", itemId: ids.nl, params: params.map((p) => (p.name === "pH" ? { ...p, minMilli: 5000, maxMilli: 6000 } : p)) }, owner));
    await tx((t) => activateStandard(t, v2.id, owner));
    const rows = await db.select().from(qcStandards).where(eq(qcStandards.code, created.code));
    expect(rows.find((r) => r.version === 1)!.status).toBe("archived");
    expect(rows.find((r) => r.version === 2)!.status).toBe("active");
    const ph = (await db.select().from(qcInspectionResults).where(eq(qcInspectionResults.inspectionId, iqcV1))).find((r) => r.name === "pH")!;
    expect([ph.minMilli, ph.maxMilli]).toEqual([4500, 5500]);
  });

  it("AC-CL-2: hàng khác không có tiêu chuẩn → phiếu không có chỉ tiêu, thêm chỉ tiêu tự do được", async () => {
    const lot = await purchase(ids.bb, "PKG", 10);
    const insp = await pendingInspectionOf({ stockLotId: lot.stockLotId });
    expect(insp.standardId).toBeNull();
    await tx((t) => addInspectionParam(t, insp.id, { name: "Màu nhãn", paramGroup: "label", kind: "pass_fail" }, collab));
    const { results, verdict } = await evaluateInspection(await getDb(), insp);
    expect(results).toHaveLength(1);
    expect(verdict).toBe("incomplete");
    await tx((t) => cancelInspection(t, insp.id, "Thử", owner.id));
  });

  it("AC-CL-3, AC-CL-4: nhập 'abc' lỗi; kết luận 'Cần xem xét'; Đạt bị chặn; chấp nhận có điều kiện cần lý do", async () => {
    const db = await getDb();
    const results = await db.select().from(qcInspectionResults).where(eq(qcInspectionResults.inspectionId, iqcV1));
    const id = (n: string) => results.find((r) => r.name === n)!.id;
    await expect(tx((t) => saveInspectionResults(t, iqcV1, { entries: [{ resultId: id("pH"), value: "abc" }] }, collab))).rejects.toThrow(/pH: "abc" không phải số/);
    await tx((t) => saveInspectionResults(t, iqcV1, { entries: [{ resultId: id("pH"), value: "5,6" }] }, collab));
    expect((await db.select().from(qcInspectionResults).where(eq(qcInspectionResults.id, id("pH"))))[0]!.passed).toBe(false);
    await tx((t) =>
      saveInspectionResults(
        t,
        iqcV1,
        {
          entries: [
            { resultId: id("pH"), value: "5,5" },
            { resultId: id("Cảm quan"), passFail: "pass" },
            { resultId: id("Tạp chất"), passFail: "fail" },
            { resultId: id("Vi sinh"), passFail: "pass" },
          ],
        },
        collab,
      ),
    );
    const insp = (await db.select().from(qcInspections).where(eq(qcInspections.id, iqcV1)))[0]!;
    expect((await evaluateInspection(db, insp)).verdict).toBe("review");
    await expect(tx((t) => decideInspection(t, iqcV1, { disposition: "accept" }, owner))).rejects.toThrow(/Chỉ chọn Đạt/);
    await expect(tx((t) => decideInspection(t, iqcV1, { disposition: "use_as_is", note: "" }, owner))).rejects.toThrow("Ghi lý do chấp nhận có điều kiện");
    const r = await tx((t) => decideInspection(t, iqcV1, { disposition: "use_as_is", note: "Tạp chất nằm trong mức nhà máy chấp nhận" }, owner));
    expect(r.status).toBe("passed");
    const after = (await db.select().from(qcInspections).where(eq(qcInspections.id, iqcV1)))[0]!;
    expect(after).toMatchObject({ status: "passed", disposition: "use_as_is", decidedBy: owner.id });
    expect(after.decidedAt).not.toBeNull();
    expect((await db.select().from(stockLots).where(eq(stockLots.id, insp.stockLotId!)))[0]!.qcStatus).toBe("released");
  });

  it("AC-CL-5, AC-CL-6, AC-CL-9: BB-003 300 nhãn; CTV bấm Đạt lỗi quyền; chủ Đạt → khả dụng 300; lần hai báo vừa cập nhật", async () => {
    const db = await getDb();
    const lot = await purchase(ids.bb, "PKG", 300);
    const insp = await pendingInspectionOf({ stockLotId: lot.stockLotId });
    const [sup] = await db.select({ qualified: suppliers.qualified }).from(suppliers).where(eq(suppliers.id, insp.supplierId!));
    expect(sup!.qualified).toBe(false); // trang phiếu hiện "Nhà cung cấp chưa được đánh giá", không chặn
    await expect(tx((t) => decideInspection(t, insp.id, { disposition: "accept" }, collab))).rejects.toThrow(PERMISSION_DENIED);
    const before = (await getItemStock(db, [ids.bb])).get(ids.bb)!.available;
    await tx((t) => decideInspection(t, insp.id, { disposition: "accept" }, owner));
    expect((await getItemStock(db, [ids.bb])).get(ids.bb)!.available).toBe(before + 300);
    await expect(tx((t) => decideInspection(t, insp.id, { disposition: "reject", note: "x" }, owner))).rejects.toThrow(INSPECTION_STALE);
    expect((await db.select().from(stockLots).where(eq(stockLots.id, lot.stockLotId)))[0]!.qcStatus).toBe("released");
  });

  it("AC-CL-7: không đạt → lô rejected, số dư sang REJ một phiếu DCK, NCR material major gắn NCC, lô, phiếu", async () => {
    const db = await getDb();
    const lot = await purchase(ids.nl, "RAW", 2_000_000);
    const insp = await pendingInspectionOf({ stockLotId: lot.stockLotId });
    const r = await tx((t) => decideInspection(t, insp.id, { disposition: "reject", note: "Màu lạ" }, owner));
    expect(r.movedQty).toBe(2_000_000);
    expect((await db.select().from(stockLots).where(eq(stockLots.id, lot.stockLotId)))[0]!.qcStatus).toBe("rejected");
    expect(await qtyIn(lot.stockLotId, "REJ")).toBe(2_000_000);
    expect(await qtyIn(lot.stockLotId, "RAW")).toBe(0);
    expect(await db.select().from(stockTransfers).where(eq(stockTransfers.sourceId, insp.id))).toHaveLength(1);
    const [ncr] = await db.select().from(ncrs).where(eq(ncrs.inspectionId, insp.id));
    expect(ncr).toMatchObject({ category: "material", severity: "major", supplierId: ids.supplier, stockLotId: lot.stockLotId, title: `IQC không đạt: QNL-003 lô ${(await db.select().from(stockLots).where(eq(stockLots.id, lot.stockLotId)))[0]!.code}` });
  });

  it("AC-CL-8: trả NCC → như không đạt và có phiếu xuất supplier_return nháp ở REJ đủ số dư", async () => {
    const db = await getDb();
    const lot = await purchase(ids.bb, "PKG", 300);
    const insp = await pendingInspectionOf({ stockLotId: lot.stockLotId });
    const r = await tx((t) => decideInspection(t, insp.id, { disposition: "return_to_supplier", note: "In sai màu" }, owner));
    expect(r.ncr).not.toBeNull();
    const [issue] = await db.select().from(stockIssues).where(eq(stockIssues.id, r.supplierReturn!.issueId));
    expect(issue).toMatchObject({ kind: "supplier_return", status: "draft", warehouseId: ids.wh.REJ });
    expect(await qtyIn(lot.stockLotId, "REJ")).toBe(300); // chưa ghi sổ: REJ vẫn giữ
  });

  it("R-CL-22: khóa lô vật tư (CTV) và mở khóa (chủ)", async () => {
    const lot = await purchase(ids.bb, "PKG", 5, false);
    await tx((t) => setStockLotHold(t, lot.stockLotId, true, "Nghi lẫn lô", collab));
    await expect(tx((t) => setStockLotHold(t, lot.stockLotId, false, null, collab))).rejects.toThrow(PERMISSION_DENIED);
    await tx((t) => setStockLotHold(t, lot.stockLotId, false, null, owner));
    const db = await getDb();
    expect((await db.select().from(stockLots).where(eq(stockLots.id, lot.stockLotId)))[0]!.qcStatus).toBe("released");
  });
});

describe("IPQC, mẻ chiết", { timeout: 60_000 }, () => {
  it("AC-CL-11, AC-CL-12: IPQC Phối trộn ngoài giới hạn → chặn lệnh, cảnh báo danger; IPQC đạt muộn hơn → hết chặn", async () => {
    const db = await getDb();
    const [po] = await db.insert(productionOrders).values({ code: "LSX-QMS-011", kind: "outsourced", productId: ids.pst, plannedUnits: 100, status: "in_progress" }).returning({ id: productionOrders.id });
    const [step] = await db.insert(productionOrderSteps).values({ productionOrderId: po!.id, seq: 1, name: "Phối trộn", needsQc: true }).returning({ id: productionOrderSteps.id });
    const a = await tx((t) => createInspection(t, { stage: "ipqc", productionStepId: step!.id }, owner.id));
    const p = await tx((t) => addInspectionParam(t, a.id, { name: "Nhiệt độ", paramGroup: "physicochemical", kind: "range", unit: "°C", min: "60", max: "70" }, collab));
    await tx((t) => saveInspectionResults(t, a.id, { entries: [{ resultId: p.id, value: "75" }] }, collab));
    expect((await db.select().from(qcInspectionResults).where(eq(qcInspectionResults.id, p.id)))[0]!.passed).toBe(false);
    await tx((t) => decideInspection(t, a.id, { disposition: "reject", note: "Quá nhiệt" }, owner));
    expect(await hasBlockingDeviation(db, { productionOrderId: po!.id })).toBe(true);
    const alerts = await computeQmsAlerts(db, today);
    expect(alerts).toContainEqual(expect.objectContaining({ level: "danger", text: "IPQC lệch: LSX-QMS-011, công đoạn Phối trộn" }));

    const b = await tx((t) => createInspection(t, { stage: "ipqc", productionStepId: step!.id }, owner.id));
    expect(b.created).toBe(true);
    await tx((t) => decideInspection(t, b.id, { disposition: "accept" }, owner));
    expect(await hasBlockingDeviation(db, { productionOrderId: po!.id })).toBe(false);
    expect((await computeQmsAlerts(db, today)).some((x) => x.text.includes("LSX-QMS-011"))).toBe(false);
  });

  it("AC-CL-13: mẻ chiết Đạt → lô EX released; mẻ khác Không đạt → rejected, REJ, NCR extract gắn mẻ", async () => {
    const db = await getDb();
    const run = async (code: string) => {
      const [r] = await db.insert(extractionRuns).values({ code, method: "steam_distillation", outputItemId: ids.td, status: "completed" }).returning({ id: extractionRuns.id });
      const rec = await tx((t) =>
        postReceipt(t, { kind: "extraction", warehouseId: ids.wh.EXT!, receivedOn: today, source: { type: "extraction_run", id: r!.id }, paymentMode: "none", lines: [{ itemId: ids.td, qty: 500_000, lineCost: 0, qcRequired: true }] }, owner.id),
      );
      return { runId: r!.id, stockLotId: rec.lines[0]!.stockLotId };
    };
    const ok = await run("CX-QMS-001");
    const ip = await pendingInspectionOf({ stockLotId: ok.stockLotId });
    expect(ip.stage).toBe("ipqc");
    await tx((t) => decideInspection(t, ip.id, { disposition: "accept" }, owner));
    expect((await db.select().from(stockLots).where(eq(stockLots.id, ok.stockLotId)))[0]!.qcStatus).toBe("released");

    const bad = await run("CX-QMS-002");
    const ip2 = await pendingInspectionOf({ stockLotId: bad.stockLotId });
    const r = await tx((t) => decideInspection(t, ip2.id, { disposition: "reject", note: "Mùi khét" }, owner));
    expect((await db.select().from(stockLots).where(eq(stockLots.id, bad.stockLotId)))[0]!.qcStatus).toBe("rejected");
    expect(await qtyIn(bad.stockLotId, "REJ")).toBe(500_000);
    const [ncr] = await db.select().from(ncrs).where(eq(ncrs.id, r.ncr!.id));
    expect(ncr).toMatchObject({ category: "extract", extractionRunId: bad.runId });
  });
});

describe("Chuỗi lô thành phẩm: FQC, truy xuất, mẫu lưu, thu hồi", { timeout: 120_000 }, () => {
  const chain = { tdLot: "", bbLot: "", po: "", lot: "", fqc: "", o1: { orderId: "", itemId: "" }, o2: { orderId: "", itemId: "" }, o3: { orderId: "", itemId: "" }, iqcCode: "", receiptCode: "" };

  beforeAll(async () => {
    const db = await getDb();
    const td = await purchase(ids.td, "EXT", 1_000_000, true, "SL-TD-77");
    chain.tdLot = td.stockLotId;
    chain.receiptCode = td.receiptCode;
    const iqc = await pendingInspectionOf({ stockLotId: td.stockLotId });
    chain.iqcCode = iqc.code;
    await tx((t) => decideInspection(t, iqc.id, { disposition: "accept" }, owner));
    chain.bbLot = (await purchase(ids.bb, "PKG", 300, false)).stockLotId;
    const [po] = await db.insert(productionOrders).values({ code: "LSX-QMS-001", kind: "outsourced", productId: ids.pst, plannedUnits: 300, status: "in_progress" }).returning({ id: productionOrders.id });
    chain.po = po!.id;
    await tx((t) =>
      postIssue(t, { kind: "production", productionOrderId: chain.po, lines: [{ itemId: ids.td, qty: 150_000, stockLotId: chain.tdLot }, { itemId: ids.bb, qty: 300, stockLotId: chain.bbLot }] }, owner.id),
    );
    chain.lot = await newProductLot("PST-261101-07", 296);
    await db.update(productionOrders).set({ lotId: chain.lot }).where(eq(productionOrders.id, chain.po));
    await tx((t) =>
      postReceipt(t, { kind: "production", warehouseId: ids.wh.FG!, receivedOn: today, source: { type: "production_order", id: chain.po }, paymentMode: "none", lines: [{ itemId: ids.pstItem, qty: 296, lineCost: 0, productLotId: chain.lot }] }, owner.id),
    );
    // Tiêu chuẩn thành phẩm gắn sản phẩm, chỉ tiêu vi sinh nối lot_tests
    const s = await tx((t) =>
      createStandard(
        t,
        {
          name: "Tonic thành phẩm",
          appliesTo: "finished",
          productId: ids.pst,
          params: [
            { name: "Ngoại quan", paramGroup: "sensory", kind: "pass_fail" },
            { name: "Vi sinh", paramGroup: "microbial", kind: "pass_fail", lotTestType: "microbial" },
          ],
        },
        owner,
      ),
    );
    await tx((t) => activateStandard(t, s.id, owner));
  });

  it("AC-CL-18: Mở phiếu FQC hai lần → một phiếu chờ", async () => {
    const a = await tx((t) => openFqcForLot(t, chain.lot, collab));
    const b = await tx((t) => openFqcForLot(t, chain.lot, collab));
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, code: a.code, created: false });
    chain.fqc = a.id;
    const db = await getDb();
    expect((await db.select().from(qcInspections).where(eq(qcInspections.id, a.id)))[0]!.productionOrderId).toBe(chain.po);
  });

  it("AC-CL-16: chỉ tiêu nối microbial tự đạt theo lot_tests, không nhập tay; thêm phiếu fail → không đạt", async () => {
    const db = await getDb();
    const insp = (await db.select().from(qcInspections).where(eq(qcInspections.id, chain.fqc)))[0]!;
    await db.insert(lotTests).values({ lotId: chain.lot, type: "microbial", result: "pass" });
    let ev = await evaluateInspection(db, insp);
    const micro = ev.results.find((r) => r.name === "Vi sinh")!;
    expect(micro.livePassed).toBe(true);
    // Nhập tay bị bỏ qua
    await tx((t) => saveInspectionResults(t, chain.fqc, { entries: [{ resultId: micro.id, passFail: "fail" }] }, collab));
    expect((await evaluateInspection(db, insp)).results.find((r) => r.name === "Vi sinh")!.livePassed).toBe(true);
    const [failRow] = await db.insert(lotTests).values({ lotId: chain.lot, type: "microbial", result: "fail" }).returning({ id: lotTests.id });
    ev = await evaluateInspection(db, insp);
    expect(ev.results.find((r) => r.name === "Vi sinh")!.livePassed).toBe(false);
    expect(ev.verdict).toBe("fail");
    await db.delete(lotTests).where(eq(lotTests.id, failRow!.id));
  });

  it("AC-CL-15, AC-CL-14: thiếu kim loại nặng → lỗi, không đổi gì; đủ → released, audit, products.stock 296", async () => {
    const db = await getDb();
    const ngoaiQuan = (await db.select().from(qcInspectionResults).where(eq(qcInspectionResults.inspectionId, chain.fqc))).find((r) => r.name === "Ngoại quan")!;
    await tx((t) => saveInspectionResults(t, chain.fqc, { entries: [{ resultId: ngoaiQuan.id, passFail: "pass" }] }, collab));
    const stockBefore = await stockOf(ids.pst);
    await expect(tx((t) => decideInspection(t, chain.fqc, { disposition: "accept" }, owner))).rejects.toThrow("Thiếu phiếu kiểm nghiệm Kim loại nặng");
    expect((await db.select().from(qcInspections).where(eq(qcInspections.id, chain.fqc)))[0]!.status).toBe("pending");
    expect((await db.select().from(lots).where(eq(lots.id, chain.lot)))[0]!.releaseStatus).toBe("quarantine");
    expect(await stockOf(ids.pst)).toBe(stockBefore);

    await db.insert(lotTests).values({ lotId: chain.lot, type: "heavy_metals", result: "pass" });
    await tx((t) => decideInspection(t, chain.fqc, { disposition: "accept" }, owner));
    const [lot] = await db.select().from(lots).where(eq(lots.id, chain.lot));
    expect(lot).toMatchObject({ releaseStatus: "released", releasedBy: owner.id });
    expect(lot!.releasedAt).not.toBeNull();
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "lot.released"), eq(auditLog.entityId, chain.lot)))).toHaveLength(1);
    expect(await stockOf(ids.pst)).toBe(stockBefore + 296);
    // Lần hai: vừa được người khác cập nhật (AC-TICHHOP-17)
    await expect(tx((t) => decideInspection(t, chain.fqc, { disposition: "accept" }, owner))).rejects.toThrow(INSPECTION_STALE);
  });

  it("AC-CL-20: truy xuất ngược ra LSX, lô tinh dầu 150 ml, lô bao bì, phiếu nhập, NCC, IQC", async () => {
    const db = await getDb();
    expect(await resolveTraceCode(db, "pst-261101-07")).toEqual({ kind: "lot", id: chain.lot });
    const tree = await traceBackward(db, chain.lot);
    const nodes = flatten(tree);
    expect(nodes.find((n) => n.kind === "production_order")!.code).toBe("LSX-QMS-001");
    const tdCode = (await db.select().from(stockLots).where(eq(stockLots.id, chain.tdLot)))[0]!.code;
    const td = nodes.find((n) => n.code === tdCode)!;
    expect(td.qty).toBe("150 ml");
    expect(td.meta).toEqual(expect.arrayContaining(["NCC NCC-Q04 Tinh dầu thử", "Số lô NCC SL-TD-77", `${chain.iqcCode} đạt`]));
    expect(td.meta.some((m) => m.startsWith(`Phiếu nhập ${chain.receiptCode}`))).toBe(true);
    expect(nodes.some((n) => n.title.startsWith("QBB-003") && n.qty === "300 cái")).toBe(true);
  });

  it("AC-CL-21: truy xuất xuôi từ lô tinh dầu ra LSX → lô TP → 2 đơn, đơn hủy không có; viewer thấy số che", async () => {
    const db = await getDb();
    chain.o1 = await insertOrder("QMS-O1", 2, "confirmed", "84901110001");
    chain.o2 = await insertOrder("QMS-O2", 1, "confirmed", "84901110002");
    expect((await tx((t) => issueOrderStock(t, chain.o1.orderId, {}, owner.id))).ok).toBe(true);
    expect((await tx((t) => issueOrderStock(t, chain.o2.orderId, {}, owner.id))).ok).toBe(true);
    chain.o3 = await insertOrder("QMS-O3", 4, "cancelled", "84901110003");
    await db.update(orderItems).set({ lotId: chain.lot }).where(eq(orderItems.id, chain.o3.itemId));

    const { tree, orders: rows } = await traceForward(db, { kind: "stock_lot", id: chain.tdLot }, false);
    const nodes = flatten(tree);
    expect(nodes.find((n) => n.kind === "production_order")!.code).toBe("LSX-QMS-001");
    expect(nodes.find((n) => n.kind === "lot")!.code).toBe("PST-261101-07");
    expect(rows.map((r) => [r.orderCode, r.qty]).sort()).toEqual([
      ["QMS-O1", 2],
      ["QMS-O2", 1],
    ]);
    expect(rows.every((r) => !r.phone.includes("901110"))).toBe(true);
    const full = await traceForward(db, { kind: "stock_lot", id: chain.tdLot }, true);
    expect(full.orders.find((r) => r.orderCode === "QMS-O1")!.phone).toBe("84901110001");
  });

  it("AC-CL-26: mẫu lưu 5 chai có stock_issue_id, FG giảm 5; kiểm lại không đạt không đổi trạng thái lô", async () => {
    const db = await getDb();
    const sl = (await db.select().from(stockLots).where(eq(stockLots.productLotId, chain.lot)))[0]!;
    const before = await qtyIn(sl.id, "FG");
    const r = await tx((t) => createRetainedSample(t, { lotId: chain.lot, units: 5, location: "Tủ mẫu A1", keepUntil: "2030-11-01" }, owner));
    expect(r.status).toBe("posted");
    const [sample] = await db.select().from(retainedSamples).where(eq(retainedSamples.id, r.sampleId));
    expect(sample).toMatchObject({ units: 5, stockIssueId: r.issueId });
    expect(await qtyIn(sl.id, "FG")).toBe(before - 5);

    const rc = await tx((t) => openRecheck(t, { lotId: chain.lot }, collab));
    await tx((t) => addInspectionParam(t, rc.id, { name: "Mùi", paramGroup: "sensory", kind: "pass_fail" }, collab));
    await tx((t) => decideInspection(t, rc.id, { disposition: "reject", note: "Mùi hơi lạ" }, owner));
    expect((await db.select().from(lots).where(eq(lots.id, chain.lot)))[0]!.releaseStatus).toBe("released");
  });

  it("AC-CL-22: cân đối lô khớp sổ", async () => {
    const db = await getDb();
    const b = await lotBalance(db, chain.lot);
    expect(b).toMatchObject({ received: 296, sold: 3, samples: 5, scrap: 0, returned: 0, onHand: 288, balanced: true });
    expect(b.onHandByWarehouse).toEqual({ finished: 288 });
  });

  it("AC-CL-25: thu hồi → recalled, FG sang REJ, stock theo R-KHO-23, liên hệ theo đơn; nhận 2 chai; đóng khi còn pending lỗi", async () => {
    const db = await getDb();
    await expect(tx((t) => openRecall(t, { reason: "Nghi nhiễm", severity: "critical", lotIds: [chain.lot] }, collab))).rejects.toThrow(PERMISSION_DENIED);
    const r = await tx((t) => openRecall(t, { reason: "Nghi nhiễm", severity: "critical", lotIds: [chain.lot] }, owner));
    expect(r.code).toMatch(/^TH-\d{4}-\d{2}$/);
    expect(r.contacts).toBe(2);
    expect(r.movedQty).toBe(288);
    expect((await db.select().from(lots).where(eq(lots.id, chain.lot)))[0]!.releaseStatus).toBe("recalled");
    expect(await stockOf(ids.pst)).toBe(0);
    const contacts = await db.select().from(recallContacts).where(eq(recallContacts.recallId, r.id));
    const c1 = contacts.find((c) => c.orderId === chain.o1.orderId)!;
    const c2 = contacts.find((c) => c.orderId === chain.o2.orderId)!;
    const items1 = await db.select().from(orderItems).where(eq(orderItems.orderId, chain.o1.orderId));
    await tx((t) => receiveRecallReturn(t, c1.id, [{ orderItemId: items1[0]!.id, qty: 2 }], collab));
    const stats = await recallStats(db, r.id);
    expect(stats[0]).toMatchObject({ sold: 3, recovered: 2, onHand: 290, rate: 66.7 });
    await expect(tx((t) => closeRecall(t, r.id, owner))).rejects.toThrow(/Còn 1 liên hệ/);
    await tx((t) => recordRecallContact(t, c2.id, { status: "refused", note: "Khách đã dùng hết" }, collab));
    await tx((t) => closeRecall(t, r.id, owner));
    const sl = (await db.select().from(stockLots).where(eq(stockLots.productLotId, chain.lot)))[0]!;
    expect(await qtyIn(sl.id, "REJ")).toBe(290);
    expect((await lotBalance(db, chain.lot)).balanced).toBe(true);
  });
});

describe("FQC không đạt", { timeout: 60_000 }, () => {
  it("AC-CL-17: lô cách ly 10 chai → rejected, sang REJ, NCR product gắn lô và lệnh; không còn đường released", async () => {
    const db = await getDb();
    const lotId = await newProductLot("PST-261102-01", 10);
    const [po] = await db.insert(productionOrders).values({ code: "LSX-QMS-017", kind: "outsourced", productId: ids.pst, plannedUnits: 10, status: "qc", lotId }).returning({ id: productionOrders.id });
    const rec = await tx((t) =>
      postReceipt(t, { kind: "production", warehouseId: ids.wh.FG!, receivedOn: today, source: { type: "production_order", id: po!.id }, paymentMode: "none", lines: [{ itemId: ids.pstItem, qty: 10, lineCost: 0, productLotId: lotId }] }, owner.id),
    );
    const f = await tx((t) => openFqcForLot(t, lotId, owner));
    const r = await tx((t) => decideInspection(t, f.id, { disposition: "reject", note: "Lắng cặn" }, owner));
    expect(r.movedQty).toBe(10);
    expect((await db.select().from(lots).where(eq(lots.id, lotId)))[0]!.releaseStatus).toBe("rejected");
    expect(await qtyIn(rec.lines[0]!.stockLotId, "REJ")).toBe(10);
    const [ncr] = await db.select().from(ncrs).where(eq(ncrs.id, r.ncr!.id));
    expect(ncr).toMatchObject({ category: "product", lotId, productionOrderId: po!.id });
    await expect(tx((t) => openFqcForLot(t, lotId, owner))).rejects.toThrow("Chỉ mở phiếu FQC cho lô đang cách ly");
  });
});

describe("NCR, CAPA, phản ánh", { timeout: 60_000 }, () => {
  it("AC-CL-23, AC-CL-19: phản ánh nặng → NCR critical; đóng chưa CAPA lỗi; CTV đóng lỗi quyền; đóng chép sang phản ánh", async () => {
    const db = await getDb();
    const lotId = await newProductLot("PST-261103-01", 50);
    const { complaintId } = await submitComplaint({ lotNo: "PST-261103-01", sampleCode: null, contactPhone: "0901234567", startedUsingOn: null, symptoms: "Ngứa đỏ sau 2 ngày", severity: "severe" });
    const n = await tx((t) => createNcrFromComplaint(t, complaintId, collab));
    expect(n.created).toBe(true);
    const [row] = await db.select().from(ncrs).where(eq(ncrs.id, n.id));
    expect(row).toMatchObject({ category: "customer_complaint", severity: "critical", complaintId, lotId });
    expect((await db.select().from(complaints).where(eq(complaints.id, complaintId)))[0]!.status).toBe("investigating");
    expect((await tx((t) => createNcrFromComplaint(t, complaintId, collab))).created).toBe(false);

    await tx((t) => transitionNcr(t, n.id, "investigating", collab));
    await tx((t) => transitionNcr(t, n.id, "action", collab));
    await tx((t) => updateNcr(t, n.id, { rootCause: "Tinh dầu nồng độ cao", correction: "Giảm tỷ lệ tinh dầu", verificationNote: "Đã kiểm lô sau" }, collab));
    await tx((t) => transitionNcr(t, n.id, "verifying", collab));
    await expect(tx((t) => transitionNcr(t, n.id, "closed", owner))).rejects.toThrow("NCR nghiêm trọng cần CAPA trước khi đóng");

    // AC-CL-24: CAPA từ phản ánh có 7 bước gợi ý, gắn NCR của phản ánh
    const capa = await tx((t) => createCapaFromComplaint(t, complaintId, collab));
    const steps = await db.select().from(capaActions).where(eq(capaActions.capaId, capa.id));
    expect(steps).toHaveLength(7);
    expect((await db.select().from(capas).where(eq(capas.id, capa.id)))[0]!.ncrId).toBe(n.id);

    await expect(tx((t) => transitionNcr(t, n.id, "closed", collab))).rejects.toThrow(PERMISSION_DENIED);
    await tx((t) => transitionNcr(t, n.id, "closed", owner));
    const [c] = await db.select().from(complaints).where(eq(complaints.id, complaintId));
    expect(c).toMatchObject({ rootCause: "Tinh dầu nồng độ cao", correctiveAction: "Giảm tỷ lệ tinh dầu" });

    // CAPA: verifying khi mọi bước xong; effective = false → không đóng
    await tx((t) => transitionCapa(t, capa.id, "in_progress", collab));
    await expect(tx((t) => transitionCapa(t, capa.id, "verifying", collab))).rejects.toThrow(/Còn 7 bước/);
    for (const s of steps) await tx((t) => setCapaActionDone(t, s.id, true, "Xong", collab));
    expect((await db.select().from(capas).where(eq(capas.id, capa.id)))[0]!.status).toBe("in_progress");
    await tx((t) => transitionCapa(t, capa.id, "verifying", collab));
    await expect(tx((t) => transitionCapa(t, capa.id, "closed", owner, { effectivenessResult: "Còn phản ánh", effective: false }))).rejects.toThrow(/chưa hiệu quả/);
    expect((await tx((t) => recordCapaEffectiveness(t, capa.id, { result: "Còn 1 phản ánh", effective: false }, collab))).status).toBe("in_progress");
    await tx((t) => addCapaAction(t, capa.id, { description: "Đổi nhà cung cấp tinh dầu" }, collab));
    const extra = (await db.select().from(capaActions).where(eq(capaActions.capaId, capa.id))).find((a) => !a.doneAt)!;
    await tx((t) => setCapaActionDone(t, extra.id, true, null, collab));
    await tx((t) => transitionCapa(t, capa.id, "verifying", collab));
    await expect(tx((t) => transitionCapa(t, capa.id, "closed", collab, { effectivenessResult: "Không tái diễn 30 ngày", effective: true }))).rejects.toThrow(PERMISSION_DENIED);
    await tx((t) => transitionCapa(t, capa.id, "closed", owner, { effectivenessResult: "Không tái diễn 30 ngày", effective: true }));
    expect((await db.select().from(capas).where(eq(capas.id, capa.id)))[0]!.status).toBe("closed");
  });

  it("AC-CL-27: bước CAPA hạn hôm qua và NCR quá hạn → cảnh báo warn", async () => {
    const db = await getDb();
    const yesterday = addDays(today, -1);
    await tx((t) => createNcr(t, { title: "Nhãn lệch", category: "packaging", severity: "minor", description: "Lệch 2 mm", dueOn: yesterday }, collab));
    await tx((t) => createCapa(t, { type: "preventive", title: "Kiểm nhãn", problem: "Nhãn lệch", steps: [{ description: "Làm dưỡng dán nhãn", dueOn: yesterday }] }, collab));
    const alerts = await computeQmsAlerts(db, today);
    expect(alerts).toContainEqual(expect.objectContaining({ level: "warn", text: expect.stringMatching(/NCR quá hạn/) }));
    expect(alerts).toContainEqual(expect.objectContaining({ level: "warn", text: expect.stringMatching(/bước CAPA quá hạn/) }));
  });

  it("AC-CL-29: vai trò Chỉ xem gọi các việc ghi → lỗi quyền, không ghi gì", async () => {
    const db = await getDb();
    const before = (await db.select().from(ncrs)).length;
    const lot = await purchase(ids.bb, "PKG", 7);
    const insp = await pendingInspectionOf({ stockLotId: lot.stockLotId });
    await expect(tx((t) => saveInspectionResults(t, insp.id, { entries: [] }, viewer))).rejects.toThrow(PERMISSION_DENIED);
    await expect(tx((t) => decideInspection(t, insp.id, { disposition: "accept" }, viewer))).rejects.toThrow(PERMISSION_DENIED);
    await expect(tx((t) => createNcr(t, { title: "x", category: "other", severity: "minor", description: "x" }, viewer))).rejects.toThrow(PERMISSION_DENIED);
    await expect(tx((t) => createCapa(t, { type: "corrective", title: "x", problem: "x" }, viewer))).rejects.toThrow(PERMISSION_DENIED);
    await expect(tx((t) => setStockLotHold(t, lot.stockLotId, true, "x", viewer))).rejects.toThrow(PERMISSION_DENIED);
    await expect(tx((t) => openRecall(t, { reason: "x", severity: "minor", lotIds: [] }, viewer))).rejects.toThrow(PERMISSION_DENIED);
    expect((await db.select().from(ncrs)).length).toBe(before);
    expect((await db.select().from(qcInspections).where(eq(qcInspections.id, insp.id)))[0]!.status).toBe("pending");
  });
});
