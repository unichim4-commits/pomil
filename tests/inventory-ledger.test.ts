import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-inv-ledger-"));
process.env.PGLITE_DIR = dir;

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import {
  cashAccounts,
  cashTransactions,
  inventoryItems,
  payables,
  qcInspections,
  staffUsers,
  stockBalances,
  stockIssueLines,
  stockIssues,
  stockLots,
  stockMovements,
  suppliers,
  warehouseLocations,
  warehouses,
} from "@/db/schema";
import { applyDebtPayment } from "@/modules/finance/ledger";
import { vnToday } from "@/modules/numbering/rules";
import { cancelStockCount, createStockCount, postStockCount, saveStockCountQty } from "@/modules/inventory/counts";
import {
  cancelReceipt,
  createReceiptDraft,
  getItemStock,
  postIssue,
  postIssueDraft,
  postMovements,
  postReceipt,
  postReceiptDraft,
  postTransfer,
  rejectIssue,
  reverseMovements,
  setStockLotQcStatus,
  transferLotBalance,
} from "@/modules/inventory/ledger";
import { addDays } from "@/modules/inventory/rules";

const today = vnToday();
const ids = {
  owner: "",
  collab: "",
  supplier: "",
  bb1: "",
  bb2: "",
  bb3: "",
  td1: "",
  wh: {} as Record<string, string>,
  loc: {} as Record<string, string>,
};

async function tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

async function balance(stockLotId: string, locationId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ qty: stockBalances.qty }).from(stockBalances).where(and(eq(stockBalances.stockLotId, stockLotId), eq(stockBalances.locationId, locationId)));
  return row?.qty ?? 0;
}

async function item(code: string, values: Partial<typeof inventoryItems.$inferInsert> & { baseUom: "mg" | "ul" | "pcs"; kind: "raw_material" | "extract" | "packaging" }) {
  const db = await getDb();
  const [row] = await db
    .insert(inventoryItems)
    .values({ code, name: code, displayUom: values.baseUom === "ul" ? "ml" : values.baseUom === "mg" ? "g" : "cái", purchaseUom: values.baseUom === "ul" ? "l" : "cái", ...values })
    .returning({ id: inventoryItems.id });
  return row!.id;
}

// Nhập nhanh một lô đã duyệt
async function receiveReleased(itemId: string, warehouseCode: string, qty: number, opts: { expiresOn?: string | null; lineCost?: number } = {}) {
  return tx((t) =>
    postReceipt(
      t,
      {
        kind: "other",
        warehouseId: ids.wh[warehouseCode]!,
        receivedOn: today,
        paymentMode: "none",
        lines: [{ itemId, qty, lineCost: opts.lineCost ?? 0, qcRequired: false, expiresOn: opts.expiresOn ?? null }],
      },
      ids.owner,
    ),
  );
}

