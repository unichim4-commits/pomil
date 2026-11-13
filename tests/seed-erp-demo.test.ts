// Dữ liệu chạy thử ERP (00-tong-quan.md mục 11.2): chạy trên PGlite tạm, nạp qua getDb() như bản chạy thử.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-seed-erp-"));
process.env.PGLITE_DIR = dir;
// Bật bộ dữ liệu chạy thử ERP (mặc định tắt trong vitest để không lẫn vào test phân hệ khác)
process.env.SEED_ERP_DEMO = "1";

import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { erpDemoEnabled, seedErpDemo } from "@/db/seed-erp-demo";

type Db = Awaited<ReturnType<typeof getDb>>;

async function counts(db: Db) {
  const tables = {
    suppliers: s.suppliers,
    items: s.inventoryItems,
    receipts: s.stockReceipts,
    movements: s.stockMovements,
    inspections: s.qcInspections,
    payables: s.payables,
    formulas: s.formulas,
    plans: s.productionPlans,
    orders: s.productionOrders,
    runs: s.extractionRuns,
    dealers: s.dealers,
    budgets: s.budgets,
    products: s.products,
    lots: s.lots,
    customerOrders: s.orders,
  } as const;
  const out: Record<string, number> = {};
  for (const [k, t] of Object.entries(tables)) out[k] = (await db.select({ n: count() }).from(t))[0]!.n;
  return out;
}

