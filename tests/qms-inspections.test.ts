import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { seedErpMasterData } from "@/db/seed-erp";
import { createInspection, hasBlockingDeviation } from "@/modules/qms/inspections";
import { appliesToForItemKind, inspectionAppliesTo, isDeviationBlocking, pickStandard, type StandardCandidate } from "@/modules/qms/inspection-rules";

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("Không có dòng");
  return row;
}

// T-14b-C: phiếu kiểm dùng chung (03-chat-luong.md R-CL-1, R-CL-2, R-CL-10; 00 mục 8.3)

describe("R-CL-2: nhóm tiêu chuẩn theo loại phiếu", () => {
  it("maps item kinds and stages to applies_to", () => {
    expect(appliesToForItemKind("raw_material")).toBe("raw_material");
    expect(appliesToForItemKind("extract")).toBe("extract");
    expect(appliesToForItemKind("packaging")).toBe("packaging");
    expect(appliesToForItemKind("wip")).toBe("wip");
    expect(appliesToForItemKind("other")).toBe("raw_material");
    expect(inspectionAppliesTo({ stage: "iqc", itemKind: "packaging" })).toBe("packaging");
    expect(inspectionAppliesTo({ stage: "iqc", itemKind: "other" })).toBe("raw_material");
    expect(inspectionAppliesTo({ stage: "ipqc", extractionRunId: "x" })).toBe("extract");
    expect(inspectionAppliesTo({ stage: "ipqc" })).toBe("wip");
    expect(inspectionAppliesTo({ stage: "fqc" })).toBe("finished");
    expect(inspectionAppliesTo({ stage: "recheck" })).toBe("finished");
  });

  const std = (p: Partial<StandardCandidate> & { id: string }): StandardCandidate => ({
    status: "active",
    appliesTo: "raw_material",
    itemId: null,
    productId: null,
    effectiveFrom: null,
    code: p.id,
    ...p,
  });

  it("prefers the item-specific standard, then the newest general one, ignoring non-active", () => {
    const list = [
      std({ id: "g-old", effectiveFrom: "2026-01-01" }),
      std({ id: "g-new", effectiveFrom: "2026-06-01" }),
      std({ id: "g-draft", effectiveFrom: "2026-10-01", status: "draft" }),
      std({ id: "item", itemId: "I1", effectiveFrom: "2025-01-01" }),
      std({ id: "pkg", appliesTo: "packaging" }),
    ];
    expect(pickStandard(list, { stage: "iqc", appliesTo: "raw_material", itemId: "I1" })?.id).toBe("item");
    expect(pickStandard(list, { stage: "iqc", appliesTo: "raw_material", itemId: "I2" })?.id).toBe("g-new");
    expect(pickStandard(list, { stage: "iqc", appliesTo: "extract", itemId: "I2" })).toBeNull();
  });

  it("matches product for FQC/recheck, not item", () => {
    const list = [std({ id: "fin", appliesTo: "finished" }), std({ id: "prod", appliesTo: "finished", productId: "P1" }), std({ id: "item", appliesTo: "finished", itemId: "I1" })];
    expect(pickStandard(list, { stage: "fqc", appliesTo: "finished", productId: "P1", itemId: "I1" })?.id).toBe("prod");
    expect(pickStandard(list, { stage: "recheck", appliesTo: "finished", productId: "P2", itemId: "I1" })?.id).toBe("fin");
  });
});

