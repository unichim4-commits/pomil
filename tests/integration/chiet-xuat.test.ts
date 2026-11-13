// T-19 (QA): Sản xuất (mẻ chiết) × Chất lượng (IPQC) × Kho (lô EX) × Sản xuất (lệnh) — AC-SX-27;
// và IQC "Chấp nhận có điều kiện" giữ lý do trên lô (R-CL-8).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-qa-chiet-"));
process.env.PGLITE_DIR = dir;

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { inventoryItems, productionOrderMaterials, products, qcInspections, stockLots, stockMovements, suppliers, warehouses } from "@/db/schema";
import { getItemStock, postReceipt } from "@/modules/inventory/ledger";
import { vnToday } from "@/modules/numbering/rules";
import { completeRun, createRun, issuePeel } from "@/modules/production/extraction";
import { addMaterialLine, approveOrder, createOrder, issueMaterial, planOrder, setMaterialSource } from "@/modules/production/orders";
import { decideInspection } from "@/modules/qms/decisions";
import { checkInvariants, makeStaff, tx, type TestActor } from "./_helpers";

const today = vnToday();
let owner: TestActor;
const ids = { wh: {} as Record<string, string>, peel: "", ex: "", still: "", factory: "", pst: "", exLot: "", order: "", oil: "" };

beforeAll(async () => {
  const db = await getDb();
  ({ owner } = await makeStaff("chiet"));
  for (const w of await db.select().from(warehouses)) ids.wh[w.code] = w.id;
  const mk = async (code: string, kind: "raw_material" | "extract", baseUom: "mg" | "ul", requiresIqc: boolean) =>
    (
      await db
        .insert(inventoryItems)
        .values({ code, name: code, kind, baseUom, displayUom: baseUom === "ul" ? "ml" : "g", purchaseUom: baseUom === "ul" ? "l" : "kg", requiresIqc, refUnitPrice: 1_000_000 })
        .returning({ id: inventoryItems.id })
    )[0]!.id;
  ids.peel = await mk("QA-VO-001", "raw_material", "mg", false);
  ids.ex = await mk("QA-TD-EX", "extract", "ul", true);
  ids.oil = await mk("QA-TD-IQC", "extract", "ul", true);
  ids.still = (await db.insert(suppliers).values({ code: "NCC-QA-LO", name: "Lò chưng QA", kind: "service", paymentTermsDays: 0 }).returning({ id: suppliers.id }))[0]!.id;
  ids.factory = (await db.insert(suppliers).values({ code: "NCC-QA-NM2", name: "Nhà máy QA 2", kind: "factory", paymentTermsDays: 30 }).returning({ id: suppliers.id }))[0]!.id;
  ids.pst = (await db.select().from(products).where(eq(products.code, "PST")))[0]!.id;
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("mẻ chiết → IPQC → lô EX → xuất cho lệnh SX", { timeout: 60_000 }, () => {
  it("AC-SX-27: lô EX chờ IPQC không xuất được cho lệnh; IPQC đạt → released, xuất FEFO lấy đúng lô EX", async () => {
    const db = await getDb();
    await tx((t) => postReceipt(t, { kind: "other", warehouseId: ids.wh.RAW!, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.peel, qty: 50_000_000, lineCost: 1_000_000, qcRequired: false }] }, owner.id));
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
        params: [],
        outputItemId: ids.ex,
      }),
    );
    await tx((t) => issuePeel(t, owner, run.id, { itemId: ids.peel, qty: 50_000_000 }));
    const r = await tx((t) => completeRun(t, owner, run.id, { outputQty: 400_000 }, today));
    ids.exLot = r.stockLotId;
    expect((await db.select().from(stockLots).where(eq(stockLots.id, r.stockLotId)))[0]!.qcStatus).toBe("pending");
    expect((await getItemStock(db, [ids.ex])).get(ids.ex)).toMatchObject({ available: 0, quarantine: 400_000 });

    const o = await tx((t) => createOrder(t, owner, { kind: "outsourced", productId: ids.pst, formulaVersionId: null, formulaLabel: "Công thức nhà máy", supplierId: ids.factory, outsourcingUnitPrice: 40_000, plannedUnits: 100 }));
    ids.order = o.id;
    await tx((t) => addMaterialLine(t, owner, o.id, { itemId: ids.ex, plannedQty: 50_000 }));
    const [m] = await db.select().from(productionOrderMaterials).where(eq(productionOrderMaterials.productionOrderId, o.id));
    await tx((t) => setMaterialSource(t, owner, m!.id, "pomil"));
    await tx((t) => planOrder(t, owner, o.id));
    await tx((t) => approveOrder(t, owner, o.id));
    await expect(tx((t) => issueMaterial(t, owner, o.id, { itemId: ids.ex, qty: 50_000 }))).rejects.toThrow();
    expect(await db.select().from(stockMovements).where(eq(stockMovements.productionOrderId, o.id))).toHaveLength(0);

    const [ip] = await db.select().from(qcInspections).where(and(eq(qcInspections.extractionRunId, run.id), eq(qcInspections.status, "pending")));
    expect(ip!.stage).toBe("ipqc");
    await tx((t) => decideInspection(t, ip!.id, { disposition: "accept" }, owner));
    expect((await db.select().from(stockLots).where(eq(stockLots.id, r.stockLotId)))[0]!.qcStatus).toBe("released");
    await tx((t) => issueMaterial(t, owner, o.id, { itemId: ids.ex, qty: 50_000 }));
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.productionOrderId, o.id), eq(stockMovements.type, "production_issue")));
    expect(mv.map((x) => [x.stockLotId, x.qty])).toEqual([[r.stockLotId, -50_000]]);
    expect(await checkInvariants()).toEqual([]);
  });
});

