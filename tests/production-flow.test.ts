import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-production-flow-"));
process.env.PGLITE_DIR = dir;

import { and, eq } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import {
  formulaLines,
  inventoryItems,
  lots,
  payables,
  productionOrderMaterials,
  productionOrders,
  productionOrderSteps,
  productionPlans,
  products,
  qcInspections,
  staffUsers,
  stockLots,
  stockMovements,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { getItemStock, postReceipt } from "@/modules/inventory/ledger";
import { vnToday } from "@/modules/numbering/rules";
import type { Actor } from "@/modules/production/access";
import { completeRun, createRun, getRunDetail, issuePeel } from "@/modules/production/extraction";
import { changeVersionStatus, compareVersions, createFormula, createNextVersion, listFormulas, upsertFormulaLine, upsertPackaging, ONLY_DRAFT } from "@/modules/production/formulas";
import {
  addMaterialLine,
  approveOrder,
  cancelOrder,
  COST_LOCKED,
  completeOrder,
  createOrder,
  finishStep,
  getOrderDetail,
  issueMaterial,
  netIssuedByItem,
  planOrder,
  recordOutput,
  requestStepIpqc,
  returnMaterial,
  setCostLock,
  setMaterialSource,
  skipStep,
  startOrder,
  startStep,
  updateOrderCosts,
} from "@/modules/production/orders";
import { addPlanLine, createPlan, getPlanDetail } from "@/modules/production/plans";
import { DEVIATION_BLOCK } from "@/modules/production/rules";

// T-15: luồng chính phân hệ Sản xuất trên PGlite (02-san-xuat.md AC-SX-*)

const today = vnToday();
const MFG = "2027-11-20";
const owner: Actor = { id: "", role: "owner" };
const collab: Actor = { id: "", role: "collaborator" };
const viewer: Actor = { id: "", role: "viewer" };
const PERM = "không có quyền";

const ids = {
  pst: "",
  psh: "",
  factory: "",
  still: "",
  water: "",
  td2: "",
  nl2: "",
  nl3: "",
  nl4: "",
  td1: "",
  peel: "",
  bb: [] as string[],
  wh: {} as Record<string, string>,
  td1LotA: "",
  v1: "",
  v2: "",
  order1: "",
};

async function tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

async function item(code: string, kind: "raw_material" | "extract" | "packaging", baseUom: "mg" | "ul" | "pcs", extra: Partial<typeof inventoryItems.$inferInsert> = {}) {
  const db = await getDb();
  const [row] = await db
    .insert(inventoryItems)
    .values({ code, name: code, kind, baseUom, displayUom: baseUom === "ul" ? "ml" : baseUom === "mg" ? "g" : "cái", purchaseUom: baseUom === "ul" ? "l" : baseUom === "mg" ? "kg" : "cái", ...extra })
    .returning({ id: inventoryItems.id });
  return row!.id;
}

async function receive(itemId: string, wh: string, qty: number, lineCost: number, expiresOn: string | null = null) {
  const r = await tx((t) =>
    postReceipt(t, { kind: "other", warehouseId: ids.wh[wh]!, receivedOn: today, paymentMode: "none", lines: [{ itemId, qty, lineCost, qcRequired: false, expiresOn }] }, owner.id),
  );
  return r.lines[0]!.stockLotId;
}

async function setIpqc(stepId: string, status: "passed" | "failed") {
  const db = await getDb();
  const [insp] = await db
    .select({ id: qcInspections.id })
    .from(qcInspections)
    .where(and(eq(qcInspections.productionStepId, stepId), eq(qcInspections.status, "pending")))
    .limit(1);
  expect(insp).toBeTruthy();
  await db.update(qcInspections).set({ status, decidedAt: new Date() }).where(eq(qcInspections.id, insp!.id));
}

async function stepsOf(orderId: string) {
  const db = await getDb();
  return db.select().from(productionOrderSteps).where(eq(productionOrderSteps.productionOrderId, orderId)).orderBy(productionOrderSteps.seq);
}

// Đi hết công đoạn: công đoạn cần QC thì bắt đầu, IPQC đạt, xong; còn lại bỏ qua
async function passSteps(orderId: string) {
  for (const s of await stepsOf(orderId)) {
    if (s.status !== "pending") continue;
    if (s.needsQc) {
      await tx((t) => startStep(t, owner, s.id));
      await setIpqc(s.id, "passed");
      await tx((t) => finishStep(t, owner, s.id));
    } else await tx((t) => skipStep(t, owner, s.id, "Thử"));
  }
}

async function outsourcedOrder(price: number | null) {
  return tx((t) =>
    createOrder(t, owner, { kind: "outsourced", productId: ids.pst, formulaVersionId: null, formulaLabel: "Công thức nhà máy", supplierId: ids.factory, outsourcingUnitPrice: price, plannedUnits: 300 }),
  );
}

beforeAll(async () => {
  const db = await getDb();
  const mk = async (email: string, role: "owner" | "collaborator" | "viewer") =>
    (await db.insert(staffUsers).values({ email, role, passwordHash: "x" }).returning({ id: staffUsers.id }))[0]!.id;
  owner.id = await mk("owner@sx.vn", "owner");
  collab.id = await mk("ctv@sx.vn", "collaborator");
  viewer.id = await mk("xem@sx.vn", "viewer");
  for (const w of await db.select().from(warehouses)) ids.wh[w.code] = w.id;
  const [pst] = await db.update(products).set({ netQty: 100_000, netUom: "ul" }).where(eq(products.code, "PST")).returning({ id: products.id });
  const [psh] = await db.update(products).set({ netQty: null, netUom: null }).where(eq(products.code, "PSH")).returning({ id: products.id });
  ids.pst = pst!.id;
  ids.psh = psh!.id;
  // Hạn dùng mặc định thành phẩm 730 ngày (AC-SX-20)
  await db.update(inventoryItems).set({ shelfLifeDays: 730 }).where(eq(inventoryItems.productId, ids.pst));
  ids.factory = (await db.insert(suppliers).values({ code: "NCC-SX1", name: "Nhà máy thử", kind: "factory", paymentTermsDays: 30 }).returning({ id: suppliers.id }))[0]!.id;
  ids.still = (await db.insert(suppliers).values({ code: "NCC-SX2", name: "Lò chưng thử", kind: "service", paymentTermsDays: 0 }).returning({ id: suppliers.id }))[0]!.id;

  ids.water = await item("SX-NL-001", "raw_material", "ul");
  ids.td2 = await item("SX-TD-002", "extract", "ul");
  ids.nl2 = await item("SX-NL-002", "raw_material", "ul");
  ids.nl3 = await item("SX-NL-003", "raw_material", "ul");
  ids.nl4 = await item("SX-NL-004", "raw_material", "ul");
  ids.td1 = await item("SX-TD-001", "extract", "ul", { densityMgPerMl: 850, refUnitPrice: 2_000_000 });
  ids.peel = await item("SX-VO-001", "raw_material", "mg");
  for (const [i, price] of [6_000, 4_000, 3_000, 2_000].entries()) ids.bb.push(await item(`SX-BB-00${i + 1}`, "packaging", "pcs", { refUnitPrice: price }));
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("công thức (R-SX-4…R-SX-11)", () => {
  it("AC-SX-4, AC-SX-5: nhãn PST-v1, dòng cân bằng lưu 700.000 ppm khi rời nháp", async () => {
    const f = await tx((t) =>
      createFormula(t, owner, { name: "Tinh chất PST", productId: ids.pst, batchSize: 100_000_000, batchUom: "ul", bulkDensityMgPerMl: null, expectedYieldBp: 9_800, processNote: "" }),
    );
    expect(f.label).toBe("PST-v1");
    ids.v1 = f.versionId;
    await tx(async (t) => {
      await upsertFormulaLine(t, owner, f.versionId, { itemId: ids.water, ppm: 0, isBalance: true });
      await upsertFormulaLine(t, owner, f.versionId, { itemId: ids.td2, ppm: 150_000, isBalance: false });
      await upsertFormulaLine(t, owner, f.versionId, { itemId: ids.nl2, ppm: 100_000, isBalance: false });
      await upsertFormulaLine(t, owner, f.versionId, { itemId: ids.nl3, ppm: 50_000, isBalance: false });
      for (const bb of ids.bb) await upsertPackaging(t, owner, f.versionId, { itemId: bb, qtyPerUnit: 1 });
    });
    await expect(tx((t) => upsertFormulaLine(t, owner, f.versionId, { itemId: ids.bb[0]!, ppm: 1000, isBalance: false }))).rejects.toThrow("Bao bì khai ở định mức bao bì");
    await tx((t) => changeVersionStatus(t, owner, f.versionId, "approved"));
    const db = await getDb();
    const [bal] = await db.select().from(formulaLines).where(and(eq(formulaLines.formulaVersionId, f.versionId), eq(formulaLines.isBalance, true)));
    expect(bal!.ppm).toBe(700_000);

    // Công thức không gắn sản phẩm; tổng 99% không cân bằng → lỗi
    const g = await tx((t) => createFormula(t, owner, { name: "Nền thử", productId: null, batchSize: 1_000_000, batchUom: "ul", bulkDensityMgPerMl: null, expectedYieldBp: 10_000, processNote: "" }));
    expect(g.label).toMatch(/^FORM-\d+-v1$/);
    await tx(async (t) => {
      await upsertFormulaLine(t, owner, g.versionId, { itemId: ids.water, ppm: 700_000, isBalance: false });
      await upsertFormulaLine(t, owner, g.versionId, { itemId: ids.td2, ppm: 150_000, isBalance: false });
      await upsertFormulaLine(t, owner, g.versionId, { itemId: ids.nl2, ppm: 100_000, isBalance: false });
      await upsertFormulaLine(t, owner, g.versionId, { itemId: ids.nl3, ppm: 40_000, isBalance: false });
    });
    await expect(tx((t) => changeVersionStatus(t, owner, g.versionId, "trial"))).rejects.toThrow("Tổng tỷ lệ 99%, cần đúng 100%");
  });

  it("AC-SX-10: cộng tác viên không đọc được công thức", async () => {
    const db = await getDb();
    await expect(listFormulas(db, collab)).rejects.toThrow(PERM);
    expect((await listFormulas(db, owner)).length).toBe(2);
  });
});

describe("kế hoạch (R-SX-12, R-SX-13)", () => {
  it("AC-SX-11, AC-SX-12: nhu cầu NVL, số mẻ, thiếu TD-002 591.837 ul", async () => {
    const db = await getDb();
    await receive(ids.td2, "EXT", 10_000_000, 0);
    // Lệnh khác đã duyệt cam kết 6 l TD-002
    const [other] = await db.insert(productionOrders).values({ code: "LSX-TEST-01", kind: "in_house", productId: ids.pst, plannedUnits: 1, status: "approved" }).returning({ id: productionOrders.id });
    await db.insert(productionOrderMaterials).values({ productionOrderId: other!.id, itemId: ids.td2, role: "formula", plannedQty: 6_000_000, suppliedBy: "pomil" });

    const plan = await tx((t) => createPlan(t, owner, { period: "week", periodStart: "2027-11-15", periodEnd: "2027-11-21" }));
    await tx((t) => addPlanLine(t, owner, plan.id, { productId: ids.pst, formulaVersionId: null, targetUnits: 300 }));
    const d = (await getPlanDetail(db, plan.id))!;
    expect(d.lines[0]).toMatchObject({ bulk: 30_612_245, batches: 1, error: null });
    const need = Object.fromEntries(d.need.map((n) => [n.itemCode, n]));
    expect(need["SX-TD-002"]).toMatchObject({ need: 4_591_837, available: 10_000_000, committed: 6_000_000, shortage: 591_837 });
    expect(need["SX-NL-002"]!.need).toBe(3_061_225);
    expect(need["SX-NL-003"]!.need).toBe(1_530_612);
    expect(need["SX-NL-001"]!.need).toBe(21_428_571);
    expect(need["SX-BB-001"]!.need).toBe(300);

    const plan2 = await tx((t) => createPlan(t, owner, { period: "month", periodStart: "2027-11-01", periodEnd: "2027-11-30" }));
    await tx((t) => addPlanLine(t, owner, plan2.id, { productId: ids.pst, formulaVersionId: null, targetUnits: 1_000 }));
    expect((await getPlanDetail(db, plan2.id))!.lines[0]!.batches).toBe(2);

    // Bỏ lệnh giả để không ảnh hưởng phần sau
    await db.update(productionOrders).set({ status: "cancelled" }).where(eq(productionOrders.id, other!.id));
  });

  it("AC-SX-13: sản phẩm chưa có dung tích", async () => {
    const plan = await tx((t) => createPlan(t, owner, { period: "day", periodStart: "2027-11-15", periodEnd: "2027-11-15" }));
    await expect(tx((t) => addPlanLine(t, owner, plan.id, { productId: ids.psh, formulaVersionId: null, targetUnits: 100 }))).rejects.toThrow("Nhập dung tích sản phẩm trước khi lập kế hoạch");
  });
});

describe("phiên bản mới (R-SX-4, R-SX-11)", () => {
  it("AC-SX-8, AC-SX-9: so sánh v1/v2, duyệt v2 thì v1 archived, sửa v2 bị chặn", async () => {
    const v2 = await tx((t) => createNextVersion(t, owner, ids.v1, "Giảm mùi"));
    expect(v2.label).toBe("PST-v2");
    ids.v2 = v2.versionId;
    await tx(async (t) => {
      await upsertFormulaLine(t, owner, v2.versionId, { itemId: ids.td2, ppm: 120_000, isBalance: false });
      await upsertFormulaLine(t, owner, v2.versionId, { itemId: ids.nl4, ppm: 30_000, isBalance: false });
    });
    const db = await getDb();
    const cmp = await compareVersions(db, owner, ids.v1, v2.versionId);
    expect(cmp.changeNote).toBe("Giảm mùi");
    expect(cmp.changes).toContain("SX-TD-002: 15% → 12%");
    expect(cmp.changes).toContain("Thêm SX-NL-004: 3%");

    await tx((t) => changeVersionStatus(t, owner, v2.versionId, "approved"));
    const list = await listFormulas(db, owner);
    const pst = list.find((f) => f.productCode === "PST")!;
    expect(pst.versions.map((v) => [v.label, v.status])).toEqual([
      ["PST-v1", "archived"],
      ["PST-v2", "approved"],
    ]);
    await expect(tx((t) => upsertFormulaLine(t, owner, v2.versionId, { itemId: ids.nl4, ppm: 20_000, isBalance: false }))).rejects.toThrow(ONLY_DRAFT);
  });
});

describe("lệnh gia công (R-SX-15…R-SX-21, R-SX-26, R-SX-29)", () => {
  it("AC-SX-15, AC-SX-16: thiếu nhà máy bị chặn; cộng tác viên không duyệt được; chủ duyệt, giá thành kế hoạch 16.800.000đ", async () => {
    const bad = await tx((t) => createOrder(t, owner, { kind: "outsourced", productId: ids.pst, formulaVersionId: null, formulaLabel: "X", supplierId: null, outsourcingUnitPrice: 40_000, plannedUnits: 300 }));
    await expect(tx((t) => planOrder(t, owner, bad.id))).rejects.toThrow("Lệnh gia công cần chọn nhà máy");

    const o = await outsourcedOrder(40_000);
    ids.order1 = o.id;
    await tx(async (t) => {
      await addMaterialLine(t, owner, o.id, { itemId: ids.td1, plannedQty: 150_000 });
      for (const bb of ids.bb) await addMaterialLine(t, owner, o.id, { itemId: bb, plannedQty: 300 });
      await addMaterialLine(t, owner, o.id, { itemId: ids.nl2, plannedQty: 1_000 });
    });
    const db = await getDb();
    const mats = await db.select().from(productionOrderMaterials).where(eq(productionOrderMaterials.productionOrderId, o.id));
    expect(mats.every((m) => m.suppliedBy === "factory")).toBe(true);
    await tx(async (t) => {
      for (const m of mats) if (m.itemId !== ids.nl2) await setMaterialSource(t, owner, m.id, "pomil");
    });
    await tx((t) => planOrder(t, collab, o.id));
    await expect(tx((t) => approveOrder(t, collab, o.id))).rejects.toThrow(PERM);
    const r = await tx((t) => approveOrder(t, owner, o.id));
    expect(r.plannedCost).toBe(16_800_000);
    expect(r.missingPrice).toEqual([]);
    const [row] = await db.select().from(productionOrders).where(eq(productionOrders.id, o.id));
    expect(row).toMatchObject({ status: "approved", plannedCost: 16_800_000 });
  });

  it("AC-SX-17: xuất FEFO, lệnh in_progress, đã cam kết về 0", async () => {
    const db = await getDb();
    ids.td1LotA = await receive(ids.td1, "EXT", 1_000_000, 2_000_000, "2028-06-30");
    await receive(ids.td1, "EXT", 1_000_000, 3_000_000, "2029-06-30");
    for (const [i, bb] of ids.bb.entries()) await receive(bb, "PKG", 300, [1_800_000, 1_200_000, 900_000, 600_000][i]!);
    expect((await getItemStock(db, [ids.td1])).get(ids.td1)!.committed).toBe(150_000);

    await tx((t) => issueMaterial(t, collab, ids.order1, { itemId: ids.td1, qty: 150_000 }));
    for (const bb of ids.bb) await tx((t) => issueMaterial(t, collab, ids.order1, { itemId: bb, qty: 300 }));
    const [o] = await db.select().from(productionOrders).where(eq(productionOrders.id, ids.order1));
    expect(o!.status).toBe("in_progress");
    expect(o!.startedAt).not.toBeNull();
    const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.productionOrderId, ids.order1), eq(stockMovements.type, "production_issue")));
    expect(moves).toHaveLength(5);
    expect(moves.find((m) => m.itemId === ids.td1)!.stockLotId).toBe(ids.td1LotA);
    const stock = await getItemStock(db, [ids.td1, ...ids.bb]);
    for (const id of [ids.td1, ...ids.bb]) expect(stock.get(id)!.committed).toBe(0);
  });

  it("AC-SX-18: xuất vượt cần lý do; dòng nhà máy cấp bị chặn", async () => {
    await expect(tx((t) => issueMaterial(t, owner, ids.order1, { itemId: ids.td1, qty: 10_000 }))).rejects.toThrow("ghi lý do");
    await tx((t) => issueMaterial(t, owner, ids.order1, { itemId: ids.td1, qty: 10_000, reason: "Hao hụt khi rót" }));
    await expect(tx((t) => issueMaterial(t, owner, ids.order1, { itemId: ids.nl2, qty: 100 }))).rejects.toThrow("Nhà máy tự cấp hàng này");
  });

  it("AC-SX-19: trả NVL về đúng lô, xuất ròng 150 ml; trả vượt bị chặn", async () => {
    const db = await getDb();
    await expect(tx((t) => returnMaterial(t, owner, ids.order1, { stockLotId: ids.td1LotA, qty: 200_000 }))).rejects.toThrow("Trả vượt số đã xuất");
    const before = (await db.select().from(productionOrders).where(eq(productionOrders.id, ids.order1)))[0]!.materialCost;
    expect(before).toBe(320_000);
    const r = await tx((t) => returnMaterial(t, owner, ids.order1, { stockLotId: ids.td1LotA, qty: 10_000 }));
    const [rec] = await db.select().from(stockReceipts).where(eq(stockReceipts.code, r.receiptCode));
    expect(rec).toMatchObject({ kind: "production_return", sourceType: "production_order", sourceId: ids.order1 });
    expect((await netIssuedByItem(db, ids.order1)).get(ids.td1)).toBe(150_000);
    expect((await db.select().from(productionOrders).where(eq(productionOrders.id, ids.order1)))[0]!.materialCost).toBe(300_000);
  });

  it("AC-SX-20: ghi sản lượng tạo lô cách ly, FG +296, FQC chờ, phải trả 12.000.000đ, giá thành 16.800.000đ", async () => {
    await passSteps(ids.order1);
    const r = await tx((t) => recordOutput(t, owner, ids.order1, { goodUnits: 296, rejectedUnits: 4, manufacturedOn: MFG }, MFG));
    expect(r.lotNo).toBe("PST-271120-01");
    expect(r.totalCost).toBe(16_800_000);
    const db = await getDb();
    const [lot] = await db.select().from(lots).where(eq(lots.id, r.lotId));
    expect(lot).toMatchObject({ releaseStatus: "quarantine", unitsProduced: 296, formulaVersion: "Công thức nhà máy", manufacturedOn: MFG, expiresOn: "2029-11-19" });
    const [sl] = await db.select().from(stockLots).where(eq(stockLots.productLotId, r.lotId));
    expect(sl).toMatchObject({ receivedQty: 296, receivedCost: 16_800_000 });
    const fg = (await getItemStock(db, [sl!.itemId])).get(sl!.itemId)!;
    expect(fg.quarantine).toBe(296);
    const [fqc] = await db.select().from(qcInspections).where(and(eq(qcInspections.lotId, r.lotId), eq(qcInspections.stage, "fqc")));
    expect(fqc!.status).toBe("pending");
    const [pay] = await db.select().from(payables).where(eq(payables.sourceId, ids.order1));
    expect(pay).toMatchObject({ amount: 12_000_000, supplierId: ids.factory, dueOn: "2027-12-20" });
    const [o] = await db.select().from(productionOrders).where(eq(productionOrders.id, ids.order1));
    expect(o).toMatchObject({ status: "qc", totalCost: 16_800_000, goodUnits: 296, rejectedUnits: 4 });
  });

  it("AC-SX-21, AC-SX-22, AC-SX-23: số lô kế tiếp, trùng số lô, thiếu đơn giá, hoàn thành theo FQC", async () => {
    const db = await getDb();
    const o2 = await outsourcedOrder(40_000);
    await tx((t) => planOrder(t, owner, o2.id));
    await tx((t) => approveOrder(t, owner, o2.id));
    await tx((t) => startOrder(t, owner, o2.id));
    await passSteps(o2.id);
    await expect(tx((t) => recordOutput(t, owner, o2.id, { goodUnits: 100, rejectedUnits: 0, manufacturedOn: MFG, lotNo: "PST-271120-01" }, MFG))).rejects.toThrow("đã có");
    const r2 = await tx((t) => recordOutput(t, owner, o2.id, { goodUnits: 100, rejectedUnits: 0, manufacturedOn: MFG }, MFG));
    expect(r2.lotNo).toBe("PST-271120-02");

    const o3 = await outsourcedOrder(null);
    await tx((t) => planOrder(t, owner, o3.id));
    await tx((t) => approveOrder(t, owner, o3.id));
    await tx((t) => startOrder(t, owner, o3.id));
    await passSteps(o3.id);
    await expect(tx((t) => recordOutput(t, owner, o3.id, { goodUnits: 100, rejectedUnits: 0, manufacturedOn: MFG }, MFG))).rejects.toThrow("Nhập đơn giá gia công trước");

    // Lô còn cách ly → chưa hoàn thành được
    await expect(tx((t) => completeOrder(t, owner, ids.order1))).rejects.toThrow("Lô chưa có kết luận FQC");
    const [o1] = await db.select().from(productionOrders).where(eq(productionOrders.id, ids.order1));
    await db.update(lots).set({ releaseStatus: "released", releasedAt: new Date() }).where(eq(lots.id, o1!.lotId!));
    expect((await tx((t) => completeOrder(t, owner, ids.order1))).qcResult).toBe("pass");
    await db.update(lots).set({ releaseStatus: "rejected" }).where(eq(lots.id, r2.lotId));
    expect((await tx((t) => completeOrder(t, owner, o2.id))).qcResult).toBe("fail");
  });

  it("AC-SX-31, AC-SX-29: sửa chi phí gia công điều chỉnh công nợ; chốt giá vốn thì không sửa được", async () => {
    const db = await getDb();
    await db.update(payables).set({ paidAmount: 5_000_000, status: "partial" }).where(eq(payables.sourceId, ids.order1));
    const r = await tx((t) => updateOrderCosts(t, owner, ids.order1, { laborCost: 0, overheadCost: 0, otherCost: 0, outsourcingCost: 11_800_000, reason: "Nhà máy giảm giá" }));
    expect(r.total).toBe(16_600_000);
    const [pay] = await db.select().from(payables).where(eq(payables.sourceId, ids.order1));
    expect(pay!.amount - pay!.paidAmount).toBe(6_800_000);
    await expect(tx((t) => updateOrderCosts(t, owner, ids.order1, { laborCost: 0, overheadCost: 0, otherCost: 0, outsourcingCost: 4_000_000 }))).rejects.toThrow(/thấp hơn số đã trả/i);

    await expect(tx((t) => setCostLock(t, collab, ids.order1, true, null))).rejects.toThrow(PERM);
    await tx((t) => setCostLock(t, owner, ids.order1, true, null));
    await expect(tx((t) => updateOrderCosts(t, owner, ids.order1, { laborCost: 100_000, overheadCost: 0, otherCost: 0 }))).rejects.toThrow(COST_LOCKED);
    await expect(tx((t) => setCostLock(t, owner, ids.order1, false, ""))).rejects.toThrow("Ghi lý do mở chốt giá vốn");
    await tx((t) => setCostLock(t, owner, ids.order1, false, "Sửa sai chi phí"));
  });

  it("AC-SX-25: cộng tác viên không hủy lệnh đang làm; chủ hủy, NVL để lại thành hao hụt", async () => {
    const o = await outsourcedOrder(40_000);
    await tx((t) => addMaterialLine(t, owner, o.id, { itemId: ids.td1, plannedQty: 150_000 }));
    const db = await getDb();
    const [m] = await db.select().from(productionOrderMaterials).where(eq(productionOrderMaterials.productionOrderId, o.id));
    await tx((t) => setMaterialSource(t, owner, m!.id, "pomil"));
    await tx((t) => planOrder(t, owner, o.id));
    await tx((t) => approveOrder(t, owner, o.id));
    await tx((t) => issueMaterial(t, owner, o.id, { itemId: ids.td1, qty: 150_000 }));
    await expect(tx((t) => cancelOrder(t, collab, o.id, "Đổi kế hoạch"))).rejects.toThrow(PERM);
    const r = await tx((t) => cancelOrder(t, owner, o.id, "Đổi kế hoạch"));
    // Lô A còn 0 sau lệnh 1? Lệnh 1 dùng 150 ml lô A (2.000.000đ/l) → còn 850 ml; lệnh này lấy tiếp lô A
    expect(r.leftoverValue).toBe(300_000);
    const [row] = await db.select().from(productionOrders).where(eq(productionOrders.id, o.id));
    expect(row).toMatchObject({ status: "cancelled", cancelReason: "Đổi kế hoạch" });
  });
});