let db: Db;
beforeAll(async () => {
  db = await getDb(); // migrate + seed demo (gồm seedErpDemo)
}, 180_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("seedErpDemo", () => {
  it("runs outside vitest, is off by default inside vitest, SEED_ERP_DEMO overrides", () => {
    expect(erpDemoEnabled({})).toBe(true);
    expect(erpDemoEnabled({ VITEST: "true" })).toBe(false);
    expect(erpDemoEnabled({ VITEST: "true", SEED_ERP_DEMO: "1" })).toBe(true);
    expect(erpDemoEnabled({ SEED_ERP_DEMO: "0" })).toBe(false);
  });

  it("keeps the storefront data untouched: Tonic stock 265, not tracked, lot still quarantined", async () => {
    const [tonic] = await db.select().from(s.products).where(eq(s.products.code, "PST"));
    expect(tonic!.stock).toBe(265);
    expect(tonic!.trackInventory).toBe(false);
    const [lot] = await db.select().from(s.lots).where(eq(s.lots.lotNo, "PST-271101-01"));
    expect(lot!.releaseStatus).toBe("quarantine");
    expect((await db.select({ n: count() }).from(s.orders))[0]!.n).toBe(0);
  });

  it("creates suppliers, items and fixed codes with sequences moved past them", async () => {
    const sup = await db.select({ code: s.suppliers.code, name: s.suppliers.name }).from(s.suppliers);
    expect(sup.map((x) => x.code).sort()).toEqual(["NCC-001", "NCC-002", "NCC-003", "NCC-004"]);
    expect(sup.every((x) => x.name.includes("(giả định)"))).toBe(true);
    const items = await db.select().from(s.inventoryItems).where(inArray(s.inventoryItems.code, ["NL-010", "BB-001", "TD-001"]));
    const by = new Map(items.map((i) => [i.code, i]));
    expect(by.get("NL-010")!.shelfLifeDays).toBe(3);
    expect(by.get("BB-001")!.minStock).toBe(100);
    expect(by.get("TD-001")!.densityMgPerMl).toBe(850);
    const seq = await db.select().from(s.docSequences).where(inArray(s.docSequences.key, ["NCC", "NL", "BB", "FORM", "TC", "DL"]));
    expect(Object.fromEntries(seq.map((r) => [r.key, r.lastValue]))).toEqual({ NCC: 4, NL: 10, BB: 4, FORM: 1, TC: 2, DL: 1 });
  });

  it("posts receipts with balances, payables and IQC (NL-003 pending, others passed)", async () => {
    const pkgPayable = await db.select({ amount: s.payables.amount }).from(s.payables);
    const amounts = pkgPayable.map((p) => p.amount).sort((a, b) => a - b);
    // bao bì 300 × (6.000 + 3.000 + 1.500 + 4.500) = 4.500.000; tinh dầu 2.000.000; thuê lò 500.000
    expect(amounts).toContain(4_500_000);
    expect(amounts).toContain(2_000_000);
    expect(amounts).toContain(500_000);

    const iqc = await db
      .select({ status: s.qcInspections.status, code: s.inventoryItems.code })
      .from(s.qcInspections)
      .innerJoin(s.stockLots, eq(s.stockLots.id, s.qcInspections.stockLotId))
      .innerJoin(s.inventoryItems, eq(s.inventoryItems.id, s.stockLots.itemId))
      .where(eq(s.qcInspections.stage, "iqc"));
    const st = new Map(iqc.map((r) => [r.code, r.status]));
    expect(st.get("NL-003")).toBe("pending");
    for (const c of ["TD-001", "BB-001", "BB-004", "NL-001"]) expect(st.get(c)).toBe("passed");

    const [bb1] = await db
      .select({ qty: s.stockBalances.qty })
      .from(s.stockBalances)
      .innerJoin(s.stockLots, eq(s.stockLots.id, s.stockBalances.stockLotId))
      .innerJoin(s.inventoryItems, eq(s.inventoryItems.id, s.stockLots.itemId))
      .where(eq(s.inventoryItems.code, "BB-001"));
    expect(bb1!.qty).toBe(300);

    // Tồn đầu kỳ thành phẩm 300 chai, 19.500.000đ, gắn lô có sẵn
    const [opening] = await db.select().from(s.stockReceipts).where(eq(s.stockReceipts.kind, "opening"));
    expect(opening!.status).toBe("posted");
    expect(opening!.totalCost).toBe(19_500_000);
  });

  it("creates formula, plan, outsourced order, extraction run with EX lot awaiting IPQC, sales and finance data", async () => {
    const [v] = await db.select().from(s.formulaVersions);
    expect(v!.status).toBe("approved");
    const lines = await db.select({ ppm: s.formulaLines.ppm }).from(s.formulaLines).where(eq(s.formulaLines.formulaVersionId, v!.id));
    expect(lines.reduce((a, l) => a + l.ppm, 0)).toBe(1_000_000);

    const [plan] = await db.select().from(s.productionPlans);
    expect(plan!.status).toBe("draft");
    const [order] = await db.select().from(s.productionOrders);
    expect(order!.status).toBe("planned");
    expect(order!.outsourcingUnitPrice).toBe(40_000);

    const [run] = await db.select().from(s.extractionRuns);
    expect(run!.status).toBe("completed");
    expect(run!.outputQty).toBe(400_000);
    const [ipqc] = await db
      .select({ status: s.qcInspections.status })
      .from(s.qcInspections)
      .where(and(eq(s.qcInspections.stage, "ipqc"), eq(s.qcInspections.stockLotId, run!.outputStockLotId!)));
    expect(ipqc!.status).toBe("pending");

    const [dealer] = await db.select().from(s.dealers);
    expect(dealer).toMatchObject({ code: "DL-001", creditLimit: 5_000_000, paymentTermsDays: 15, commissionBp: 500, discountBp: 0 });
    const [voucher] = await db.select().from(s.vouchers).where(eq(s.vouchers.code, "THU10"));
    expect(voucher).toMatchObject({ kind: "percent", value: 1000, maxDiscount: 30_000 });
    const acc = await db.select({ code: s.cashAccounts.code, opening: s.cashAccounts.openingBalance }).from(s.cashAccounts);
    expect(Object.fromEntries(acc.map((a) => [a.code, a.opening]))).toMatchObject({ TM: 5_000_000, NH: 20_000_000 });
    const budgetLines = await db.select({ amount: s.budgetLines.amount }).from(s.budgetLines);
    expect(budgetLines.map((b) => b.amount).sort()).toEqual([2_000_000, 3_000_000]);
  });

  it("is idempotent: a second run adds nothing", async () => {
    const before = await counts(db);
    await db.transaction(async (tx) => seedErpDemo(tx));
    expect(await counts(db)).toEqual(before);
    const [tonic] = await db.select().from(s.products).where(eq(s.products.code, "PST"));
    expect(tonic!.stock).toBe(265);
  });
});
