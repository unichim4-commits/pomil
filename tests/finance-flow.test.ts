import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { seedErpMasterData } from "@/db/seed-erp";
import { accountBalance, recordCashTransaction } from "@/modules/finance/ledger";
import { approveRequest, cancelManualCash, createAccount, createManualCash, createTransfer, listCashTransactions, reconcileAccount, rejectRequest, settleCod } from "@/modules/finance/cash";
import { cancelPayment, createManualPayable, createManualReceivable, getDebt, groupByParty, listReceivables, payDebt } from "@/modules/finance/debts";
import { advanceBudgetStatus, createBudget, getBudgetReport, setBudgetLine } from "@/modules/finance/budgets";
import { allocateOverhead, deleteAllocation, listProductionCosts, priceHistory, setCostLock } from "@/modules/finance/cost";
import { cashFlowActual, channelReport, profitAndLoss, profitByProduct, stockValue, totalCash, workingCapitalReport } from "@/modules/finance/reports";
import { computeFinanceAlerts } from "@/modules/finance/alerts";
import { costOfQty } from "@/modules/inventory/rules";

// T-18: luồng chính phân hệ Tài chính trên PGlite (05-tai-chinh.md AC-TC-1…AC-TC-27)

const ACTOR = "00000000-0000-4000-8000-000000000000";
const TODAY = "2028-03-31";
let db: Db;
const acc: Record<string, string> = {};
const cat: Record<string, string> = {};
let supplierId = "";
let productId = "";
let product2Id = "";
let lotId = "";
let fgItemId = "";
let fgStockLotId = "";
let wh: { warehouseId: string; locationId: string };

function one<T>(rows: T[]): T {
  if (rows[0] === undefined) throw new Error("Không có dòng");
  return rows[0];
}

async function makeOrder(input: { code: string; channel?: string; subtotal: number; shipping?: number; discount?: number; platformFee?: number; deliveredAt: string | null; items: { productId: string; name: string; qty: number; lineTotal: number; lotId: string | null }[] }) {
  const shipping = input.shipping ?? 0;
  const discount = input.discount ?? 0;
  const o = one(
    await db
      .insert(schema.orders)
      .values({
        code: input.code,
        channel: input.channel ?? "WEB",
        paymentMethod: "cod",
        recipientName: "Khách thử",
        phoneE164: "84901234567",
        province: "Hà Nội",
        ward: "Phường 1",
        addressLine: "1 Phố",
        subtotal: input.subtotal,
        shippingFee: shipping,
        discountTotal: discount,
        platformFee: input.platformFee ?? 0,
        total: input.subtotal - discount + shipping,
        accessToken: crypto.randomUUID(),
        status: input.deliveredAt ? "delivered" : "shipping",
        deliveredAt: input.deliveredAt ? new Date(input.deliveredAt) : null,
      })
      .returning(),
  );
  const items = await db
    .insert(schema.orderItems)
    .values(input.items.map((i) => ({ orderId: o.id, productId: i.productId, productName: i.name, unitPrice: Math.round(i.lineTotal / i.qty), quantity: i.qty, lineTotal: i.lineTotal, lotId: i.lotId })))
    .returning();
  return { order: o, items };
}

async function move(type: (typeof schema.stockMoveType.enumValues)[number], qty: number, at: string) {
  await db.insert(schema.stockMovements).values({
    type,
    docType: "issue",
    docId: crypto.randomUUID(),
    docCode: "PX-2801-0001",
    itemId: fgItemId,
    stockLotId: fgStockLotId,
    warehouseId: wh.warehouseId,
    locationId: wh.locationId,
    qty,
    balanceAfter: 0,
    occurredAt: new Date(at),
  });
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "drizzle" });
  const p = one(await db.insert(schema.products).values({ code: "PST", name: "Dầu gội vỏ bưởi", slug: "dau-goi" }).returning());
  const p2 = one(await db.insert(schema.products).values({ code: "PSTM", name: "Dầu gội mini", slug: "dau-goi-mini" }).returning());
  productId = p.id;
  product2Id = p2.id;
  await seedErpMasterData(db);
  for (const a of await db.select().from(schema.cashAccounts)) acc[a.code] = a.id;
  for (const c of await db.select().from(schema.financeCategories)) cat[c.code] = c.id;
  await db.update(schema.cashAccounts).set({ openingBalance: 5_000_000, openingOn: "2028-01-01" }).where(eq(schema.cashAccounts.code, "TM"));
  await db.update(schema.cashAccounts).set({ openingBalance: 0, openingOn: "2028-01-01" });
  await db.update(schema.cashAccounts).set({ openingBalance: 5_000_000 }).where(eq(schema.cashAccounts.code, "TM"));
  supplierId = one(await db.insert(schema.suppliers).values({ code: "NCC-001", name: "Nhà in nhãn", paymentTermsDays: 30 }).returning()).id;
  wh = one(
    await db
      .select({ warehouseId: schema.warehouses.id, locationId: schema.warehouseLocations.id })
      .from(schema.warehouses)
      .innerJoin(schema.warehouseLocations, eq(schema.warehouseLocations.warehouseId, schema.warehouses.id))
      .where(eq(schema.warehouses.kind, "finished"))
      .limit(1),
  );
  fgItemId = one(await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.productId, p.id))).id;
  const lot = one(await db.insert(schema.lots).values({ lotNo: "PST-271120-01", productId: p.id, formulaVersion: "PST-v1", manufacturedOn: "2027-11-20", expiresOn: "2029-11-20", unitsProduced: 296, releaseStatus: "released" }).returning());
  lotId = lot.id;
  fgStockLotId = one(
    await db
      .insert(schema.stockLots)
      .values({ code: lot.lotNo, itemId: fgItemId, productLotId: lot.id, receivedQty: 296, receivedCost: 16_800_000, qcStatus: null, sourceDocType: "receipt", sourceDocId: crypto.randomUUID() })
      .returning(),
  ).id;
}, 120_000);