describe("lệnh tự làm và IPQC (R-SX-17, R-SX-22)", () => {
  it("AC-SX-24, AC-SX-10: IPQC không đạt chặn công đoạn sau và ghi sản lượng; lần hai đạt thì làm tiếp; trang lệnh không có %", async () => {
    const o = await tx((t) => createOrder(t, owner, { kind: "in_house", productId: ids.pst, formulaVersionId: ids.v2, formulaLabel: null, supplierId: null, outsourcingUnitPrice: null, plannedUnits: 300 }));
    await tx((t) => planOrder(t, owner, o.id));
    await tx((t) => approveOrder(t, owner, o.id));
    const db = await getDb();
    const detail = (await getOrderDetail(db, o.id))!;
    expect(detail.version!.label).toBe("PST-v2");
    expect(detail.materials.length).toBeGreaterThan(0);
    expect(detail.materials.some((m) => "ppm" in m)).toBe(false);

    const [s1, s2, s3] = await stepsOf(o.id);
    await tx((t) => startStep(t, owner, s1!.id));
    await tx((t) => finishStep(t, owner, s1!.id));
    await tx((t) => startStep(t, owner, s2!.id));
    await setIpqc(s2!.id, "failed");
    await expect(tx((t) => finishStep(t, owner, s2!.id))).rejects.toThrow("IPQC đạt");
    await expect(tx((t) => startStep(t, owner, s3!.id))).rejects.toThrow(DEVIATION_BLOCK);
    await expect(tx((t) => recordOutput(t, owner, o.id, { goodUnits: 300, rejectedUnits: 0, manufacturedOn: MFG }, MFG))).rejects.toThrow(DEVIATION_BLOCK);
    expect((await getOrderDetail(db, o.id))!.blocked).toBe(true);

    await tx((t) => requestStepIpqc(t, owner, s2!.id));
    await setIpqc(s2!.id, "passed");
    await tx((t) => finishStep(t, owner, s2!.id));
    await tx((t) => startStep(t, owner, s3!.id));
    expect((await getOrderDetail(db, o.id))!.blocked).toBe(false);
  });
});