describe("R-CL-10: chặn khi IPQC lệch", () => {
  const t = (h: number) => new Date(`2026-11-11T${String(h).padStart(2, "0")}:00:00+07:00`);
  it("blocks on failed without a later pass for the same ref", () => {
    expect(isDeviationBlocking([])).toBe(false);
    expect(isDeviationBlocking([{ key: "s2", status: "failed", decidedAt: t(9), createdAt: t(8) }])).toBe(true);
    // Ví dụ đặc tả: failed 9:00, passed 11:00 → không còn chặn
    expect(
      isDeviationBlocking([
        { key: "s2", status: "failed", decidedAt: t(9), createdAt: t(8) },
        { key: "s2", status: "passed", decidedAt: t(11), createdAt: t(10) },
      ]),
    ).toBe(false);
    // Passed trước failed vẫn chặn; passed của công đoạn khác không gỡ chặn
    expect(
      isDeviationBlocking([
        { key: "s2", status: "passed", decidedAt: t(8), createdAt: t(7) },
        { key: "s2", status: "failed", decidedAt: t(9), createdAt: t(8) },
      ]),
    ).toBe(true);
    expect(
      isDeviationBlocking([
        { key: "s1", status: "failed", decidedAt: t(9), createdAt: t(8) },
        { key: "s2", status: "passed", decidedAt: t(11), createdAt: t(10) },
      ]),
    ).toBe(true);
    expect(isDeviationBlocking([{ key: "s1", status: "cancelled", decidedAt: t(9), createdAt: t(8) }])).toBe(false);
  });
});