beforeAll(async () => {
  const db = await getDb();
  const [owner] = await db.insert(staffUsers).values({ email: "owner@test.vn", role: "owner", passwordHash: "x" }).returning({ id: staffUsers.id });
  const [collab] = await db.insert(staffUsers).values({ email: "ctv@test.vn", role: "collaborator", passwordHash: "x" }).returning({ id: staffUsers.id });
  ids.owner = owner!.id;
  ids.collab = collab!.id;
  const [sup] = await db.insert(suppliers).values({ code: "NCC-T03", name: "Bao bì thử", kind: "packaging", paymentTermsDays: 15 }).returning({ id: suppliers.id });
  ids.supplier = sup!.id;
  for (const w of await db.select().from(warehouses)) ids.wh[w.code] = w.id;
  for (const l of await db.select().from(warehouseLocations).where(eq(warehouseLocations.isDefault, true))) {
    const code = Object.entries(ids.wh).find(([, id]) => id === l.warehouseId)![0];
    ids.loc[code] = l.id;
  }
  ids.bb1 = await item("BB-001", { kind: "packaging", baseUom: "pcs", minStock: 100 });
  ids.bb2 = await item("BB-002", { kind: "packaging", baseUom: "pcs", requiresIqc: false });
  ids.bb3 = await item("BB-003", { kind: "packaging", baseUom: "pcs" });
  ids.td1 = await item("TD-001", { kind: "extract", baseUom: "ul", densityMgPerMl: 850 });
  await db.update(cashAccounts).set({ openingBalance: 10_000_000 }).where(eq(cashAccounts.code, "TM"));
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("phiếu nhập (R-KHO-13, R-KHO-15)", () => {
  it("AC-KHO-5, AC-KHO-6: nhập mua cần IQC, ghi công nợ, ghi sổ lần hai bị chặn", async () => {
    const draft = await tx((t) =>
      createReceiptDraft(
        t,
        {
          kind: "purchase",
          warehouseId: ids.wh.PKG!,
          supplierId: ids.supplier,
          receivedOn: "2026-11-11",
          lines: [
            { itemId: ids.bb1, qty: 300, lineCost: 1_800_000 },
            { itemId: ids.bb3, qty: 300, lineCost: 450_000 },
          ],
        },
        ids.collab,
      ),
    );
    const posted = await tx((t) => postReceiptDraft(t, draft.receiptId, ids.collab));
    expect(posted.lines).toHaveLength(2);

    const db = await getDb();
    const lotRows = await db.select().from(stockLots).where(inArray(stockLots.id, posted.lines.map((l) => l.stockLotId)));
    expect(lotRows.map((l) => l.qcStatus)).toEqual(["pending", "pending"]);
    expect(lotRows.every((l) => /^VT-\d{4}-\d{4}$/.test(l.code))).toBe(true);

    const stock = await getItemStock(db, [ids.bb1, ids.bb3]);
    expect(stock.get(ids.bb1)).toMatchObject({ quarantine: 300, available: 0, onHand: 300 });

    const insp = await db.select().from(qcInspections).where(eq(qcInspections.stockReceiptId, draft.receiptId));
    expect(insp).toHaveLength(2);
    expect(new Set(insp.map((i) => i.stockReceiptLineId))).toEqual(new Set(posted.lines.map((l) => l.lineId)));
    expect(insp.every((i) => i.status === "pending")).toBe(true);

    const pay = await db.select().from(payables).where(eq(payables.sourceId, draft.receiptId));
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ amount: 2_250_000, dueOn: "2026-11-26", issuedOn: "2026-11-11" });

    const moves = await db.select().from(stockMovements).where(eq(stockMovements.docId, draft.receiptId));
    expect(moves.map((m) => [m.type, m.balanceAfter])).toEqual([
      ["purchase_receipt", 300],
      ["purchase_receipt", 300],
    ]);

    await expect(tx((t) => postReceiptDraft(t, draft.receiptId, ids.collab))).rejects.toThrow("vừa được người khác cập nhật");
    expect(await db.select().from(stockMovements).where(eq(stockMovements.docId, draft.receiptId))).toHaveLength(2);
    expect(await db.select().from(payables).where(eq(payables.sourceId, draft.receiptId))).toHaveLength(1);
  });

  it("AC-KHO-7: trả tiền ngay → phiếu chi, không có công nợ", async () => {
    const db = await getDb();
    const [tm] = await db.select().from(cashAccounts).where(eq(cashAccounts.code, "TM"));
    const r = await tx((t) =>
      postReceipt(
        t,
        { kind: "purchase", warehouseId: ids.wh.PKG!, supplierId: ids.supplier, receivedOn: today, paymentMode: "paid_now", payAccountId: tm!.id, lines: [{ itemId: ids.bb2, qty: 100, lineCost: 2_000_000 }] },
        ids.owner,
      ),
    );
    const cash = await db.select().from(cashTransactions).where(eq(cashTransactions.idempotencyKey, `receipt-paid:${r.receiptId}`));
    expect(cash).toHaveLength(1);
    expect(cash[0]!.amount).toBe(2_000_000);
    expect(await db.select().from(payables).where(eq(payables.sourceId, r.receiptId))).toHaveLength(0);
  });

  it("AC-KHO-9: hàng không cần IQC → lô released, không có phiếu IQC", async () => {
    const r = await tx((t) => postReceipt(t, { kind: "purchase", warehouseId: ids.wh.PKG!, supplierId: ids.supplier, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.bb2, qty: 50, lineCost: 0 }] }, ids.owner));
    const db = await getDb();
    const [lot] = await db.select().from(stockLots).where(eq(stockLots.id, r.lines[0]!.stockLotId));
    expect(lot!.qcStatus).toBe("released");
    expect(await db.select().from(qcInspections).where(eq(qcInspections.stockReceiptId, r.receiptId))).toHaveLength(0);
  });

  it("AC-KHO-8: điền HSD theo hạn mặc định; lô hết hạn khi nhập bị chặn", async () => {
    const nl = await item("NL-010", { kind: "raw_material", baseUom: "mg", shelfLifeDays: 3 });
    const r = await tx((t) =>
      postReceipt(t, { kind: "other", warehouseId: ids.wh.RAW!, receivedOn: today, paymentMode: "none", lines: [{ itemId: nl, qty: 1000, lineCost: 0, manufacturedOn: addDays(today, -1), qcRequired: false }] }, ids.owner),
    );
    const db = await getDb();
    const [lot] = await db.select().from(stockLots).where(eq(stockLots.id, r.lines[0]!.stockLotId));
    expect(lot!.expiresOn).toBe(addDays(today, 2));
    await expect(
      tx((t) => postReceipt(t, { kind: "other", warehouseId: ids.wh.RAW!, receivedOn: today, paymentMode: "none", lines: [{ itemId: nl, qty: 1, lineCost: 0, expiresOn: addDays(today, -1) }] }, ids.owner)),
    ).rejects.toThrow("Hàng đã hết hạn khi nhập");
  });
});