describe("sổ quỹ (AC-TC-1…AC-TC-7)", { timeout: 60_000 }, () => {
  it("AC-TC-1: thu 483.000, chi 200.000, chuyển 3.000.000 → TM 2.283.000, NH +3.000.000; mã PT/PC/CQ", async () => {
    const thu = await createManualCash(db, { direction: "in", accountId: acc.TM!, categoryId: cat["THU-KHAC"]!, amount: 483_000, occurredOn: "2028-02-03" }, ACTOR, TODAY);
    const chi = await createManualCash(db, { direction: "out", accountId: acc.TM!, categoryId: cat["CHI-VAN-HANH"]!, amount: 200_000, occurredOn: "2028-02-03" }, ACTOR, TODAY);
    const cq = await createTransfer(db, { fromId: acc.TM!, toId: acc.NH!, amount: 3_000_000, occurredOn: "2028-02-04" }, ACTOR, TODAY);
    expect(thu.code).toBe("PT-2802-0001");
    expect(chi.code).toBe("PC-2802-0001");
    expect(cq.code).toBe("CQ-2802-001");
    expect(await accountBalance(db, acc.TM!)).toBe(2_283_000);
    expect(await accountBalance(db, acc.NH!)).toBe(3_000_000);
    await expect(createTransfer(db, { fromId: acc.TM!, toId: acc.TM!, amount: 1, occurredOn: "2028-02-04" }, ACTOR, TODAY)).rejects.toThrow("Hai tài khoản phải khác nhau");
    await expect(createManualCash(db, { direction: "in", accountId: acc.TM!, categoryId: cat["THU-KHAC"]!, amount: 1, occurredOn: "2028-04-01" }, ACTOR, TODAY)).rejects.toThrow("Ngày phiếu không được sau hôm nay");
    await expect(createManualCash(db, { direction: "in", accountId: acc.TM!, categoryId: cat["CHI-KHAC"]!, amount: 1, occurredOn: "2028-02-04" }, ACTOR, TODAY)).rejects.toThrow("Hạng mục không dùng cho phiếu thu");
  });

  it("AC-TC-2: chi 2.500.000 từ TM bị chặn; NH vượt số dư chỉ cảnh báo; chuyển quỹ từ TM cũng chặn", async () => {
    await expect(createManualCash(db, { direction: "out", accountId: acc.TM!, categoryId: cat["CHI-VAN-HANH"]!, amount: 2_500_000, occurredOn: "2028-02-05" }, ACTOR, TODAY)).rejects.toThrow("Tiền mặt chỉ còn 2.283.000đ");
    await expect(createTransfer(db, { fromId: acc.TM!, toId: acc.NH!, amount: 2_283_001, occurredOn: "2028-02-05" }, ACTOR, TODAY)).rejects.toThrow("Tiền mặt chỉ còn 2.283.000đ");
    const r = await createManualCash(db, { direction: "out", accountId: acc.NH!, categoryId: cat["CHI-VAN-HANH"]!, amount: 3_100_000, occurredOn: "2028-02-05" }, ACTOR, TODAY);
    expect(r.warning).toBe("Lưu ý: Ngân hàng đang âm 100.000đ");
    expect(await accountBalance(db, acc.NH!)).toBe(-100_000);
    // Trả lại NH về 3.000.000 cho các bước sau
    await createManualCash(db, { direction: "in", accountId: acc.NH!, categoryId: cat["THU-VON-GOP"]!, amount: 3_100_000, occurredOn: "2028-02-05" }, ACTOR, TODAY);
  });

  it("AC-TC-3: đề nghị chi chờ duyệt không tính số dư; duyệt → posted; từ chối → cancelled", async () => {
    const req = await createManualCash(db, { direction: "out", accountId: acc.TM!, categoryId: cat["CHI-VAN-HANH"]!, amount: 500_000, occurredOn: "2028-02-06", asRequest: true }, ACTOR, TODAY);
    const [row] = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, req.id));
    expect(row!.status).toBe("pending_approval");
    expect(await accountBalance(db, acc.TM!)).toBe(2_283_000);
    await expect(createManualCash(db, { direction: "in", accountId: acc.TM!, categoryId: cat["THU-KHAC"]!, amount: 1, occurredOn: "2028-02-06", asRequest: true }, ACTOR, TODAY)).rejects.toThrow("Đề nghị chỉ dùng cho phiếu chi");

    // Chủ sửa ngày trước khi duyệt
    await approveRequest(db, req.id, { occurredOn: "2028-02-07" }, ACTOR, TODAY);
    const [approved] = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, req.id));
    expect(approved).toMatchObject({ status: "posted", occurredOn: "2028-02-07", approvedBy: ACTOR });
    expect(approved!.approvedAt).not.toBeNull();
    expect(await accountBalance(db, acc.TM!)).toBe(1_783_000);
    await expect(approveRequest(db, req.id, {}, ACTOR, TODAY)).rejects.toThrow("Chứng từ vừa được người khác cập nhật");

    const req2 = await createManualCash(db, { direction: "out", accountId: acc.TM!, categoryId: cat["CHI-VAN-HANH"]!, amount: 300_000, occurredOn: "2028-02-06", asRequest: true }, ACTOR, TODAY);
    await expect(rejectRequest(db, req2.id, " ", ACTOR)).rejects.toThrow("Ghi lý do từ chối");
    await rejectRequest(db, req2.id, "Không có hóa đơn", ACTOR);
    const [rejected] = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, req2.id));
    expect(rejected).toMatchObject({ status: "cancelled", cancelReason: "Từ chối: Không có hóa đơn" });

    // Đề nghị vượt tiền mặt: duyệt bị chặn
    const req3 = await createManualCash(db, { direction: "out", accountId: acc.TM!, categoryId: cat["CHI-VAN-HANH"]!, amount: 9_000_000, occurredOn: "2028-02-06", asRequest: true }, ACTOR, TODAY);
    await expect(approveRequest(db, req3.id, {}, ACTOR, TODAY)).rejects.toThrow("Tiền mặt chỉ còn");
    await rejectRequest(db, req3.id, "Quá quỹ", ACTOR);

    const mine = await listCashTransactions(db, { createdBy: ACTOR, status: "cancelled" });
    expect(mine.total).toBe(2);
  });

  it("AC-TC-4: phiếu order-paid không hủy được ở Tài chính; phiếu tay hủy được, số dư trở lại", async () => {
    const auto = await db.transaction((tx) =>
      recordCashTransaction(tx, { direction: "in", accountCode: "TM", amount: 100_000, categoryCode: "THU-BAN-HANG", occurredOn: "2028-02-08", source: { type: "order", id: crypto.randomUUID() }, idempotencyKey: `order-paid:${crypto.randomUUID()}` }, ACTOR),
    );
    await expect(cancelManualCash(db, auto.id, "Thử", ACTOR)).rejects.toThrow("Phiếu tạo từ nghiệp vụ, hủy ở chứng từ gốc");
    const manual = await createManualCash(db, { direction: "out", accountId: acc.TM!, categoryId: cat["CHI-VAN-HANH"]!, amount: 100_000, occurredOn: "2028-02-08" }, ACTOR, TODAY);
    const before = await accountBalance(db, acc.TM!);
    await expect(cancelManualCash(db, manual.id, "", ACTOR)).rejects.toThrow("Ghi lý do hủy");
    await cancelManualCash(db, manual.id, "Ghi nhầm", ACTOR);
    expect(await accountBalance(db, acc.TM!)).toBe(before + 100_000);
    await expect(cancelManualCash(db, manual.id, "Lần hai", ACTOR)).rejects.toThrow("Phiếu đã hủy");
  });

  it("AC-TC-6: đối chiếu 5.250.000 → thực tế 5.200.000: PC 50.000 CHI-CHENH-LECH, adjustment_tx_id", async () => {
    const id = await createAccount(db, { code: "TM2", name: "Tiền mặt cửa hàng", kind: "cash", openingBalance: 5_250_000, openingOn: "2028-01-01" }, ACTOR);
    const r = await reconcileAccount(db, { accountId: id, asOf: "2028-02-10", actualBalance: 5_200_000, writeAdjustment: true }, ACTOR, TODAY);
    expect(r.systemBalance).toBe(5_250_000);
    expect(r.difference).toBe(-50_000);
    expect(r.adjustmentCode).toMatch(/^PC-2802-/);
    expect(await accountBalance(db, id)).toBe(5_200_000);
    const [rec] = await db.select().from(schema.cashReconciliations).where(eq(schema.cashReconciliations.id, r.id));
    const [adj] = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, rec!.adjustmentTxId!));
    expect(adj).toMatchObject({ amount: 50_000, categoryId: cat["CHI-CHENH-LECH"], sourceType: "reconciliation", sourceId: r.id });
    // Không ghi chênh lệch: chỉ lưu biên bản
    const r2 = await reconcileAccount(db, { accountId: id, asOf: "2028-02-10", actualBalance: 5_000_000, writeAdjustment: false }, ACTOR, TODAY);
    expect(r2.adjustmentCode).toBeNull();
    expect(await accountBalance(db, id)).toBe(5_200_000);
  });

  it("AC-TC-7: đối soát COD 1.000.000, hãng trả 985.000 → COD 0, NH +985.000, lãi lỗ có 15.000 chi phí bán hàng", async () => {
    await createManualCash(db, { direction: "in", accountId: acc.COD!, categoryId: cat["THU-BAN-HANG"]!, amount: 1_000_000, occurredOn: "2028-02-11" }, ACTOR, TODAY);
    const nhBefore = await accountBalance(db, acc.NH!);
    const res = await settleCod(db, { codAccountId: acc.COD!, bankAccountId: acc.NH!, collected: 1_000_000, received: 985_000, occurredOn: "2028-02-12", carrier: "GHN" }, ACTOR, TODAY);
    expect(res.transferCode).toMatch(/^CQ-2802-/);
    expect(res.feeCode).toMatch(/^PC-2802-/);
    expect(await accountBalance(db, acc.COD!)).toBe(0);
    expect(await accountBalance(db, acc.NH!)).toBe(nhBefore + 985_000);
    const pnl = await profitAndLoss(db, { from: "2028-02-01", to: "2028-03-01" });
    expect(pnl.selling).toBe(15_000);
  });
});

