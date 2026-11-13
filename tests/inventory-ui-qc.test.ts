// Kho × Chất lượng: lô chờ kiểm (AC-CL-10) và hủy phiếu nhập hủy phiếu IQC chờ qua hàm dùng chung (R-KHO-16)
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db, Tx } from "@/db/client";
import { seedErpMasterData } from "@/db/seed-erp";
import { saveItem, saveSupplier } from "@/modules/inventory/admin";
import { cancelReceipt, postIssue, postReceipt } from "@/modules/inventory/ledger";

let db: Db;
const ids = { owner: "", supplier: "", item: "", raw: "" };
const tx = <T>(fn: (t: Tx) => Promise<T>) => db.transaction(fn);

async function receivePending(qty: number) {
  return tx((t) => postReceipt(t, { kind: "purchase", warehouseId: ids.raw, supplierId: ids.supplier, receivedOn: "2026-11-11", lines: [{ itemId: ids.item, qty, lineCost: 100_000 }] }, ids.owner));
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client, { schema }), { migrationsFolder: "drizzle" });
  await seedErpMasterData(db);
  const [owner] = await db.insert(schema.staffUsers).values({ email: "chu-qc@test.vn", role: "owner", passwordHash: "x" }).returning();
  ids.owner = owner!.id;
  const [raw] = await db.select().from(schema.warehouses).where(eq(schema.warehouses.code, "RAW"));
  ids.raw = raw!.id;
  ids.supplier = (await tx((t) => saveSupplier(t, null, { name: "NCC nguyên liệu", kind: "material", paymentTermsDays: 0, qualified: true }, ids.owner))).id;
  ids.item = (
    await tx((t) => saveItem(t, null, { code: "NL-001", name: "Nước tinh khiết", kind: "raw_material", baseUom: "ul", displayUom: "ml", purchaseUom: "l", requiresIqc: true }, ids.owner))
  ).id;
}, 120_000);

describe("AC-CL-10: lô vật tư đang chờ kiểm", () => {
  it("xuất sản xuất chọn tay lô chờ kiểm bị chặn; xuất mẫu kiểm nghiệm qc_sample thì được", async () => {
    const r = await receivePending(1_000_000);
    const lotId = r.lines[0]!.stockLotId;
    const [lot] = await db.select().from(schema.stockLots).where(eq(schema.stockLots.id, lotId));
    expect(lot!.qcStatus).toBe("pending");

    await expect(tx((t) => postIssue(t, { kind: "production", lines: [{ itemId: ids.item, qty: 100_000, stockLotId: lotId }] }, ids.owner))).rejects.toThrow(/đang chờ kiểm/);

    const sample = await tx((t) => postIssue(t, { kind: "qc_sample", purpose: "Mẫu gửi kiểm nghiệm", lines: [{ itemId: ids.item, qty: 50_000, stockLotId: lotId }] }, ids.owner));
    expect(sample.status).toBe("posted");
    const [bal] = await db.select({ qty: schema.stockBalances.qty }).from(schema.stockBalances).where(eq(schema.stockBalances.stockLotId, lotId));
    expect(bal!.qty).toBe(950_000);
  });
});

describe("R-KHO-16: hủy phiếu nhập hủy phiếu IQC chờ qua cancelPendingInspectionsOfReceipt", () => {
  it("phiếu IQC chờ thành cancelled, có lý do, có audit; tồn về 0", async () => {
    const r = await receivePending(2_000_000);
    const [receipt] = await db.select().from(schema.stockReceipts).where(eq(schema.stockReceipts.id, r.receiptId));
    const [before] = await db.select().from(schema.qcInspections).where(eq(schema.qcInspections.stockReceiptId, r.receiptId));
    expect(before!.status).toBe("pending");

    const out = await tx((t) => cancelReceipt(t, r.receiptId, "Nhập nhầm", ids.owner));
    expect(out.reversed).toBe(1);

    const [after] = await db.select().from(schema.qcInspections).where(eq(schema.qcInspections.id, before!.id));
    expect(after!.status).toBe("cancelled");
    expect(after!.decisionNote).toBe(`Hủy phiếu nhập ${receipt!.code}: Nhập nhầm`);
    expect(after!.decidedBy).toBe(ids.owner);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "qc_inspection.cancelled"), eq(schema.auditLog.entityId, before!.id)));
    expect(audits).toHaveLength(1);
    const [bal] = await db.select({ qty: schema.stockBalances.qty }).from(schema.stockBalances).where(eq(schema.stockBalances.stockLotId, r.lines[0]!.stockLotId));
    expect(bal?.qty ?? 0).toBe(0);
  });
});