describe("biến động (R-KHO-5, R-KHO-6, R-KHO-7)", () => {
  it("AC-KHO-10: thiếu hàng báo rõ lô, vị trí, số còn; không ghi dòng nào", async () => {
    const r = await receiveReleased(ids.td1, "EXT", 1_000_000, { expiresOn: addDays(today, 400) });
    const lotId = r.lines[0]!.stockLotId;
    const db = await getDb();
    const [lot] = await db.select().from(stockLots).where(eq(stockLots.id, lotId));
    const before = (await db.select().from(stockMovements)).length;
    const ref = { docType: "issue" as const, docId: "00000000-0000-4000-8000-000000000001", docCode: "TEST", actorId: ids.owner };
    await expect(
      tx((t) =>
        postMovements(t, ref, [
          { type: "production_issue", stockLotId: lotId, locationId: ids.loc.EXT!, qty: -100_000 },
          { type: "production_issue", stockLotId: lotId, locationId: ids.loc.EXT!, qty: -1_200_000 },
        ]),
      ),
    ).rejects.toThrow(`Lô ${lot!.code} ở EXT/CHUNG chỉ còn 900 ml, không xuất được 1.200 ml.`);
    expect((await db.select().from(stockMovements)).length).toBe(before);
    expect(await balance(lotId, ids.loc.EXT!)).toBe(1_000_000);
  });

  it("AC-KHO-11 + R-KHO-7: sai dấu, sai kho, lô chưa khả dụng; đảo dòng trả lại số dư", async () => {
    const pending = await tx((t) => postReceipt(t, { kind: "other", warehouseId: ids.wh.EXT!, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.td1, qty: 10_000, lineCost: 0 }] }, ids.owner));
    const lotId = pending.lines[0]!.stockLotId;
    const ref = { docType: "issue" as const, docId: "00000000-0000-4000-8000-000000000002", docCode: "TEST", actorId: ids.owner };
    await expect(tx((t) => postMovements(t, ref, [{ type: "research_issue", stockLotId: lotId, locationId: ids.loc.EXT!, qty: 2 }]))).rejects.toThrow("Sai dấu");
    await expect(tx((t) => postMovements(t, ref, [{ type: "extraction_issue", stockLotId: lotId, locationId: ids.loc.EXT!, qty: -1 }]))).rejects.toThrow("Không xuất chiết từ kho tinh dầu");
    await expect(tx((t) => postMovements(t, ref, [{ type: "research_issue", stockLotId: lotId, locationId: ids.loc.EXT!, qty: -1 }]))).rejects.toThrow("chờ kiểm");
    const ok = await tx((t) => postMovements(t, ref, [{ type: "qc_sample_issue", stockLotId: lotId, locationId: ids.loc.EXT!, qty: -1_000 }]));
    expect(ok.movementIds).toHaveLength(1);
    expect(await balance(lotId, ids.loc.EXT!)).toBe(9_000);
    const rev = await tx((t) => reverseMovements(t, ref, ok.movementIds));
    const db = await getDb();
    const [row] = await db.select().from(stockMovements).where(eq(stockMovements.id, rev.movementIds[0]!));
    expect(row).toMatchObject({ type: "reversal", qty: 1_000, balanceAfter: 10_000, reversalOf: ok.movementIds[0] });
    // Đảo lần hai: bỏ qua
    expect((await tx((t) => reverseMovements(t, ref, ok.movementIds))).movementIds).toHaveLength(0);
  });
});

