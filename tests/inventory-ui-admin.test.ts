// T-14c: hàm cho màn hình Kho (01-kho.md R-KHO-1/2/4/11/21/22/28/31/37, AC-KHO-2/3/25/26/38/41, mẫu lưu R-KHO-17)
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db, Tx } from "@/db/client";
import { seedErpMasterData } from "@/db/seed-erp";
import { vnToday } from "@/modules/numbering/rules";
import {
  cancelTransferDraft,
  createLocation,
  createRetainedSampleFromIssue,
  createWarehouse,
  getIssueDetail,
  reportExpiry,
  reportSlowMoving,
  reportValuation,
  saveItem,
  saveSupplier,
  setLocationActive,
  setWarehouseActive,
  stockOverview,
  updateReceiptLineCost,
  type ItemInput,
} from "@/modules/inventory/admin";
import { createIssueDraft, createTransferDraft, ensureFinishedItem, postIssue, postReceipt } from "@/modules/inventory/ledger";
import { addDays, fefoWarning, lotCostAfterLineEdit, normalizeWarehouseCode, suggestItemCode, toCsv, type FefoCandidate } from "@/modules/inventory/rules";
import { lockProductionCost } from "@/modules/production/costing";

let db: Db;
const today = vnToday();
const ids = { owner: "", wh: {} as Record<string, string>, supplier: "" };

async function tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

const baseItem = (over: Partial<ItemInput>): ItemInput => ({
  code: "X",
  name: "Hàng thử",
  kind: "raw_material",
  baseUom: "ul",
  displayUom: "ml",
  purchaseUom: "l",
  requiresIqc: false,
  ...over,
});

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client, { schema }), { migrationsFolder: "drizzle" });
  await seedErpMasterData(db);
  const [owner] = await db.insert(schema.staffUsers).values({ email: "chu@test.vn", role: "owner", passwordHash: "x" }).returning();
  ids.owner = owner!.id;
  for (const w of await db.select().from(schema.warehouses)) ids.wh[w.code] = w.id;
  const s = await tx((t) => saveSupplier(t, null, { name: "NCC tinh dầu", kind: "material", paymentTermsDays: 15, qualified: true }, ids.owner));
  ids.supplier = s.id;
}, 120_000);

describe("hàm thuần cho màn hình", () => {
  it("gợi ý mã kế tiếp theo nhóm (R-KHO-1)", () => {
    expect(suggestItemCode("raw_material", ["NL-001", "NL-010", "TD-003", "nl-099"])).toBe("NL-011");
    expect(suggestItemCode("packaging", [])).toBe("BB-001");
    expect(suggestItemCode("wip", ["BTP-009"])).toBe("BTP-010");
    expect(suggestItemCode("finished", ["PST"])).toBeNull();
  });

  it("mã kho 2–10 ký tự hoa/số (R-KHO-4)", () => {
    expect(normalizeWarehouseCode("kho2")).toEqual({ ok: true, code: "KHO2" });
    expect(normalizeWarehouseCode("K").ok).toBe(false);
    expect(normalizeWarehouseCode("KHO-2").ok).toBe(false);
  });

  it("cảnh báo chọn tay bỏ qua FEFO (R-KHO-11, ví dụ R-KHO-10)", () => {
    const c = (code: string, expiresOn: string | null, usable = true): FefoCandidate => ({ stockLotId: code, locationId: "L", warehouseId: "W", qty: 5, code, expiresOn, manufacturedOn: null, usable });
    const cands = [c("A", "2028-03-01"), c("B", "2028-09-01"), c("C", "2027-12-31", false), c("D", "2027-10-01")];
    expect(fefoWarning("B", cands, "2027-11-20")).toBe("Không theo FEFO: lô A hết hạn sớm hơn (01/03/2028)");
    expect(fefoWarning("A", cands, "2027-11-20")).toBeNull();
  });

  it("giá lô khi sửa thành tiền dòng nhập (R-KHO-37)", () => {
    expect(lotCostAfterLineEdit(2_000_000, 2_000_000, 2_100_000, true)).toBe(2_100_000);
    expect(lotCostAfterLineEdit(5_000_000, 2_000_000, 2_100_000, false)).toBe(5_100_000);
  });

  it("CSV có BOM, bọc ngoặc kép, chặn công thức Excel", () => {
    expect(toCsv([["Mã", "Tên, có phẩy", -5], ["=SUM(A1)", 'a"b', null]])).toBe('﻿Mã,"Tên, có phẩy",-5\r\n\'=SUM(A1),"a""b",\r\n');
  });
});

