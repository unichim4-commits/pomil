import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { seedErpMasterData } from "@/db/seed-erp";
import { computeProductionCost, lockProductionCost, materialCostsFromConsumption, recalcProductionCost } from "@/modules/production/costing";

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("Không có dòng");
  return row;
}

// T-14b-C: giá thành lệnh (02-san-xuat.md R-SX-26, AC-SX-28, AC-SX-29; 05-tai-chinh.md R-TC-17, R-TC-19)

const zero = { material: 0, packaging: 0, labor: 0, overheadManual: 0, overheadAllocated: 0, outsourcing: 0, other: 0 };

describe("R-SX-26: computeProductionCost", () => {
  it("AC-SX-28: in-house example 19.500.000đ / 300 chai = 65.000đ", () => {
    expect(computeProductionCost({ ...zero, material: 10_500_000, packaging: 4_500_000, labor: 2_400_000, overheadManual: 2_100_000, goodUnits: 300 })).toEqual({ total: 19_500_000, unitCost: 65_000 });
  });
  it("outsourced example rounds 56.756,76 to 56.757đ", () => {
    expect(computeProductionCost({ ...zero, material: 300_000, packaging: 4_500_000, outsourcing: 12_000_000, goodUnits: 296 })).toEqual({ total: 16_800_000, unitCost: 56_757 });
  });
  it("adds allocated overhead and other; unitCost null with 0 good units; rounds half up", () => {
    expect(computeProductionCost({ ...zero, overheadManual: 100, overheadAllocated: 604_839, other: 61, goodUnits: 0 })).toEqual({ total: 605_000, unitCost: null });
    expect(computeProductionCost({ ...zero, material: 5, goodUnits: 2 }).unitCost).toBe(3);
    expect(computeProductionCost({ ...zero, material: 7, goodUnits: 3 }).unitCost).toBe(2);
  });
  it("material/packaging from net consumption × lot cost (costOfQty)", () => {
    expect(
      materialCostsFromConsumption([
        { stockLotId: "a", netQty: 150_000, receivedQty: 1_000_000, receivedCost: 2_000_000, isPackaging: false },
        { stockLotId: "b", netQty: 300, receivedQty: 300, receivedCost: 4_500_000, isPackaging: true },
        { stockLotId: "c", netQty: 0, receivedQty: 10, receivedCost: 999, isPackaging: true },
      ]),
    ).toEqual({ material: 300_000, packaging: 4_500_000 });
  });
});