describe("IQC chấp nhận có điều kiện (R-CL-8)", { timeout: 60_000 }, () => {
  it("use_as_is: lô released, phiếu passed, lý do ở decision_note", async () => {
    const db = await getDb();
    const r = await tx((t) => postReceipt(t, { kind: "other", warehouseId: ids.wh.EXT!, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.oil, qty: 100_000, lineCost: 200_000 }] }, owner.id));
    const [iqc] = await db.select().from(qcInspections).where(eq(qcInspections.stockReceiptId, r.receiptId));
    await tx((t) => decideInspection(t, iqc!.id, { disposition: "use_as_is", note: "Màu đậm hơn mẫu, chấp nhận" }, owner));
    const [sl] = await db.select().from(stockLots).where(eq(stockLots.id, r.lines[0]!.stockLotId));
    expect(sl!.qcStatus).toBe("released");
    const [after] = await db.select().from(qcInspections).where(eq(qcInspections.id, iqc!.id));
    expect(after).toMatchObject({ status: "passed", disposition: "use_as_is", decisionNote: "Màu đậm hơn mẫu, chấp nhận" });
  });

  it("BUG-4 R-CL-8: use_as_is phải ghi 'Chấp nhận có điều kiện: …' vào hold_reason của lô (hiện bị xóa về null)", async () => {
    const db = await getDb();
    const r = await tx((t) => postReceipt(t, { kind: "other", warehouseId: ids.wh.EXT!, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.oil, qty: 100_000, lineCost: 200_000 }] }, owner.id));
    const [iqc] = await db.select().from(qcInspections).where(eq(qcInspections.stockReceiptId, r.receiptId));
    await tx((t) => decideInspection(t, iqc!.id, { disposition: "use_as_is", note: "Tạp chất trong mức NCC" }, owner));
    const [sl] = await db.select().from(stockLots).where(eq(stockLots.id, r.lines[0]!.stockLotId));
    expect(sl!.holdReason).toBe("Chấp nhận có điều kiện: Tạp chất trong mức NCC");
  });
});