describe("công nợ (AC-TC-8, AC-TC-10, AC-TC-13)", { timeout: 60_000 }, () => {
  it("AC-TC-8: phải trả 4.500.000 trả 2 lần, hạng mục CHI-BAO-BI; hủy thanh toán; ngày trả tương lai bị chặn", async () => {
    const p = await createManualPayable(db, { supplierId, categoryId: cat["CHI-BAO-BI"]!, amount: 4_500_000, issuedOn: "2028-02-01" }, ACTOR);
    const [row] = await db.select().from(schema.payables).where(eq(schema.payables.id, p.id));
    expect(row!.dueOn).toBe("2028-03-02"); // + 30 ngày của NCC
    await expect(payDebt(db, { kind: "payable", debtId: p.id, amount: 1, accountId: acc.NH!, paidOn: "2028-04-01", expectedPaidAmount: 0 }, ACTOR, TODAY)).rejects.toThrow("Ngày trả không được sau hôm nay");
    const a = await payDebt(db, { kind: "payable", debtId: p.id, amount: 2_000_000, accountId: acc.NH!, paidOn: "2028-03-01", expectedPaidAmount: 0 }, ACTOR, TODAY);
    expect(a).toMatchObject({ remaining: 2_500_000, status: "partial" });
    const b = await payDebt(db, { kind: "payable", debtId: p.id, amount: 2_500_000, accountId: acc.NH!, paidOn: "2028-03-01", expectedPaidAmount: 2_000_000 }, ACTOR, TODAY);
    expect(b).toMatchObject({ remaining: 0, status: "paid" });
    await expect(payDebt(db, { kind: "payable", debtId: p.id, amount: 1, accountId: acc.NH!, paidOn: "2028-03-01", expectedPaidAmount: 4_500_000 }, ACTOR, TODAY)).rejects.toThrow("Khoản nợ đã trả đủ");
    const detail = (await getDebt(db, "payable", p.id, TODAY))!;
    expect(detail.payments).toHaveLength(2);
    const txs = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.sourceId, p.id));
    expect(txs.every((t) => t.categoryId === cat["CHI-BAO-BI"])).toBe(true);
    // Phiếu của thanh toán công nợ không hủy ở Thu chi
    await expect(cancelManualCash(db, txs[0]!.id, "Thử", ACTOR)).rejects.toThrow("Hủy thanh toán");
    await cancelPayment(db, detail.payments[0]!.id, "Chuyển nhầm", ACTOR);
    const after = (await getDebt(db, "payable", p.id, TODAY))!;
    expect(after).toMatchObject({ status: "partial", paidAmount: detail.paidAmount - detail.payments[0]!.amount });
    await expect(cancelPayment(db, detail.payments[0]!.id, "Lần hai", ACTOR)).rejects.toThrow("đã được hủy");
  });

  it("AC-TC-10: phải thu đơn đại lý 3.500.000 trả đủ → đơn paid; hủy lần trả → partial, đơn unpaid", async () => {
    const d = one(await db.insert(schema.dealers).values({ code: "DL-001", name: "Đại lý Hà Nội" }).returning());
    const { order } = await makeOrder({ code: "DL-2802-0001", channel: "WEB", subtotal: 3_500_000, deliveredAt: null, items: [{ productId, name: "Dầu gội", qty: 10, lineTotal: 3_500_000, lotId: null }] });
    await db.update(schema.orders).set({ paymentMethod: "credit", dealerId: d.id }).where(eq(schema.orders.id, order.id));
    const r = await db.transaction(async (tx) => {
      const { openReceivable } = await import("@/modules/finance/ledger");
      return openReceivable(tx, { party: "dealer", dealerId: d.id, orderId: order.id, amount: 3_500_000, issuedOn: "2028-02-01", dueOn: "2028-03-01" }, ACTOR);
    });
    await payDebt(db, { kind: "receivable", debtId: r.id, amount: 2_000_000, accountId: acc.NH!, paidOn: "2028-03-01", expectedPaidAmount: 0 }, ACTOR, TODAY);
    await payDebt(db, { kind: "receivable", debtId: r.id, amount: 1_500_000, accountId: acc.NH!, paidOn: "2028-03-02", expectedPaidAmount: 2_000_000 }, ACTOR, TODAY);
    expect(one(await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))).paymentStatus).toBe("paid");
    const detail = (await getDebt(db, "receivable", r.id, TODAY))!;
    const last = detail.payments.find((x) => x.amount === 1_500_000)!;
    await cancelPayment(db, last.id, "Ngân hàng trả lại", ACTOR);
    expect(one(await db.select().from(schema.receivables).where(eq(schema.receivables.id, r.id))).status).toBe("partial");
    expect(one(await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))).paymentStatus).toBe("unpaid");
    expect(one(await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, last.cashTxId))).status).toBe("cancelled");
  });

  it("AC-TC-13: tuổi nợ ngày 2028-01-20 và cảnh báo quá hạn ở Tổng quan", async () => {
    const c = one(await db.insert(schema.customers).values({ name: "Chị Lan", referralCode: "LAN01" }).returning());
    for (const [amount, dueOn] of [
      [100_000, "2028-01-05"],
      [200_000, "2027-10-15"],
      [300_000, "2028-01-25"],
    ] as const) {
      await createManualReceivable(db, { party: "customer", customerId: c.id, amount, issuedOn: "2027-10-01", dueOn }, ACTOR);
    }
    const rows = (await listReceivables(db, { today: "2028-01-20", status: "open_all" })).filter((r) => r.partyName === "Chị Lan");
    const by = Object.fromEntries(rows.map((r) => [r.dueOn, r]));
    expect(by["2028-01-05"]).toMatchObject({ overdueDays: 15, bucket: "d1_30", dueSoon: false });
    expect(by["2027-10-15"]).toMatchObject({ overdueDays: 97, bucket: "d90_plus" });
    expect(by["2028-01-25"]).toMatchObject({ overdueDays: 0, bucket: "current", dueSoon: true });
    const group = groupByParty(rows);
    expect(group[0]).toMatchObject({ partyName: "Chị Lan", remaining: 600_000, overdue: 300_000, count: 3 });
    const alerts = await computeFinanceAlerts(db, "owner", "2028-01-20");
    expect(alerts.some((a) => a.level === "danger" && /khoản phải thu quá hạn/.test(a.text))).toBe(true);
    expect(await computeFinanceAlerts(db, "collaborator", "2028-01-20")).toEqual([]);
    expect(await computeFinanceAlerts(db, "viewer", "2028-01-20")).toEqual([]);
  });
});