// Migrate PGlite chậm khi cả bộ test chạy song song: nới thời gian chờ
describe("recalcProductionCost và lockProductionCost trên PGlite", { timeout: 60_000 }, () => {
  let db: Db;
  let orderId: string;
  let fgStockLotId: string;
  let oilLotId: string;
  let bottleLotId: string;
  let bottleLot2Id: string;
  let oilItemId: string;
  let bottleItemId: string;
  let wh: { warehouseId: string; locationId: string };

  async function move(input: { type: "production_issue" | "production_return" | "reversal" | "sale_issue"; itemId: string; stockLotId: string; qty: number; orderId?: string | null; reversalOf?: string }) {
    const m = one(await db
      .insert(schema.stockMovements)
      .values({
        type: input.type,
        docType: input.type === "production_return" ? "receipt" : "issue",
        docId: crypto.randomUUID(),
        docCode: "PX-2611-9999",
        itemId: input.itemId,
        stockLotId: input.stockLotId,
        warehouseId: wh.warehouseId,
        locationId: wh.locationId,
        qty: input.qty,
        balanceAfter: 0,
        productionOrderId: input.orderId === undefined ? orderId : input.orderId,
        reversalOf: input.reversalOf ?? null,
      })
      .returning());
    return m.id;
  }

  beforeAll(async () => {
    // PGlite trong bộ nhớ: mỗi file test một cơ sở dữ liệu riêng
    const client = new PGlite();
    db = drizzle(client, { schema }) as unknown as Db;
    await migrate(drizzle(client, { schema }), { migrationsFolder: "drizzle" });
    const p = one(await db.insert(schema.products).values({ code: "TST", name: "Sản phẩm thử", slug: "san-pham-thu" }).returning());
    await seedErpMasterData(db);
    const w = one(await db.select({ warehouseId: schema.warehouses.id, locationId: schema.warehouseLocations.id }).from(schema.warehouses).innerJoin(schema.warehouseLocations, eq(schema.warehouseLocations.warehouseId, schema.warehouses.id)).limit(1));
    wh = w;
    const fgItem = one(await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.productId, p.id)));

    const oil = one(await db.insert(schema.inventoryItems).values({ code: "TD-901", name: "Tinh dầu thử", kind: "extract", baseUom: "ul", displayUom: "ml", purchaseUom: "l" }).returning());
    const bottle = one(await db.insert(schema.inventoryItems).values({ code: "BB-901", name: "Chai thử", kind: "packaging", baseUom: "pcs", displayUom: "cái", purchaseUom: "cái" }).returning());
    oilItemId = oil.id;
    bottleItemId = bottle.id;
    const src = { sourceDocType: "receipt" as const, sourceDocId: crypto.randomUUID(), qcStatus: "released" as const };
    const lotsIns = await db
      .insert(schema.stockLots)
      .values([
        { code: "EX-2611-901", itemId: oil.id, receivedQty: 1_000_000, receivedCost: 2_000_000, ...src },
        { code: "VT-2611-9901", itemId: bottle.id, receivedQty: 300, receivedCost: 4_500_000, ...src },
        { code: "VT-2611-9902", itemId: bottle.id, receivedQty: 100, receivedCost: 1_000_000, ...src },
      ])
      .returning();
    [oilLotId, bottleLotId, bottleLot2Id] = lotsIns.map((l) => l.id) as [string, string, string];

    const lot = one(await db.insert(schema.lots).values({ lotNo: "TST-261111-01", productId: p.id, formulaVersion: "TST-v1", manufacturedOn: "2026-11-11", expiresOn: "2028-11-11", unitsProduced: 296 }).returning());
    const po = one(await db
      .insert(schema.productionOrders)
      .values({ code: "LSX-2611-901", kind: "outsourced", productId: p.id, plannedUnits: 300, goodUnits: 296, lotId: lot.id, outsourcingCost: 12_000_000 })
      .returning());
    orderId = po.id;
    const fg = one(await db
      .insert(schema.stockLots)
      .values({ code: lot.lotNo, itemId: fgItem.id, productLotId: lot.id, receivedQty: 296, receivedCost: 0, qcStatus: null, sourceDocType: "receipt", sourceDocId: crypto.randomUUID(), productionOrderId: po.id })
      .returning());
    fgStockLotId = fg.id;
  }, 120_000);

  it("outsourced example: issue − return + reversal → 16.800.000đ, 56.757đ/chai, FG lot received_cost (R-SX-26, R-TC-17)", async () => {
    await move({ type: "production_issue", itemId: oilItemId, stockLotId: oilLotId, qty: -200_000 });
    await move({ type: "production_return", itemId: oilItemId, stockLotId: oilLotId, qty: 50_000 });
    await move({ type: "production_issue", itemId: bottleItemId, stockLotId: bottleLotId, qty: -300 });
    // Xuất nhầm lô chai 2 rồi đảo: không tính
    const wrong = await move({ type: "production_issue", itemId: bottleItemId, stockLotId: bottleLot2Id, qty: -10 });
    await move({ type: "reversal", itemId: bottleItemId, stockLotId: bottleLot2Id, qty: 10, orderId: null, reversalOf: wrong });
    // Biến động của lệnh khác và loại khác không tính
    await move({ type: "sale_issue", itemId: oilItemId, stockLotId: oilLotId, qty: -1_000, orderId: null });

    const r = await db.transaction((tx) => recalcProductionCost(tx, orderId, null));
    expect(r).toEqual({ total: 16_800_000, unitCost: 56_757, locked: false });
    const po = one(await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, orderId)));
    expect([po.materialCost, po.packagingCost, po.outsourcingCost, po.totalCost]).toEqual([300_000, 4_500_000, 12_000_000, 16_800_000]);
    const fg = one(await db.select().from(schema.stockLots).where(eq(schema.stockLots.id, fgStockLotId)));
    expect(fg.receivedCost).toBe(16_800_000);
    const audits = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entity, "production_order"), eq(schema.auditLog.action, "production_order.cost_recalculated")));
    expect(audits).toHaveLength(1);

    // Tính lại không đổi gì → không ghi thêm audit
    await db.transaction((tx) => recalcProductionCost(tx, orderId, null));
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "production_order.cost_recalculated"))).toHaveLength(1);
  });

  it("adds overhead allocation lines and manual costs", async () => {
    const alloc = one(await db.insert(schema.overheadAllocations).values({ code: "PB-2611-01", periodMonth: "2026-11-01", totalAmount: 1_000_000, basis: "units" }).returning());
    await db.insert(schema.overheadAllocationLines).values({ allocationId: alloc.id, productionOrderId: orderId, amount: 604_839 });
    await db.update(schema.productionOrders).set({ laborCost: 100_000, overheadCost: 50_000, otherCost: 45_161 }).where(eq(schema.productionOrders.id, orderId));
    const r = await db.transaction((tx) => recalcProductionCost(tx, orderId, null));
    expect(r.total).toBe(16_800_000 + 604_839 + 100_000 + 50_000 + 45_161);
    expect(r.unitCost).toBe(Math.round(17_600_000 / 296));
    const fg = one(await db.select().from(schema.stockLots).where(eq(schema.stockLots.id, fgStockLotId)));
    expect(fg.receivedCost).toBe(17_600_000);
  });

  it("AC-SX-29 / R-TC-19: locked orders are not rewritten; unlock allows recalculation", async () => {
    const actor = crypto.randomUUID();
    await db.transaction((tx) => lockProductionCost(tx, orderId, true, actor));
    const po = one(await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, orderId)));
    expect(po.costLockedAt).not.toBeNull();
    const fg = one(await db.select().from(schema.stockLots).where(eq(schema.stockLots.id, fgStockLotId)));
    expect(fg.costLockedAt).not.toBeNull();
    // Chốt lần hai không làm gì
    await db.transaction((tx) => lockProductionCost(tx, orderId, true, actor));
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "production_order.cost_locked"))).toHaveLength(1);

    await db.update(schema.productionOrders).set({ laborCost: 999_999 }).where(eq(schema.productionOrders.id, orderId));
    const r = await db.transaction((tx) => recalcProductionCost(tx, orderId, null));
    expect(r).toEqual({ total: 17_600_000, unitCost: Math.round(17_600_000 / 296), locked: true });
    const after = one(await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, orderId)));
    expect(after.totalCost).toBe(17_600_000);

    await db.transaction((tx) => lockProductionCost(tx, orderId, false, actor));
    const unl = one(await db.select().from(schema.stockLots).where(eq(schema.stockLots.id, fgStockLotId)));
    expect(unl.costLockedAt).toBeNull();
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "production_order.cost_unlocked"))).toHaveLength(1);
    const r2 = await db.transaction((tx) => recalcProductionCost(tx, orderId, null));
    expect(r2.locked).toBe(false);
    expect(r2.total).toBe(17_600_000 - 100_000 + 999_999);
  });

  it("unitCost null when no good units yet; unknown order throws", async () => {
    await db.update(schema.productionOrders).set({ goodUnits: null }).where(eq(schema.productionOrders.id, orderId));
    expect((await db.transaction((tx) => recalcProductionCost(tx, orderId, null))).unitCost).toBeNull();
    await expect(db.transaction((tx) => recalcProductionCost(tx, crypto.randomUUID(), null))).rejects.toThrow("Không tìm thấy lệnh sản xuất");
  });
});