describe("mẻ chiết (R-SX-23…R-SX-25)", () => {
  it("AC-SX-26: lô EX chờ IPQC ở kho EXT, phải trả 1.500.000đ, giá thành 2.500.000đ, thu hồi 0,68%", async () => {
    await receive(ids.peel, "RAW", 50_000_000, 1_000_000);
    const run = await tx((t) =>
      createRun(t, owner, {
        kind: "outsourced",
        pomeloVariety: "Da xanh",
        sourceSupplierId: null,
        harvestOn: null,
        peelCondition: "Tươi",
        method: "steam_distillation",
        equipment: "Nồi 50 l",
        operatorName: "Lò thuê",
        serviceSupplierId: ids.still,
        serviceFee: 1_500_000,
        otherCost: 0,
        params: [{ name: "Thời gian", valueMilli: 4_000, unit: "giờ" }],
        outputItemId: ids.td1,
      }),
    );
    await tx((t) => issuePeel(t, owner, run.id, { itemId: ids.peel, qty: 50_000_000 }));
    const r = await tx((t) => completeRun(t, owner, run.id, { outputQty: 400_000 }, "2027-11-20"));
    expect(r.lotCode).toMatch(/^EX-/);
    expect(r.totalCost).toBe(2_500_000);
    const db = await getDb();
    const [lot] = await db.select().from(stockLots).where(eq(stockLots.id, r.stockLotId));
    expect(lot).toMatchObject({ qcStatus: "pending", receivedCost: 2_500_000, receivedQty: 400_000 });
    const d = (await getRunDetail(db, run.id))!;
    expect(d.run).toMatchObject({ status: "completed", totalCost: 2_500_000 });
    expect(d.ipqc.map((i) => i.status)).toEqual(["pending"]);
    expect(d.payable).toMatchObject({ amount: 1_500_000 });
    expect(d.recovery).toEqual({ kind: "percent", bp: 68 });
    const [mv] = await db.select({ wh: stockMovements.warehouseId }).from(stockMovements).where(eq(stockMovements.stockLotId, r.stockLotId));
    expect(mv!.wh).toBe(ids.wh.EXT);
  });
});