describe("hàng hóa, kho, NCC", () => {
  it("AC-KHO-2: base ul + display kg lỗi; sửa ml thì lưu với mã viết hoa", async () => {
    await expect(tx((t) => saveItem(t, null, baseItem({ code: "nl-001", displayUom: "kg" }), ids.owner))).rejects.toThrow("Đơn vị kg không hợp với hàng đo theo thể tích");
    const r = await tx((t) => saveItem(t, null, baseItem({ code: "nl-001" }), ids.owner));
    expect(r.code).toBe("NL-001");
    await expect(tx((t) => saveItem(t, null, baseItem({ code: "NL-001" }), ids.owner))).rejects.toThrow("Mã NL-001 đã có");
    await expect(tx((t) => saveItem(t, null, baseItem({ code: "NL 002" }), ids.owner))).rejects.toThrow("Mã chỉ gồm chữ, số và gạch ngang");
  });

  it("AC-KHO-3 và R-KHO-31: đã có biến động thì không đổi đơn vị cơ sở; còn tồn thì không ngừng dùng", async () => {
    const it1 = await tx((t) => saveItem(t, null, baseItem({ code: "NL-020" }), ids.owner));
    // Đổi base khi chưa có biến động thì được
    await tx((t) => saveItem(t, it1.id, baseItem({ code: "NL-020", baseUom: "mg", displayUom: "g", purchaseUom: "kg" }), ids.owner));
    await tx((t) => saveItem(t, it1.id, baseItem({ code: "NL-020" }), ids.owner));
    await tx((t) => postReceipt(t, { kind: "other", warehouseId: ids.wh.RAW!, receivedOn: today, paymentMode: "none", lines: [{ itemId: it1.id, qty: 1_000, lineCost: 0, qcRequired: false }] }, ids.owner));
    await expect(tx((t) => saveItem(t, it1.id, baseItem({ code: "NL-020", baseUom: "mg", displayUom: "g", purchaseUom: "kg" }), ids.owner))).rejects.toThrow("Hàng đã có lịch sử kho, không đổi được đơn vị cơ sở");
    await expect(tx((t) => saveItem(t, it1.id, baseItem({ code: "NL-020", isActive: false }), ids.owner))).rejects.toThrow("Hàng còn tồn");
  });

  it("R-KHO-4: kho mới có vị trí CHUNG; kho còn hàng không ngừng dùng được; vị trí mặc định không ngừng dùng", async () => {
    const w = await tx((t) => createWarehouse(t, { code: "wip2", name: "Kho WIP nhà máy", kind: "wip" }, ids.owner));
    const locs = await db.select().from(schema.warehouseLocations).where(eq(schema.warehouseLocations.warehouseId, w.id));
    expect(locs.map((l) => [l.code, l.isDefault])).toEqual([["CHUNG", true]]);
    const k1 = await tx((t) => createLocation(t, { warehouseId: w.id, code: "k1-n2" }, ids.owner));
    await expect(tx((t) => createLocation(t, { warehouseId: w.id, code: "K1-N2" }, ids.owner))).rejects.toThrow("Kho đã có vị trí K1-N2");
    await expect(tx((t) => setLocationActive(t, locs[0]!.id, false, ids.owner))).rejects.toThrow("vị trí mặc định");
    await tx((t) => setLocationActive(t, k1.id, false, ids.owner));

    const it2 = await tx((t) => saveItem(t, null, baseItem({ code: "NL-030" }), ids.owner));
    await tx((t) => postReceipt(t, { kind: "other", warehouseId: w.id, receivedOn: today, paymentMode: "none", lines: [{ itemId: it2.id, qty: 2_000_000, lineCost: 0, qcRequired: false }] }, ids.owner));
    await expect(tx((t) => setWarehouseActive(t, w.id, false, ids.owner))).rejects.toThrow("Kho còn hàng, chuyển hết trước khi ngừng dùng");
    const empty = await tx((t) => createWarehouse(t, { code: "TAM", name: "Kho tạm", kind: "raw" }, ids.owner));
    await tx((t) => setWarehouseActive(t, empty.id, false, ids.owner));
    const [row] = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, empty.id));
    expect(row!.isActive).toBe(false);
  });

  it("NCC tự sinh mã NCC-NNN", async () => {
    const [s] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, ids.supplier));
    expect(s!.code).toMatch(/^NCC-\d{3}$/);
    await expect(tx((t) => saveSupplier(t, null, { name: "X", kind: "other", paymentTermsDays: 400, qualified: false }, ids.owner))).rejects.toThrow("Hạn trả");
  });
});