describe("ngân sách (AC-TC-14)", { timeout: 60_000 }, () => {
  it("marketing 2.000.000 + dòng riêng hoa hồng 500.000: 85% vàng, 120% đỏ, cảnh báo", async () => {
    const id = await createBudget(db, { period: "month", anyDate: "2028-03-15" }, ACTOR);
    await expect(createBudget(db, { period: "month", anyDate: "2028-03-01" }, ACTOR)).rejects.toThrow("Tháng 3/2028 đã có ngân sách");
    await setBudgetLine(db, id, { group: "marketing", categoryId: null, amount: 2_000_000 }, ACTOR);
    await setBudgetLine(db, id, { group: "marketing", categoryId: cat["CHI-HOA-HONG"]!, amount: 500_000 }, ACTOR);
    await expect(setBudgetLine(db, id, { group: "personnel", categoryId: cat["CHI-HOA-HONG"]!, amount: 1 }, ACTOR)).rejects.toThrow("không thuộc nhóm");
    await createManualCash(db, { direction: "in", accountId: acc.NH!, categoryId: cat["THU-VON-GOP"]!, amount: 5_000_000, occurredOn: "2028-03-01" }, ACTOR, TODAY);
    await createManualCash(db, { direction: "out", accountId: acc.NH!, categoryId: cat["CHI-MARKETING"]!, amount: 1_700_000, occurredOn: "2028-03-10", channelCode: "SHP" }, ACTOR, TODAY);
    await createManualCash(db, { direction: "out", accountId: acc.NH!, categoryId: cat["CHI-HOA-HONG"]!, amount: 600_000, occurredOn: "2028-03-11" }, ACTOR, TODAY);
    const rep = (await getBudgetReport(db, id, 8000))!;
    const group = rep.lines.find((l) => !l.categoryId)!;
    const hh = rep.lines.find((l) => l.categoryId)!;
    expect(group).toMatchObject({ actual: 1_700_000, ratioBp: 8500, tone: "amber" });
    expect(hh).toMatchObject({ actual: 600_000, ratioBp: 12000, tone: "red", over: 100_000 });
    // Nháp chưa cảnh báo; kích hoạt rồi mới có
    expect((await computeFinanceAlerts(db, "owner", "2028-03-20")).some((a) => a.href.includes(id))).toBe(false);
    await advanceBudgetStatus(db, id, "draft", ACTOR);
    await expect(advanceBudgetStatus(db, id, "draft", ACTOR)).rejects.toThrow("Chứng từ vừa được người khác cập nhật");
    const alerts = (await computeFinanceAlerts(db, "owner", "2028-03-20")).filter((a) => a.href.includes(id));
    expect(alerts.map((a) => a.level).sort()).toEqual(["danger", "warn"]);
    expect(alerts.find((a) => a.level === "danger")!.text).toMatch(/^Hoa hồng đại lý vượt 100\.000đ/);
  });
});