describe("phiếu xuất (R-KHO-10, R-KHO-11, R-KHO-17)", () => {
  let lotA = "";
  let lotB = "";
  let lotC = "";
  beforeAll(async () => {
    lotA = (await receiveReleased(ids.bb2, "PKG", 5, { expiresOn: addDays(today, 100) })).lines[0]!.stockLotId;
    lotB = (await receiveReleased(ids.bb2, "PKG", 20, { expiresOn: addDays(today, 300) })).lines[0]!.stockLotId;
    lotC = (await receiveReleased(ids.bb2, "PKG", 5, { expiresOn: addDays(today, 50) })).lines[0]!.stockLotId;
    await tx((t) => setStockLotQcStatus(t, lotC, "on_hold", "Nghi lỗi", ids.owner));
  });

  it("AC-KHO-17: FEFO tách 2 dòng, bỏ qua lô đang giữ", async () => {
    // Lô cũ hơn của BB-002 (không HSD) nằm cuối FEFO
    const r = await tx((t) => postIssue(t, { kind: "sample", warehouseId: ids.wh.PKG, purpose: "Mẫu KOC", lines: [{ itemId: ids.bb2, qty: 12 }] }, ids.owner));
    expect(r.status).toBe("posted");
    const db = await getDb();
    const lines = await db.select().from(stockIssueLines).where(eq(stockIssueLines.issueId, r.issueId));
    expect(lines.map((l) => [l.stockLotId, l.qty]).sort()).toEqual(
      [
        [lotA, 5],
        [lotB, 7],
      ].sort(),
    );
    expect(r.movementIds).toHaveLength(2);
  });

  it("AC-KHO-13: chọn tay lô B khi còn lô hạn sớm hơn → ghi chú; lô đang giữ → lỗi", async () => {
    const lotD = (await receiveReleased(ids.bb2, "PKG", 3, { expiresOn: addDays(today, 30) })).lines[0]!.stockLotId;
    const r = await tx((t) => postIssue(t, { kind: "sample", lines: [{ itemId: ids.bb2, qty: 1, stockLotId: lotB }] }, ids.owner));
    const db = await getDb();
    const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.id, r.movementIds[0]!));
    expect(mv!.note).toContain("Chọn tay, bỏ qua FEFO");
    await expect(tx((t) => postIssue(t, { kind: "sample", lines: [{ itemId: ids.bb2, qty: 1, stockLotId: lotC }] }, ids.owner))).rejects.toThrow("đang bị giữ");
    expect(await balance(lotD, ids.loc.PKG!)).toBe(3);
  });

  it("AC-KHO-15, AC-KHO-16: cộng tác viên gửi duyệt; chủ duyệt; từ chối; duyệt khi thiếu thì giữ chờ duyệt", async () => {
    const before = await balance(lotB, ids.loc.PKG!);
    const r = await tx((t) => postIssue(t, { kind: "scrap", lines: [{ itemId: ids.bb2, qty: 3, stockLotId: lotB }] }, ids.collab));
    expect(r.status).toBe("pending_approval");
    expect(await balance(lotB, ids.loc.PKG!)).toBe(before);
    await tx((t) => postIssueDraft(t, r.issueId, ids.owner));
    const db = await getDb();
    const [issue] = await db.select().from(stockIssues).where(eq(stockIssues.id, r.issueId));
    expect(issue).toMatchObject({ status: "posted", approvedBy: ids.owner });
    expect(await balance(lotB, ids.loc.PKG!)).toBe(before - 3);

    const other = await tx((t) => postIssue(t, { kind: "scrap", lines: [{ itemId: ids.bb2, qty: 1, stockLotId: lotB }] }, ids.collab));
    await tx((t) => rejectIssue(t, other.issueId, "Không cần", ids.owner));
    expect((await db.select().from(stockIssues).where(eq(stockIssues.id, other.issueId)))[0]!.status).toBe("cancelled");
    expect(await balance(lotB, ids.loc.PKG!)).toBe(before - 3);

    const big = await tx((t) => postIssue(t, { kind: "scrap", lines: [{ itemId: ids.bb2, qty: before, stockLotId: lotB }] }, ids.collab));
    await expect(tx((t) => postIssueDraft(t, big.issueId, ids.owner))).rejects.toThrow("chỉ còn");
    expect((await db.select().from(stockIssues).where(eq(stockIssues.id, big.issueId)))[0]!.status).toBe("pending_approval");
  });
});