describe("quyền Chỉ xem (R-CHUNG)", () => {
  it("AC-SX-32: chỉ xem không tạo kế hoạch, lệnh, xuất NVL, ghi sản lượng, mẻ chiết", async () => {
    const db = await getDb();
    const plansBefore = (await db.select().from(productionPlans)).length;
    await expect(tx((t) => createPlan(t, viewer, { period: "day", periodStart: "2027-11-15", periodEnd: "2027-11-15" }))).rejects.toThrow(PERM);
    await expect(
      tx((t) => createOrder(t, viewer, { kind: "outsourced", productId: ids.pst, formulaVersionId: null, formulaLabel: "X", supplierId: ids.factory, outsourcingUnitPrice: 1, plannedUnits: 1 })),
    ).rejects.toThrow(PERM);
    await expect(tx((t) => issueMaterial(t, viewer, ids.order1, { itemId: ids.td1, qty: 1 }))).rejects.toThrow(PERM);
    await expect(tx((t) => recordOutput(t, viewer, ids.order1, { goodUnits: 1, rejectedUnits: 0 }))).rejects.toThrow(PERM);
    await expect(
      tx((t) =>
        createRun(t, viewer, { kind: "in_house", pomeloVariety: "", sourceSupplierId: null, harvestOn: null, peelCondition: "", method: "other", equipment: "", operatorName: "", serviceSupplierId: null, serviceFee: 0, otherCost: 0, params: [], outputItemId: ids.td1 }),
      ),
    ).rejects.toThrow(PERM);
    expect((await db.select().from(productionPlans)).length).toBe(plansBefore);
  });
});