describe("giá vốn (AC-TC-15…AC-TC-18)", { timeout: 60_000 }, () => {
  let aId = "";
  let bId = "";
  let aFg = "";

  it("AC-TC-15: lệnh gia công 16.800.000 / 296 chai = 56.757, kế hoạch 56.000, chênh +757", async () => {
    await db.insert(schema.productionOrders).values({
      code: "LSX-2711-001",
      kind: "outsourced",
      status: "completed",
      productId,
      plannedUnits: 300,
      goodUnits: 296,
      lotId,
      materialCost: 300_000,
      packagingCost: 4_500_000,
      outsourcingCost: 12_000_000,
      totalCost: 16_800_000,
      plannedCost: 16_800_000,
      finishedAt: new Date("2027-11-21T10:00:00+07:00"),
    });
    const row = (await listProductionCosts(db, TODAY)).find((r) => r.code === "LSX-2711-001")!;
    expect(row).toMatchObject({ material: 300_000, packaging: 4_500_000, outsourcing: 12_000_000, total: 16_800_000, goodUnits: 296, unitCost: 56_757, plannedUnitCost: 56_000, diffPerUnit: 757, lotNo: "PST-271120-01", suggestLock: true });
  });

  it("AC-TC-16: phân bổ 1.000.000 theo chai → A 604.839, B 395.161; tổng và giá lô kho tăng", async () => {
    const mk = async (code: string, units: number) => {
      const lot = one(await db.insert(schema.lots).values({ lotNo: `PST-280110-${code.slice(-2)}`, productId, formulaVersion: "PST-v1", manufacturedOn: "2028-01-10", expiresOn: "2030-01-10", unitsProduced: units }).returning());
      const po = one(
        await db
          .insert(schema.productionOrders)
          .values({ code, kind: "outsourced", status: "completed", productId, plannedUnits: units, goodUnits: units, lotId: lot.id, outsourcingCost: units * 40_000, totalCost: units * 40_000, finishedAt: new Date("2028-01-15T09:00:00+07:00") })
          .returning(),
      );
      const fg = one(await db.insert(schema.stockLots).values({ code: lot.lotNo, itemId: fgItemId, productLotId: lot.id, receivedQty: units, receivedCost: units * 40_000, qcStatus: null, sourceDocType: "receipt", sourceDocId: crypto.randomUUID(), productionOrderId: po.id }).returning());
      return { po, fg };
    };
    const a = await mk("LSX-2801-001", 300);
    const b = await mk("LSX-2801-002", 196);
    aId = a.po.id;
    bId = b.po.id;
    aFg = a.fg.id;
    const res = await allocateOverhead(db, { month: "2028-01", total: 1_000_000, basis: "units" }, ACTOR);
    expect(res.code).toBe("PB-2801-01");
    expect(res.lines.map((l) => l.amount)).toEqual([604_839, 395_161]);
    const [pa] = await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, aId));
    expect(pa!.totalCost).toBe(12_000_000 + 604_839);
    expect(one(await db.select().from(schema.stockLots).where(eq(schema.stockLots.id, aFg))).receivedCost).toBe(12_604_839);
    const [pb] = await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, bId));
    expect(pb!.totalCost).toBe(196 * 40_000 + 395_161);
    // Xóa phân bổ → tính lại
    await deleteAllocation(db, res.id, ACTOR);
    expect(one(await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, aId))).totalCost).toBe(12_000_000);
    await expect(allocateOverhead(db, { month: "2028-01", total: 1_000_000, basis: "bulk" }, ACTOR)).rejects.toThrow("Tháng này không có lệnh để phân bổ");
  });

  it("AC-TC-17: lệnh đã chốt bị bỏ qua khi phân bổ; mở chốt cần lý do", async () => {
    await setCostLock(db, aId, true, null, ACTOR);
    await expect(setCostLock(db, aId, true, null, ACTOR)).rejects.toThrow("Giá vốn lệnh đã chốt");
    const res = await allocateOverhead(db, { month: "2028-01", total: 500_000, basis: "units" }, ACTOR);
    expect(res.lines.map((l) => l.productionOrderId)).toEqual([bId]);
    expect(res.lines[0]!.amount).toBe(500_000);
    await setCostLock(db, bId, true, null, ACTOR);
    await expect(allocateOverhead(db, { month: "2028-01", total: 1, basis: "units" }, ACTOR)).rejects.toThrow("Tháng này không có lệnh để phân bổ");
    await expect(deleteAllocation(db, res.id, ACTOR)).rejects.toThrow("đã chốt giá vốn");
    await expect(setCostLock(db, aId, false, " ", ACTOR)).rejects.toThrow("Ghi lý do mở chốt");
    await setCostLock(db, aId, false, "Sửa giá gia công", ACTOR);
    expect(one(await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, aId))).costLockedAt).toBeNull();
    const audit = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "finance.cost_unlock"), eq(schema.auditLog.entityId, aId)));
    expect(audit[0]!.after).toMatchObject({ reason: "Sửa giá gia công" });
    // So lô: lô sau so với lô trước cùng sản phẩm
    const rows = (await listProductionCosts(db, TODAY)).filter((r) => r.productId === productId);
    expect(rows[0]!.vsPreviousBp).toBeNull();
    expect(rows[1]!.vsPreviousBp).not.toBeNull();
  });

  it("AC-TC-18: TD-001 nhập 2.000.000đ/l rồi 2.300.000đ/l → +15%", async () => {
    const item = one(await db.insert(schema.inventoryItems).values({ code: "TD-001", name: "Tinh dầu vỏ bưởi", kind: "extract", baseUom: "ul", displayUom: "ml", purchaseUom: "l", refUnitPrice: 2_000_000 }).returning());
    const rawWh = one(await db.select().from(schema.warehouses).where(eq(schema.warehouses.kind, "extract")));
    for (const [code, on, cost] of [
      ["PN-2801-0001", "2028-01-05", 2_000_000],
      ["PN-2802-0001", "2028-02-05", 2_300_000],
    ] as const) {
      const r = one(await db.insert(schema.stockReceipts).values({ code, kind: "purchase", status: "posted", supplierId, warehouseId: rawWh.id, receivedOn: on }).returning());
      await db.insert(schema.stockReceiptLines).values({ receiptId: r.id, itemId: item.id, qty: 1_000_000, lineCost: cost });
    }
    const rows = (await priceHistory(db)).filter((r) => r.itemCode === "TD-001");
    expect(rows.map((r) => r.unitPrice)).toEqual([2_000_000, 2_300_000]);
    expect(rows[1]).toMatchObject({ vsPreviousBp: 1500, vsRefBp: 1500 });
  });
});