describe("điều chuyển (R-KHO-18, R-KHO-35)", () => {
  it("AC-KHO-18, AC-KHO-19: lô đạt ra khỏi REJ được, lô không đạt thì không; hàng không đúng loại kho bị chặn", async () => {
    const e = (await receiveReleased(ids.td1, "REJ", 50_000)).lines[0]!.stockLotId;
    const d = (await tx((t) => postReceipt(t, { kind: "other", warehouseId: ids.wh.REJ!, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.td1, qty: 200_000, lineCost: 0 }] }, ids.owner))).lines[0]!.stockLotId;
    await tx((t) => setStockLotQcStatus(t, d, "rejected", "IQC không đạt", ids.owner));

    const ok = await tx((t) => postTransfer(t, { fromWarehouseId: ids.wh.REJ!, toWarehouseId: ids.wh.RAW!, lines: [{ stockLotId: e, qty: 50_000 }] }, ids.owner));
    const db = await getDb();
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.docId, ok.transferId));
    expect(moves.map((m) => [m.type, m.qty, m.stockLotId]).sort()).toEqual(
      [
        ["transfer_in", 50_000, e],
        ["transfer_out", -50_000, e],
      ].sort(),
    );
    await expect(tx((t) => postTransfer(t, { fromWarehouseId: ids.wh.REJ!, toWarehouseId: ids.wh.RAW!, lines: [{ stockLotId: d, qty: 1 }] }, ids.owner))).rejects.toThrow(
      "Lô không đạt, không đưa ra khỏi kho cách ly",
    );
    await expect(tx((t) => postTransfer(t, { fromWarehouseId: ids.wh.RAW!, toWarehouseId: ids.wh.FG!, lines: [{ stockLotId: e, qty: 1 }] }, ids.owner))).rejects.toThrow(
      "Kho thành phẩm chỉ chứa hàng thành phẩm",
    );
  });

  it("AC-KHO-35: chuyển cả lô sang REJ gom 2 vị trí; gọi lại không tạo phiếu", async () => {
    const db = await getDb();
    const [k1] = await db.insert(warehouseLocations).values({ warehouseId: ids.wh.RAW!, code: "K1", name: "Kệ 1" }).returning({ id: warehouseLocations.id });
    const lot = (await receiveReleased(ids.td1, "RAW", 100)).lines[0]!.stockLotId;
    await tx((t) => postTransfer(t, { fromWarehouseId: ids.wh.RAW!, toWarehouseId: ids.wh.RAW!, lines: [{ stockLotId: lot, qty: 50, fromLocationId: ids.loc.RAW, toLocationId: k1!.id }] }, ids.owner));
    await tx((t) => postMovements(t, { docType: "receipt", docId: "00000000-0000-4000-8000-000000000003", docCode: "TEST", actorId: ids.owner }, [{ type: "other_receipt", stockLotId: lot, locationId: ids.loc.RAW!, qty: 50 }]));
    // RAW/CHUNG 100, RAW/K1 50
    const r = await tx((t) => transferLotBalance(t, { stockLotId: lot, toWarehouseKind: "rejected", reason: "IQC không đạt", source: { type: "inspection", id: "00000000-0000-4000-8000-000000000004" } }, ids.owner));
    expect(r.qty).toBe(150);
    expect(r.transferId).not.toBeNull();
    expect(await db.select().from(stockMovements).where(eq(stockMovements.docId, r.transferId!))).toHaveLength(4);
    expect(await balance(lot, ids.loc.REJ!)).toBe(150);
    expect(await tx((t) => transferLotBalance(t, { stockLotId: lot, toWarehouseKind: "rejected", reason: "lại" }, ids.owner))).toEqual({ transferId: null, qty: 0 });
  });
});

