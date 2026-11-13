import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { seedInitialData } from "@/db/seed";
import { seedErpMasterData, SYSTEM_FINANCE_CATEGORIES } from "@/db/seed-erp";
import { parseErpSettings } from "@/modules/settings/erp-schema";

// 56 bảng mới theo 00-tong-quan.md mục 3.8
const NEW_TABLES = [
  "doc_sequences",
  "suppliers", "warehouses", "warehouse_locations", "inventory_items", "stock_lots", "stock_balances", "stock_movements",
  "stock_receipts", "stock_receipt_lines", "stock_issues", "stock_issue_lines", "stock_transfers", "stock_transfer_lines", "stock_counts", "stock_count_lines",
  "formulas", "formula_versions", "formula_lines", "formula_packaging", "production_plans", "production_plan_lines",
  "production_orders", "production_order_materials", "production_order_steps", "extraction_runs",
  "sales_channels", "price_lists", "price_list_items", "product_bundles", "product_bundle_items", "vouchers", "dealers", "return_requests", "return_request_lines",
  "qc_standards", "qc_standard_params", "qc_inspections", "qc_inspection_results", "ncrs", "capas", "capa_actions", "recalls", "recall_lots", "recall_contacts",
  "cash_accounts", "finance_categories", "cash_transactions", "cash_reconciliations", "budgets", "budget_lines",
  "receivables", "payables", "debt_payments", "overhead_allocations", "overhead_allocation_lines",
];

describe("T-14a: schema, migration và dữ liệu nền ERP", () => {
  it("migrates a fresh PGlite, enables RLS on all new tables, seeds master data idempotently", async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });

    expect(NEW_TABLES.length).toBe(56);
    const tables = await client.query<{ tablename: string; rowsecurity: boolean }>("select tablename, rowsecurity from pg_tables where schemaname = 'public'");
    const byName = new Map(tables.rows.map((r) => [r.tablename, r.rowsecurity]));
    for (const t of NEW_TABLES) {
      expect(byName.has(t), `thiếu bảng ${t}`).toBe(true);
      expect(byName.get(t), `bảng ${t} chưa bật RLS`).toBe(true);
    }

    // Enum mới dùng được ngay sau migration (ALTER TYPE … ADD VALUE đã commit)
    const enums = await client.query<{ v: string }>("select unnest(enum_range(null::lot_release_status))::text as v");
    expect(enums.rows.map((r) => r.v)).toContain("rejected");
    const pm = await client.query<{ v: string }>("select unnest(enum_range(null::payment_method))::text as v");
    expect(pm.rows.map((r) => r.v)).toEqual(["cod", "bank_transfer", "cash", "platform", "credit"]);

    // Dữ liệu nền chạy trong seedInitialData (demo)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await seedInitialData(db as any, "demo")).toBe(true);

    const warehouses = await db.select().from(schema.warehouses);
    expect(warehouses.map((w) => w.code).sort()).toEqual(["EXT", "FG", "PKG", "RAW", "REJ", "WIP"]);
    const locations = await db.select().from(schema.warehouseLocations);
    expect(locations.length).toBe(6);
    expect(locations.every((l) => l.isDefault && l.code === "CHUNG")).toBe(true);

    const accounts = await db.select().from(schema.cashAccounts);
    expect(accounts.map((a) => a.code).sort()).toEqual(["COD", "NH", "TM"]);
    expect(accounts.every((a) => a.openingBalance === 0)).toBe(true);

    const channels = await db.select().from(schema.salesChannels);
    expect(channels.length).toBe(7);
    expect(channels.every((c) => c.feeRateBp === 0 && c.payoutDays === 0 && c.apiStatus === "not_connected")).toBe(true);

    const cats = await db.select().from(schema.financeCategories);
    expect(cats.length).toBe(SYSTEM_FINANCE_CATEGORIES.length);
    expect(cats.every((c) => c.isSystem)).toBe(true);

    const products = await db.select().from(schema.products);
    const items = await db.select().from(schema.inventoryItems);
    expect(items.length).toBe(products.length);
    for (const p of products) {
      const item = items.find((i) => i.productId === p.id);
      expect(item).toMatchObject({ code: p.code, kind: "finished", baseUom: "pcs", displayUom: "chai", requiresIqc: false });
      expect(p.trackInventory).toBe(false);
    }
    // Migration dữ liệu: sản phẩm active → commercial, còn lại developing
    const tonic = products.find((p) => p.code === "PST")!;
    expect(tonic.devStage).toBe("commercial");
    expect(tonic.stock).toBe(265);
    expect(products.filter((p) => p.status !== "active").every((p) => p.devStage === "developing")).toBe(true);

    const [erp] = await db.select().from(schema.settings).where(eq(schema.settings.key, "erp"));
    expect(parseErpSettings(erp?.value)).toMatchObject({ expiryWarnDays: 90, slowMovingDays: 90, overIssueWarnBp: 500, budgetWarnBp: 8000, debtDueSoonDays: 7, minCashAlert: 0, forecastWeeks: 8, manualDiscountMaxBp: 1000, returnWindowDays: 0, lastExpiryRefreshAt: null });

    // Gọi lần hai: không thêm dòng
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await seedErpMasterData(db as any)).toBe(0);
    expect((await db.select().from(schema.warehouses)).length).toBe(6);
    expect((await db.select().from(schema.warehouseLocations)).length).toBe(6);
    expect((await db.select().from(schema.inventoryItems)).length).toBe(products.length);
    expect((await db.select().from(schema.cashAccounts)).length).toBe(3);
    expect((await db.select().from(schema.salesChannels)).length).toBe(7);
    expect((await db.select().from(schema.financeCategories)).length).toBe(SYSTEM_FINANCE_CATEGORIES.length);

    // Ràng buộc: số dư không âm
    const [lot] = await db
      .insert(schema.stockLots)
      .values({ code: "VT-TEST-0001", itemId: items[0]!.id, receivedQty: 1, qcStatus: "released", sourceDocType: "receipt", sourceDocId: "00000000-0000-4000-8000-000000000000" })
      .returning();
    const fg = warehouses.find((w) => w.code === "FG")!;
    const loc = locations.find((l) => l.warehouseId === fg.id)!;
    await expect(db.insert(schema.stockBalances).values({ locationId: loc.id, stockLotId: lot!.id, warehouseId: fg.id, itemId: items[0]!.id, qty: -1 })).rejects.toThrow();

    await client.close();
  }, 120_000);
});