describe("lãi lỗ (AC-TC-19…AC-TC-24)", { timeout: 60_000 }, () => {
  let orderItemId = "";

  it("AC-TC-19, AC-TC-24: đơn 2 chai giao tháng 11/2027 → 458.000 + 25.000 − 113.514; đơn chưa giao không có; dòng thiếu giá vốn", async () => {
    const { items } = await makeOrder({ code: "WEB-2711-0001", subtotal: 458_000, shipping: 25_000, deliveredAt: "2027-11-25T10:00:00+07:00", items: [{ productId, name: "Dầu gội vỏ bưởi", qty: 2, lineTotal: 458_000, lotId }] });
    orderItemId = items[0]!.id;
    await makeOrder({ code: "WEB-2711-0002", subtotal: 229_000, deliveredAt: null, items: [{ productId, name: "Dầu gội vỏ bưởi", qty: 1, lineTotal: 229_000, lotId }] });
    let pnl = await profitAndLoss(db, { from: "2027-11-01", to: "2027-12-01" });
    expect(pnl).toMatchObject({ goodsRevenue: 458_000, shippingIncome: 25_000, netRevenue: 483_000, cogs: 113_514, grossProfit: 369_486, orderCount: 1, missingCostLines: 0 });
    // Dòng đơn cũ không có lô kho (AC-TC-24)
    await makeOrder({ code: "WEB-2711-0003", subtotal: 100_000, deliveredAt: "2027-11-26T10:00:00+07:00", items: [{ productId: product2Id, name: "Dầu gội mini", qty: 1, lineTotal: 100_000, lotId: null }] });
    pnl = await profitAndLoss(db, { from: "2027-11-01", to: "2027-12-01" });
    expect(pnl.cogs).toBe(113_514);
    expect(pnl.missingCostLines).toBe(1);
  });

  it("AC-TC-20: đổi trả 1 chai hoàn tất tháng 12 → hàng trả 199.500, giá vốn trừ 56.757; cách ly không trừ", async () => {
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.code, "WEB-2711-0001"));
    const ret = one(await db.insert(schema.returnRequests).values({ code: "DT-2712-001", orderId: o!.id, reason: "changed_mind", status: "completed", refundAmount: 199_500, completedAt: new Date("2027-12-05T10:00:00+07:00") }).returning());
    await db.insert(schema.returnRequestLines).values({ returnId: ret.id, orderItemId, qty: 1, disposition: "restock", refundAmount: 199_500 });
    const ret2 = one(await db.insert(schema.returnRequests).values({ code: "DT-2712-002", orderId: o!.id, reason: "defect", status: "completed", refundAmount: 0, completedAt: new Date("2027-12-06T10:00:00+07:00") }).returning());
    await db.insert(schema.returnRequestLines).values({ returnId: ret2.id, orderItemId, qty: 1, disposition: "quarantine", refundAmount: 0 });
    const pnl = await profitAndLoss(db, { from: "2027-12-01", to: "2028-01-01" });
    expect(pnl.returns).toBe(199_500);
    expect(pnl.cogs).toBe(-costOfQty(1, 296, 16_800_000));
    expect(pnl.cogs).toBe(-56_757);
    const byProduct = await profitByProduct(db, { from: "2027-12-01", to: "2028-01-01" });
    expect(byProduct.rows[0]).toMatchObject({ productId, returns: 199_500, cogs: -56_757 });
  });

  it("AC-TC-21: phí sàn, marketing gắn kênh, xuất mẫu, hủy, kiểm kê thiếu, chi SX chung", async () => {
    await makeOrder({ code: "SHP-2804-0001", channel: "SHP", subtotal: 229_000, platformFee: 49_235, deliveredAt: "2028-04-10T10:00:00+07:00", items: [{ productId, name: "Dầu gội vỏ bưởi", qty: 1, lineTotal: 229_000, lotId }] });
    const T = "2028-04-30";
    await createManualCash(db, { direction: "in", accountId: acc.NH!, categoryId: cat["THU-VON-GOP"]!, amount: 5_000_000, occurredOn: "2028-04-01" }, ACTOR, T);
    await createManualCash(db, { direction: "out", accountId: acc.NH!, categoryId: cat["CHI-MARKETING"]!, amount: 1_000_000, occurredOn: "2028-04-02", channelCode: "SHP" }, ACTOR, T);
    await createManualCash(db, { direction: "out", accountId: acc.NH!, categoryId: cat["CHI-SX-CHUNG"]!, amount: 2_000_000, occurredOn: "2028-04-03" }, ACTOR, T);
    await move("sample_issue", -5, "2028-04-04T10:00:00+07:00");
    await move("scrap_issue", -2, "2028-04-05T10:00:00+07:00");
    await move("count_adjust", -1, "2028-04-06T10:00:00+07:00");
    const pnl = await profitAndLoss(db, { from: "2028-04-01", to: "2028-05-01" });
    const v = (n: number) => costOfQty(n, 296, 16_800_000);
    expect(pnl.selling).toBe(49_235);
    expect(pnl.marketing).toBe(1_000_000 + v(5));
    expect(pnl.otherExpense).toBe(v(2) + v(1));
    expect(pnl.capitalizedNotInCost).toBe(2_000_000);
    expect(pnl.netProfit).toBe(229_000 - v(1) - 49_235 - 1_000_000 - v(5) - v(2) - v(1));
    const channels = await channelReport(db, { from: "2028-04-01", to: "2028-05-01" });
    const shp = channels.find((c) => c.channel === "SHP")!;
    expect(shp).toMatchObject({ netRevenue: 229_000, cogs: v(1), platformFee: 49_235, marketing: 1_000_000, contribution: 229_000 - v(1) - 49_235 });
  });

  it("AC-TC-23: chiết khấu 30.000 chia 23.054 / 6.946 theo sản phẩm", async () => {
    await makeOrder({
      code: "WEB-2805-0001",
      subtotal: 298_000,
      discount: 30_000,
      deliveredAt: "2028-05-02T10:00:00+07:00",
      items: [
        { productId, name: "Dầu gội vỏ bưởi", qty: 1, lineTotal: 229_000, lotId },
        { productId: product2Id, name: "Dầu gội mini", qty: 1, lineTotal: 69_000, lotId: null },
      ],
    });
    const { rows } = await profitByProduct(db, { from: "2028-05-01", to: "2028-06-01" });
    expect(rows.find((r) => r.productId === productId)).toMatchObject({ discount: 23_054, revenue: 229_000 - 23_054 });
    expect(rows.find((r) => r.productId === product2Id)).toMatchObject({ discount: 6_946, revenue: 69_000 - 6_946, cogs: 0 });
  });
});