describe("kiểm kê (R-KHO-19)", () => {
  it("AC-KHO-20, AC-KHO-21: chênh lệch cần chủ; số dư đổi sau khi chụp thì cảnh báo và tính theo số hiện tại", async () => {
    const db = await getDb();
    const [wh] = await db.insert(warehouses).values({ code: "KT", name: "Kho thử kiểm kê", kind: "packaging" }).returning({ id: warehouses.id });
    const [loc] = await db.insert(warehouseLocations).values({ warehouseId: wh!.id, code: "CHUNG", isDefault: true }).returning({ id: warehouseLocations.id });
    const lot = (await tx((t) => postReceipt(t, { kind: "other", warehouseId: wh!.id, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.bb2, qty: 300, lineCost: 0, qcRequired: false }] }, ids.owner))).lines[0]!.stockLotId;

    // Không chênh lệch: cộng tác viên ghi sổ được
    const same = await tx((t) => createStockCount(t, { warehouseId: wh!.id }, ids.collab));
    const sl = await db.query.stockCountLines.findMany({ where: (l, { eq }) => eq(l.countId, same.countId) });
    await tx((t) => saveStockCountQty(t, same.countId, [{ lineId: sl[0]!.id, countedQty: 300 }]));
    const okSame = await tx((t) => postStockCount(t, same.countId, ids.collab));
    expect(okSame).toMatchObject({ diffs: 0, movementIds: [] });

    const c = await tx((t) => createStockCount(t, { warehouseId: wh!.id }, ids.collab));
    expect(c.lines).toBe(1);
    await tx((t) => postIssue(t, { kind: "sample", warehouseId: wh!.id, lines: [{ itemId: ids.bb2, qty: 2, stockLotId: lot }] }, ids.owner));
    const lines = await db.query.stockCountLines.findMany({ where: (l, { eq }) => eq(l.countId, c.countId) });
    await tx((t) => saveStockCountQty(t, c.countId, [{ lineId: lines[0]!.id, countedQty: 297, reason: "Vỡ 1" }]));
    await expect(tx((t) => postStockCount(t, c.countId, ids.collab))).rejects.toThrow("cần người có quyền duyệt");
    const r = await tx((t) => postStockCount(t, c.countId, ids.owner));
    expect(r.warnings).toEqual(["Số dư đã đổi từ lúc tạo phiếu (300 → 298)"]);
    expect(r.diffs).toBe(1);
    const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.id, r.movementIds[0]!));
    expect(mv).toMatchObject({ type: "count_adjust", qty: -1, balanceAfter: 297 });
    expect(await balance(lot, loc!.id)).toBe(297);

    const extra = await tx((t) => createStockCount(t, { warehouseId: wh!.id }, ids.collab));
    await tx((t) => cancelStockCount(t, extra.countId, ids.collab));
    await expect(tx((t) => postStockCount(t, extra.countId, ids.owner))).rejects.toThrow("vừa được người khác cập nhật");
  });
});

describe("hủy phiếu nhập (R-KHO-16)", () => {
  it("AC-KHO-22: lô đã xuất thì không hủy được; phiếu chưa xuất hủy được, đảo đủ, IQC và công nợ bị hủy", async () => {
    const used = await tx((t) =>
      postReceipt(t, { kind: "purchase", warehouseId: ids.wh.PKG!, supplierId: ids.supplier, receivedOn: today, lines: [{ itemId: ids.bb2, qty: 300, lineCost: 900_000 }] }, ids.owner),
    );
    await tx((t) => postIssue(t, { kind: "sample", lines: [{ itemId: ids.bb2, qty: 10, stockLotId: used.lines[0]!.stockLotId }] }, ids.owner));
    const db = await getDb();
    const [usedLot] = await db.select().from(stockLots).where(eq(stockLots.id, used.lines[0]!.stockLotId));
    await expect(tx((t) => cancelReceipt(t, used.receiptId, "Nhập nhầm", ids.owner))).rejects.toThrow(`Lô ${usedLot!.code} đã có xuất kho, lập phiếu trả NCC thay vì hủy`);

    const fresh = await tx((t) =>
      postReceipt(t, { kind: "purchase", warehouseId: ids.wh.PKG!, supplierId: ids.supplier, receivedOn: today, lines: [{ itemId: ids.bb1, qty: 40, lineCost: 240_000 }] }, ids.owner),
    );
    const r = await tx((t) => cancelReceipt(t, fresh.receiptId, "Nhập nhầm", ids.owner));
    expect(r.reversed).toBe(1);
    expect(await balance(fresh.lines[0]!.stockLotId, ids.loc.PKG!)).toBe(0);
    const insp = await db.select().from(qcInspections).where(eq(qcInspections.stockReceiptId, fresh.receiptId));
    expect(insp.map((i) => i.status)).toEqual(["cancelled"]);
    const [pay] = await db.select().from(payables).where(eq(payables.sourceId, fresh.receiptId));
    expect(pay!.status).toBe("cancelled");
  });

  it("AC-KHO-23: công nợ đã trả một phần → không hủy", async () => {
    const r = await tx((t) =>
      postReceipt(t, { kind: "purchase", warehouseId: ids.wh.PKG!, supplierId: ids.supplier, receivedOn: today, lines: [{ itemId: ids.bb1, qty: 10, lineCost: 100_000 }] }, ids.owner),
    );
    const db = await getDb();
    const [pay] = await db.select().from(payables).where(eq(payables.sourceId, r.receiptId));
    const [tm] = await db.select().from(cashAccounts).where(eq(cashAccounts.code, "TM"));
    await tx((t) => applyDebtPayment(t, { kind: "payable", debtId: pay!.id, amount: 30_000, accountId: tm!.id, paidOn: today }, ids.owner));
    await expect(tx((t) => cancelReceipt(t, r.receiptId, "Nhầm", ids.owner))).rejects.toThrow("Phiếu đã có thanh toán");
  });
});