// Migrate PGlite chậm khi cả bộ test chạy song song: nới thời gian chờ
describe("createInspection và hasBlockingDeviation trên PGlite", { timeout: 60_000 }, () => {
  let db: Db;
  let rawItemId: string;
  let otherItemId: string;
  let productId: string;
  let lotId: string;
  let orderId: string;
  let step1Id: string;
  let step2Id: string;

  async function newStockLot(itemId: string, code: string) {
    const sl = one(await db
      .insert(schema.stockLots)
      .values({ code, itemId, receivedQty: 1000, receivedCost: 0, qcStatus: "pending", sourceDocType: "receipt", sourceDocId: crypto.randomUUID() })
      .returning());
    return sl.id;
  }

  async function addStandard(input: { code: string; version?: number; appliesTo: "raw_material" | "extract" | "wip" | "finished" | "packaging"; itemId?: string; productId?: string; status?: "draft" | "active" | "archived"; effectiveFrom?: string; params: { name: string; min?: number; max?: number; critical?: boolean }[] }) {
    const s = one(await db
      .insert(schema.qcStandards)
      .values({ code: input.code, version: input.version ?? 1, name: input.code, appliesTo: input.appliesTo, itemId: input.itemId ?? null, productId: input.productId ?? null, status: input.status ?? "active", effectiveFrom: input.effectiveFrom ?? null })
      .returning());
    if (input.params.length > 0) {
      await db.insert(schema.qcStandardParams).values(
        input.params.map((p, i) => ({ standardId: s.id, name: p.name, paramGroup: "physicochemical" as const, kind: "range" as const, unit: "", minMilli: p.min ?? null, maxMilli: p.max ?? null, isCritical: p.critical ?? true, sort: i })),
      );
    }
    return s.id;
  }

  beforeAll(async () => {
    // PGlite trong bộ nhớ: mỗi file test một cơ sở dữ liệu riêng
    const client = new PGlite();
    db = drizzle(client, { schema }) as unknown as Db;
    await migrate(drizzle(client, { schema }), { migrationsFolder: "drizzle" });
    const p = one(await db.insert(schema.products).values({ code: "TST", name: "Sản phẩm thử", slug: "san-pham-thu" }).returning());
    productId = p.id;
    await seedErpMasterData(db);
    const raw = one(await db.insert(schema.inventoryItems).values({ code: "NL-901", name: "Tinh dầu thử", kind: "raw_material", baseUom: "ul", displayUom: "ml", purchaseUom: "l" }).returning());
    rawItemId = raw.id;
    const other = one(await db.insert(schema.inventoryItems).values({ code: "NL-902", name: "Hàng khác", kind: "other", baseUom: "mg", displayUom: "g", purchaseUom: "kg" }).returning());
    otherItemId = other.id;
    const lot = one(await db.insert(schema.lots).values({ lotNo: "TST-261111-01", productId, formulaVersion: "TST-v1", manufacturedOn: "2026-11-11", expiresOn: "2028-11-11", unitsProduced: 300 }).returning());
    lotId = lot.id;
    const po = one(await db.insert(schema.productionOrders).values({ code: "LSX-2611-901", kind: "in_house", productId, plannedUnits: 300 }).returning());
    orderId = po.id;
    const steps = await db
      .insert(schema.productionOrderSteps)
      .values([
        { productionOrderId: orderId, seq: 1, name: "Cân", needsQc: true },
        { productionOrderId: orderId, seq: 2, name: "Phối trộn", needsQc: true },
      ])
      .returning();
    step1Id = one(steps).id;
    step2Id = one(steps.slice(1)).id;
  }, 120_000);

  it("IQC picks the item standard, snapshots params, returns the pending one on retry, and writes audit (R-CL-1, R-CL-2)", async () => {
    await addStandard({ code: "TC-901", appliesTo: "raw_material", effectiveFrom: "2026-01-01", params: [{ name: "Chung", min: 1 }] });
    const itemStd = await addStandard({ code: "TC-902", appliesTo: "raw_material", itemId: rawItemId, params: [{ name: "Tỷ trọng", min: 850, max: 900 }, { name: "Cảm quan", critical: false }] });
    const stockLotId = await newStockLot(rawItemId, "VT-2611-9001");

    const first = await db.transaction((tx) => createInspection(tx, { stage: "iqc", stockLotId }, null));
    expect(first.created).toBe(true);
    expect(first.code).toMatch(/^IQC-\d{4}-\d{3}$/);
    const ins = one(await db.select().from(schema.qcInspections).where(eq(schema.qcInspections.id, first.id)));
    expect(ins.standardId).toBe(itemStd);
    expect(ins.status).toBe("pending");
    const results = await db.select().from(schema.qcInspectionResults).where(eq(schema.qcInspectionResults.inspectionId, first.id)).orderBy(schema.qcInspectionResults.sort);
    expect(results.map((r) => [r.name, r.minMilli, r.maxMilli, r.isCritical])).toEqual([
      ["Tỷ trọng", 850, 900, true],
      ["Cảm quan", null, null, false],
    ]);

    // Đổi tiêu chuẩn sau đó không đổi phiếu (R-CL-1)
    await db.update(schema.qcStandardParams).set({ minMilli: 1 }).where(eq(schema.qcStandardParams.standardId, itemStd));
    const snap = one(await db.select().from(schema.qcInspectionResults).where(and(eq(schema.qcInspectionResults.inspectionId, first.id), eq(schema.qcInspectionResults.name, "Tỷ trọng"))));
    expect(snap.minMilli).toBe(850);

    const again = await db.transaction((tx) => createInspection(tx, { stage: "iqc", stockLotId }, null));
    expect(again).toEqual({ id: first.id, code: first.code, created: false });
    const audits = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entity, "qc_inspection"), eq(schema.auditLog.entityId, first.id)));
    expect(audits.map((a) => a.action)).toEqual(["qc_inspection.created"]);
  });

  it("IQC for kind other falls back to the newest general raw_material standard; none → no params", async () => {
    await addStandard({ code: "TC-903", appliesTo: "raw_material", effectiveFrom: "2026-09-01", params: [{ name: "Mới nhất" }] });
    await addStandard({ code: "TC-904", appliesTo: "raw_material", effectiveFrom: "2026-10-01", status: "draft", params: [{ name: "Nháp" }] });
    const otherLot = await newStockLot(otherItemId, "VT-2611-9002");
    const r = await db.transaction((tx) => createInspection(tx, { stage: "iqc", stockLotId: otherLot }, null));
    const res = await db.select().from(schema.qcInspectionResults).where(eq(schema.qcInspectionResults.inspectionId, r.id));
    expect(res.map((x) => x.name)).toEqual(["Mới nhất"]);

    // IPQC công đoạn → nhóm wip, chưa có tiêu chuẩn wip → phiếu không có chỉ tiêu
    const ipqc = await db.transaction((tx) => createInspection(tx, { stage: "ipqc", productionStepId: step1Id }, null));
    expect(ipqc.code).toMatch(/^IPQC-/);
    const row = one(await db.select().from(schema.qcInspections).where(eq(schema.qcInspections.id, ipqc.id)));
    expect(row.standardId).toBeNull();
    expect(row.productionOrderId).toBe(orderId);
    expect(await db.select().from(schema.qcInspectionResults).where(eq(schema.qcInspectionResults.inspectionId, ipqc.id))).toHaveLength(0);
    // Bấm lại: trả phiếu đang chờ của công đoạn
    expect((await db.transaction((tx) => createInspection(tx, { stage: "ipqc", productionStepId: step1Id }, null))).created).toBe(false);
  });

  it("FQC uses the product standard and explicit standardId overrides auto pick; KTL prefix for recheck", async () => {
    const general = await addStandard({ code: "TC-905", appliesTo: "finished", params: [{ name: "Ngoại quan" }] });
    const prodStd = await addStandard({ code: "TC-906", appliesTo: "finished", productId, params: [{ name: "pH", min: 4500, max: 5500 }] });
    const fqc = await db.transaction((tx) => createInspection(tx, { stage: "fqc", lotId, productionOrderId: orderId }, null));
    expect(fqc.code).toMatch(/^FQC-/);
    const f = one(await db.select().from(schema.qcInspections).where(eq(schema.qcInspections.id, fqc.id)));
    expect(f.standardId).toBe(prodStd);

    const ktl = await db.transaction((tx) => createInspection(tx, { stage: "recheck", lotId, standardId: general }, null));
    expect(ktl.code).toMatch(/^KTL-/);
    const k = one(await db.select().from(schema.qcInspections).where(eq(schema.qcInspections.id, ktl.id)));
    expect(k.standardId).toBe(general);

    const draft = await addStandard({ code: "TC-907", appliesTo: "finished", status: "draft", params: [] });
    await expect(db.transaction((tx) => createInspection(tx, { stage: "recheck", lotId: null, standardId: draft }, null))).rejects.toThrow();
    await expect(db.transaction((tx) => createInspection(tx, { stage: "ipqc" }, null))).rejects.toThrow("IPQC");
  });

  it("hasBlockingDeviation follows AC-CL-11 / AC-CL-12", async () => {
    expect(await hasBlockingDeviation(db, { productionOrderId: orderId })).toBe(false);
    const a = await db.transaction((tx) => createInspection(tx, { stage: "ipqc", productionStepId: step2Id, productionOrderId: orderId }, null));
    // Đang chờ không chặn
    expect(await hasBlockingDeviation(db, { productionStepId: step2Id })).toBe(false);
    await db.update(schema.qcInspections).set({ status: "failed", disposition: "reject", decidedAt: new Date("2026-11-11T02:00:00Z") }).where(eq(schema.qcInspections.id, a.id));
    expect(await hasBlockingDeviation(db, { productionStepId: step2Id })).toBe(true);
    expect(await hasBlockingDeviation(db, { productionOrderId: orderId })).toBe(true);
    expect(await hasBlockingDeviation(db, { productionStepId: step1Id })).toBe(false);

    const b = await db.transaction((tx) => createInspection(tx, { stage: "ipqc", productionStepId: step2Id }, null));
    expect(b.created).toBe(true);
    await db.update(schema.qcInspections).set({ status: "passed", disposition: "accept", decidedAt: new Date("2026-11-11T04:00:00Z") }).where(eq(schema.qcInspections.id, b.id));
    expect(await hasBlockingDeviation(db, { productionStepId: step2Id })).toBe(false);
    expect(await hasBlockingDeviation(db, { productionOrderId: orderId })).toBe(false);
    expect(await hasBlockingDeviation(db, {})).toBe(false);
  });
});