describe("sửa giá nhập, báo cáo", () => {
  let td: string;
  let lineId: string;
  let lotId: string;
  let poId: string;

  beforeAll(async () => {
    td = (await tx((t) => saveItem(t, null, baseItem({ code: "TD-001", kind: "extract", densityMgPerMl: 850 }), ids.owner))).id;
    const r = await tx((t) =>
      postReceipt(t, { kind: "purchase", warehouseId: ids.wh.EXT!, supplierId: ids.supplier, receivedOn: today, lines: [{ itemId: td, qty: 1_000_000, lineCost: 2_000_000, qcRequired: false, expiresOn: addDays(today, 87) }] }, ids.owner),
    );
    lineId = r.lines[0]!.lineId;
    lotId = r.lines[0]!.stockLotId;
    const [p] = await db.insert(schema.products).values({ code: "TST", name: "Sản phẩm thử", slug: "san-pham-thu" }).returning();
    const [po] = await db.insert(schema.productionOrders).values({ code: "LSX-TEST-1", kind: "in_house", status: "in_progress", productId: p!.id, plannedUnits: 100 }).returning();
    poId = po!.id;
    await tx((t) => postIssue(t, { kind: "production", productionOrderId: poId, warehouseId: ids.wh.EXT!, lines: [{ itemId: td, qty: 150_000 }] }, ids.owner));
  }, 60_000);

  it("AC-KHO-38: giá trị tồn 1.700.000đ", async () => {
    const v = await reportValuation(db);
    const ext = v.byWarehouse.find((w) => w.code === "EXT");
    expect(ext?.value).toBe(1_700_000);
    const rows = await stockOverview(db, { warehouseId: ids.wh.EXT });
    expect(rows.find((r) => r.item.id === td)?.value).toBe(1_700_000);
  });

  it("AC-KHO-41: sửa giá dòng 2.000.000 → 2.100.000 cập nhật lô, công nợ, giá lệnh chưa chốt", async () => {
    await expect(tx((t) => updateReceiptLineCost(t, lineId, 2_100_000, "", ids.owner))).rejects.toThrow("Ghi lý do");
    const r = await tx((t) => updateReceiptLineCost(t, lineId, 2_100_000, "Hóa đơn thật", ids.owner));
    expect(r.productionOrdersRecalculated).toEqual(["LSX-TEST-1"]);
    const [lot] = await db.select().from(schema.stockLots).where(eq(schema.stockLots.id, lotId));
    expect(lot!.receivedCost).toBe(2_100_000);
    const [line] = await db.select().from(schema.stockReceiptLines).where(eq(schema.stockReceiptLines.id, lineId));
    const [pay] = await db.select().from(schema.payables).where(and(eq(schema.payables.sourceType, "stock_receipt"), eq(schema.payables.sourceId, line!.receiptId)));
    expect(pay!.amount).toBe(2_100_000);
    const [rc] = await db.select().from(schema.stockReceipts).where(eq(schema.stockReceipts.id, line!.receiptId));
    expect(rc!.totalCost).toBe(2_100_000);
    const [po] = await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, poId));
    expect(po!.materialCost).toBe(315_000);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "stock_receipt_line.cost"));
    expect(audit).toHaveLength(1);

    // Lệnh đã chốt giá → chặn
    await tx((t) => lockProductionCost(t, poId, true, ids.owner));
    await expect(tx((t) => updateReceiptLineCost(t, lineId, 2_200_000, "Sửa lại", ids.owner))).rejects.toThrow("đã chốt giá");
  });

  it("AC-KHO-25: sắp hết hạn (87 ngày), 92 ngày không có, đã hết hạn", async () => {
    const b = (await tx((t) => saveItem(t, null, baseItem({ code: "NL-040" }), ids.owner))).id;
    const r = await tx((t) =>
      postReceipt(
        t,
        {
          kind: "other",
          warehouseId: ids.wh.RAW!,
          receivedOn: today,
          paymentMode: "none",
          lines: [
            { itemId: b, qty: 1_000, lineCost: 0, qcRequired: false, expiresOn: addDays(today, 92) },
            { itemId: b, qty: 1_000, lineCost: 0, qcRequired: false, expiresOn: addDays(today, 10) },
          ],
        },
        ids.owner,
      ),
    );
    // Lô hai giả lập đã hết hạn hôm qua
    await db.update(schema.stockLots).set({ expiresOn: addDays(today, -1) }).where(eq(schema.stockLots.id, r.lines[1]!.stockLotId));
    const rep = await reportExpiry(db, today, 90);
    const exp = rep.expiring.find((x) => x.stockLotId === lotId);
    expect(exp?.days).toBe(87);
    expect(rep.expiring.some((x) => x.stockLotId === r.lines[0]!.stockLotId)).toBe(false);
    expect(rep.expired.map((x) => x.stockLotId)).toContain(r.lines[1]!.stockLotId);
  });

  it("AC-KHO-26: tồn lâu tính từ lần xuất cuối hoặc ngày nhập", async () => {
    const later = addDays(today, 111);
    const slow = await reportSlowMoving(db, later, 90);
    expect(slow.find((x) => x.stockLotId === lotId)?.days).toBe(111);
    expect(await reportSlowMoving(db, addDays(today, 30), 90)).toEqual([]);
  });
});