describe("chạy đua và trạng thái lô", () => {
  it("hai lần xuất hết tồn cùng lúc: chỉ một lần thành công, số dư không âm", async () => {
    const lot = (await receiveReleased(ids.bb2, "PKG", 7)).lines[0]!.stockLotId;
    const run = () => tx((t) => postIssue(t, { kind: "scrap", lines: [{ itemId: ids.bb2, qty: 7, stockLotId: lot }] }, ids.owner));
    const results = await Promise.allSettled([run(), run()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await balance(lot, ids.loc.PKG!)).toBe(0);
  });

  it("AC-KHO-36: sai chiều trạng thái, lô thành phẩm bị chặn", async () => {
    const lot = (await tx((t) => postReceipt(t, { kind: "other", warehouseId: ids.wh.PKG!, receivedOn: today, paymentMode: "none", lines: [{ itemId: ids.bb3, qty: 1, lineCost: 0 }] }, ids.owner))).lines[0]!.stockLotId;
    await tx((t) => setStockLotQcStatus(t, lot, "rejected", "Hỏng", ids.owner));
    await expect(tx((t) => setStockLotQcStatus(t, lot, "released", null, ids.owner))).rejects.toThrow("Không chuyển lô từ rejected sang released");
    await expect(tx((t) => setStockLotQcStatus(t, lot, "on_hold", null, ids.owner))).rejects.toThrow();
  });
});

describe("bất biến sau mọi luồng (INV-1, INV-2)", () => {
  it("số dư không âm, bằng tổng biến động, balance_after dòng cuối bằng số dư", async () => {
    const db = await getDb();
    const neg = await db.select().from(stockBalances).where(sql`${stockBalances.qty} < 0`);
    expect(neg).toHaveLength(0);
    const mismatch = await db.execute(sql`
      with s as (select location_id, stock_lot_id, sum(qty) as total from stock_movements group by 1, 2),
      last as (select distinct on (location_id, stock_lot_id) location_id, stock_lot_id, balance_after from stock_movements order by location_id, stock_lot_id, occurred_at desc, created_at desc)
      select b.location_id, b.qty, s.total, last.balance_after from stock_balances b
      full join s on s.location_id = b.location_id and s.stock_lot_id = b.stock_lot_id
      left join last on last.location_id = coalesce(b.location_id, s.location_id) and last.stock_lot_id = coalesce(b.stock_lot_id, s.stock_lot_id)
      where coalesce(b.qty, 0) <> coalesce(s.total, 0) or (last.balance_after is not null and last.balance_after <> coalesce(b.qty, 0))`);
    const rows = (mismatch as unknown as { rows: unknown[] }).rows ?? (mismatch as unknown as unknown[]);
    expect(rows, JSON.stringify(rows)).toHaveLength(0);
    const counted = await db.select({ n: sql<number>`count(*)::int` }).from(stockMovements);
    expect(Number(counted[0]!.n)).toBeGreaterThan(20);
  });
});