describe("dòng tiền, vốn lưu động, bất biến (AC-TC-25…AC-TC-27)", { timeout: 60_000 }, () => {
  it("R-TC-25: tổng cuối kỳ dòng tiền = tổng số dư tài khoản; R-TC-27 vốn lưu động", async () => {
    const flow = await cashFlowActual(db, { from: "2028-01-01", to: "2029-01-01" });
    for (const a of flow) {
      const sumIn = a.inflows.reduce((s, x) => s + x.amount, 0);
      const sumOut = a.outflows.reduce((s, x) => s + x.amount, 0);
      expect(a.opening + sumIn - sumOut + a.transferIn - a.transferOut, a.code).toBe(a.closing);
    }
    const accounts = await db.select().from(schema.cashAccounts);
    let total = 0;
    for (const a of accounts) total += await accountBalance(db, a.id);
    expect(flow.reduce((s, a) => s + a.closing, 0)).toBe(total);
    expect(await totalCash(db)).toBe(total);

    const wc = await workingCapitalReport(db);
    expect(wc.stockValue).toBe(await stockValue(db));
    expect(wc.workingCapital).toBe(wc.stockValue + wc.receivables - wc.payables);
  });

  it("AC-TC-27: INV-6, INV-7, INV-8 sau toàn bộ luồng", async () => {
    for (const table of [schema.receivables, schema.payables] as const) {
      const col = table === schema.receivables ? schema.debtPayments.receivableId : schema.debtPayments.payableId;
      for (const d of await db.select().from(table)) {
        const [row] = await db
          .select({ s: sql<string>`coalesce(sum(${schema.debtPayments.amount}), 0)` })
          .from(schema.debtPayments)
          .innerJoin(schema.cashTransactions, eq(schema.cashTransactions.id, schema.debtPayments.cashTransactionId))
          .where(and(eq(col, d.id), sql`${schema.cashTransactions.status} <> 'cancelled'`));
        expect(Number(row!.s), `INV-6 ${d.code}`).toBe(d.paidAmount);
      }
    }
    const txs = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.status, "posted"));
    for (const a of await db.select().from(schema.cashAccounts)) {
      let expected = a.openingBalance;
      for (const t of txs) {
        if (t.accountId === a.id) expected += t.direction === "in" ? t.amount : -t.amount;
        if (t.toAccountId === a.id) expected += t.amount;
      }
      expect(await accountBalance(db, a.id), `INV-7 ${a.code}`).toBe(expected);
    }
    const dup = await db.execute(sql`select idempotency_key from cash_transactions where idempotency_key is not null group by 1 having count(*) > 1`);
    expect((dup as unknown as { rows: unknown[] }).rows.length).toBe(0);
  });
});