describe("phiếu xuất, mẫu lưu, điều chuyển", () => {
  it("phiếu xuất chưa ghi sổ có gợi ý FEFO", async () => {
    const b = (await tx((t) => saveItem(t, null, baseItem({ code: "BB-001", kind: "packaging", baseUom: "pcs", displayUom: "cái", purchaseUom: "cái" }), ids.owner))).id;
    await tx((t) => postReceipt(t, { kind: "other", warehouseId: ids.wh.PKG!, receivedOn: today, paymentMode: "none", lines: [{ itemId: b, qty: 10, lineCost: 0, qcRequired: false }] }, ids.owner));
    const d = await tx((t) => createIssueDraft(t, { kind: "sample", lines: [{ itemId: b, qty: 3 }] }, ids.owner));
    const detail = await getIssueDetail(db, d.issueId);
    expect([...detail!.hints.values()][0]).toMatch(/^Gợi ý FEFO: VT-\d{4}-\d{4} × 3$/);
  });

  it("xuất mẫu lưu lô thành phẩm tạo retained_samples, không vượt số đã xuất", async () => {
    const [p] = await db.insert(schema.products).values({ code: "PST", name: "Tonic", slug: "tonic" }).returning();
    const [lot] = await db.insert(schema.lots).values({ lotNo: "PST-271101-01", productId: p!.id, formulaVersion: "PST-v1", manufacturedOn: "2026-11-01", expiresOn: "2028-11-01", unitsProduced: 300 }).returning();
    const itemId = await tx((t) => ensureFinishedItem(t, { id: p!.id, code: "PST", name: "Tonic" }));
    await tx((t) => postReceipt(t, { kind: "opening", warehouseId: ids.wh.FG!, receivedOn: today, paymentMode: "none", lines: [{ itemId, qty: 300, lineCost: 0, productLotId: lot!.id }] }, ids.owner));
    const is = await tx((t) => postIssue(t, { kind: "qc_sample", warehouseId: ids.wh.FG!, purpose: "Mẫu lưu", lines: [{ itemId, qty: 3 }] }, ids.owner));
    expect(is.status).toBe("posted");
    await tx((t) => createRetainedSampleFromIssue(t, is.issueId, { productLotId: lot!.id, units: 2, location: "Tủ mẫu A", keepUntil: "2029-12-01" }, ids.owner));
    await expect(tx((t) => createRetainedSampleFromIssue(t, is.issueId, { productLotId: lot!.id, units: 2, location: "Tủ mẫu A", keepUntil: "2029-12-01" }, ids.owner))).rejects.toThrow("Phiếu chỉ xuất 3 chai");
    const rs = await db.select().from(schema.retainedSamples).where(eq(schema.retainedSamples.stockIssueId, is.issueId));
    expect(rs.map((r) => r.units)).toEqual([2]);
  });

  it("hủy điều chuyển nháp; hủy lần hai báo đã đổi", async () => {
    const [lot] = await db.select().from(schema.stockLots).limit(1);
    const [bal] = await db.select().from(schema.stockBalances).where(eq(schema.stockBalances.stockLotId, lot!.id));
    const d = await tx((t) => createTransferDraft(t, { fromWarehouseId: bal!.warehouseId, toWarehouseId: ids.wh.REJ!, lines: [{ stockLotId: lot!.id, qty: 1 }] }, ids.owner));
    await tx((t) => cancelTransferDraft(t, d.transferId, ids.owner));
    await expect(tx((t) => cancelTransferDraft(t, d.transferId, ids.owner))).rejects.toThrow("vừa được người khác cập nhật");
  });
});
