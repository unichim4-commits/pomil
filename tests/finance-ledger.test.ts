import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { seedErpMasterData } from "@/db/seed-erp";
import {
  accountBalance,
  adjustDebtAmount,
  applyDebtPayment,
  cancelCashTransaction,
  cancelDebt,
  cancelDebtPayment,
  findDebtBySource,
  openPayable,
  openReceivable,
  recordCashTransaction,
} from "@/modules/finance/ledger";
import { cancelledIdempotencyKey, debtStatusAfterAdjust, debtStatusFor, orderCashAmount, staleDebtPayment, validateDebtPayment, wouldOverdraw } from "@/modules/finance/ledger-rules";

const ACTOR = "00000000-0000-4000-8000-000000000000";
let db: Db;
const acc: Record<string, string> = {};
let supplierId = "";
let dealerId = "";

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "drizzle" });
  await seedErpMasterData(db);
  for (const a of await db.select().from(schema.cashAccounts)) acc[a.code] = a.id;
  await db.update(schema.cashAccounts).set({ openingBalance: 5_000_000, openingOn: "2028-01-01" }).where(eq(schema.cashAccounts.code, "TM"));
  const [s] = await db.insert(schema.suppliers).values({ code: "NCC-001", name: "Nhà cung cấp nhãn" }).returning();
  supplierId = s!.id;
  const [d] = await db.insert(schema.dealers).values({ code: "DL-001", name: "Đại lý Hà Nội", paymentTermsDays: 30 }).returning();
  dealerId = d!.id;
}, 120_000);

// INV-6: paid_amount = tổng debt_payments có phiếu chưa hủy; paid ≤ amount
async function checkInv6() {
  for (const table of [schema.receivables, schema.payables] as const) {
    const col = table === schema.receivables ? schema.debtPayments.receivableId : schema.debtPayments.payableId;
    for (const d of await db.select().from(table)) {
      const [row] = await db
        .select({ s: sql<string>`coalesce(sum(${schema.debtPayments.amount}), 0)` })
        .from(schema.debtPayments)
        .innerJoin(schema.cashTransactions, eq(schema.cashTransactions.id, schema.debtPayments.cashTransactionId))
        .where(and(eq(col, d.id), sql`${schema.cashTransactions.status} <> 'cancelled'`));
      expect(Number(row!.s), `INV-6 ${d.code}`).toBe(d.paidAmount);
      expect(d.paidAmount).toBeLessThanOrEqual(d.amount);
    }
  }
}

// INV-7: số dư = đầu + thu − chi ± chuyển, chỉ phiếu posted (tính lại bằng JS)
async function checkInv7() {
  const txs = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.status, "posted"));
  for (const a of await db.select().from(schema.cashAccounts)) {
    let expected = a.openingBalance;
    for (const t of txs) {
      if (t.accountId === a.id) expected += t.direction === "in" ? t.amount : -t.amount;
      if (t.toAccountId === a.id) expected += t.amount;
    }
    expect(await accountBalance(db, a.id), `INV-7 ${a.code}`).toBe(expected);
  }
}

// INV-8: mỗi khóa một phiếu, mỗi đơn tối đa một phải thu (unique trong DB; kiểm lại cho chắc)
async function checkInv8() {
  const rows = await db.execute(sql`select idempotency_key from cash_transactions where idempotency_key is not null group by 1 having count(*) > 1`);
  expect((rows as unknown as { rows: unknown[] }).rows.length).toBe(0);
}

describe("quy tắc thuần sổ quỹ và công nợ", () => {
  it("R-TC-11: trạng thái và kiểm số tiền trả", () => {
    expect(debtStatusFor(4_500_000, 0)).toBe("open");
    expect(debtStatusFor(4_500_000, 2_000_000)).toBe("partial");
    expect(debtStatusFor(4_500_000, 4_500_000)).toBe("paid");
    const debt = { amount: 4_500_000, paidAmount: 2_000_000, status: "partial" as const };
    expect(validateDebtPayment(debt, 2_500_000)).toBeNull();
    expect(validateDebtPayment(debt, 2_500_001)).toBe("Vượt số còn nợ 2.500.000đ");
    expect(validateDebtPayment(debt, 0)).toBe("Số tiền phải là số nguyên lớn hơn 0");
    expect(validateDebtPayment({ ...debt, paidAmount: 4_500_000, status: "paid" }, 1)).toBe("Khoản nợ đã trả đủ");
    expect(validateDebtPayment({ ...debt, status: "cancelled" }, 1)).toBe("Khoản nợ đã hủy");
  });

  it("R-TC-11, AC-TC-9: đọc cũ — số đã trả khác số form đọc được thì từ chối", () => {
    expect(staleDebtPayment(undefined, 2_000_000)).toBeNull();
    expect(staleDebtPayment(null, 2_000_000)).toBeNull();
    expect(staleDebtPayment(2_000_000, 2_000_000)).toBeNull();
    expect(staleDebtPayment(0, 2_000_000)).toBe("Khoản nợ vừa được ghi thanh toán khác (đã trả 2.000.000đ). Tải lại trang để xem số còn nợ.");
  });

  it("R-TC-12: điều chỉnh số nợ", () => {
    expect(debtStatusAfterAdjust({ amount: 450_000, paidAmount: 0, status: "open" }, 0)).toEqual({ amount: 450_000, status: "cancelled" });
    expect(debtStatusAfterAdjust({ amount: 12_000_000, paidAmount: 5_000_000, status: "partial" }, 4_000_000)).toEqual({ error: "Thấp hơn số đã trả 5.000.000đ" });
    expect(debtStatusAfterAdjust({ amount: 12_000_000, paidAmount: 5_000_000, status: "partial" }, 5_000_000)).toEqual({ amount: 5_000_000, status: "paid" });
    expect(debtStatusAfterAdjust({ amount: 12_000_000, paidAmount: 5_000_000, status: "partial" }, 8_000_000)).toEqual({ amount: 8_000_000, status: "partial" });
    expect(debtStatusAfterAdjust({ amount: 1_000, paidAmount: 0, status: "open" }, 2_000)).toEqual({ amount: 2_000, status: "open" });
  });

  it("R-TC-4, R-TC-7, R-BH-18: tiền mặt âm, khóa phiếu hủy, số tiền phiếu đơn", () => {
    expect(wouldOverdraw(2_283_000, 2_283_000)).toBe(false);
    expect(wouldOverdraw(2_283_000, 2_283_001)).toBe(true);
    expect(cancelledIdempotencyKey("order-paid:abc", "id1")).toBe("order-paid:abc#cancelled-id1");
    expect(orderCashAmount(483_000, 0)).toBe(483_000);
    expect(orderCashAmount(458_000, 199_500)).toBe(258_500);
    expect(orderCashAmount(100, 200)).toBe(0);
  });
});

describe("sổ quỹ trên PGlite", () => {
  it("R-TC-1, R-TC-4, R-TC-7: ghi phiếu, số dư, chống ghi hai lần, hủy và ghi lại", async () => {
    const thu = await db.transaction((tx) =>
      recordCashTransaction(tx, { direction: "in", accountCode: "TM", amount: 483_000, categoryCode: "THU-BAN-HANG", occurredOn: "2028-01-10", idempotencyKey: "test:thu-1" }, ACTOR),
    );
    expect(thu.created).toBe(true);
    expect(thu.code).toBe("PT-2801-0001");

    // Gọi lại cùng khóa → phiếu cũ (INV-8)
    const again = await db.transaction((tx) =>
      recordCashTransaction(tx, { direction: "in", accountCode: "TM", amount: 999, categoryCode: "THU-BAN-HANG", occurredOn: "2028-01-10", idempotencyKey: "test:thu-1" }, ACTOR),
    );
    expect(again).toEqual({ id: thu.id, code: thu.code, created: false });

    // Hai lời gọi đồng thời cùng khóa → một phiếu
    const both = await Promise.all(
      [1, 2].map(() =>
        db.transaction((tx) =>
          recordCashTransaction(tx, { direction: "in", accountCode: "NH", amount: 10_000, categoryCode: "THU-KHAC", occurredOn: "2028-01-10", idempotencyKey: "test:song-song" }, ACTOR),
        ),
      ),
    );
    expect(both.filter((r) => r.created).length).toBe(1);
    expect(both[0]!.id).toBe(both[1]!.id);

    const chi = await db.transaction((tx) =>
      recordCashTransaction(tx, { direction: "out", accountCode: "TM", amount: 200_000, categoryCode: "CHI-VAN-HANH", occurredOn: "2028-01-11" }, ACTOR),
    );
    expect(chi.code).toBe("PC-2801-0001");
    // Chuyển quỹ chưa có hàm dùng chung (thuộc T-18): ghi thẳng để thử R-TC-1
    await db.insert(schema.cashTransactions).values({ code: "CQ-2801-001", direction: "transfer", accountId: acc.TM!, toAccountId: acc.NH!, amount: 3_000_000, occurredOn: "2028-01-12" });

    expect(await accountBalance(db, acc.TM!)).toBe(2_283_000);
    expect(await accountBalance(db, acc.NH!)).toBe(3_010_000);
    expect(await accountBalance(db, acc.TM!, "2028-01-10")).toBe(5_483_000);

    // Phiếu chờ duyệt không tính
    await db.transaction((tx) =>
      recordCashTransaction(tx, { direction: "out", accountCode: "TM", amount: 9_000_000, categoryCode: "CHI-MARKETING", occurredOn: "2028-01-12", status: "pending_approval" }, ACTOR),
    );
    expect(await accountBalance(db, acc.TM!)).toBe(2_283_000);

    // R-TC-4: tiền mặt không âm
    await expect(
      db.transaction((tx) => recordCashTransaction(tx, { direction: "out", accountCode: "TM", amount: 2_283_001, categoryCode: "CHI-KHAC", occurredOn: "2028-01-12" }, ACTOR)),
    ).rejects.toThrow("Tiền mặt chỉ còn 2.283.000đ");
    // Hạng mục sai chiều
    await expect(
      db.transaction((tx) => recordCashTransaction(tx, { direction: "in", accountCode: "TM", amount: 1, categoryCode: "CHI-KHAC", occurredOn: "2028-01-12" }, ACTOR)),
    ).rejects.toThrow(/không dùng cho phiếu thu/);

    // Hủy → khóa được nhả, ghi lại cùng khóa tạo phiếu mới
    expect(await db.transaction((tx) => cancelCashTransaction(tx, { idempotencyKey: "test:thu-1" }, "Ghi nhầm", ACTOR))).toEqual({ cancelled: true });
    expect(await db.transaction((tx) => cancelCashTransaction(tx, { id: thu.id }, "Lần hai", ACTOR))).toEqual({ cancelled: false });
    const [cancelled] = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, thu.id));
    expect(cancelled!.idempotencyKey).toBe(`test:thu-1#cancelled-${thu.id}`);
    expect(await accountBalance(db, acc.TM!)).toBe(1_800_000);
    const redo = await db.transaction((tx) =>
      recordCashTransaction(tx, { direction: "in", accountCode: "TM", amount: 483_000, categoryCode: "THU-BAN-HANG", occurredOn: "2028-01-10", idempotencyKey: "test:thu-1" }, ACTOR),
    );
    expect(redo.created).toBe(true);
    expect(redo.id).not.toBe(thu.id);
    expect(await accountBalance(db, acc.TM!)).toBe(2_283_000);

    await checkInv7();
    await checkInv8();
  });

  it("R-TC-10, R-TC-11, R-TC-13: phải trả NCC trả từng phần, hủy thanh toán", async () => {
    const input = {
      supplierId,
      categoryCode: "CHI-BAO-BI",
      source: { type: "manual" as const, id: "11111111-1111-4111-8111-111111111111", code: "PN-2801-0001" },
      amount: 4_500_000,
      issuedOn: "2028-01-05",
      dueOn: "2028-02-04",
    };
    const p = await db.transaction((tx) => openPayable(tx, input, ACTOR));
    expect(p.created).toBe(true);
    expect(p.code).toBe("CNP-2801-0001");
    const again = await db.transaction((tx) => openPayable(tx, { ...input, amount: 1 }, ACTOR));
    expect(again).toEqual({ ...p, created: false });
    expect(await findDebtBySource(db, { kind: "payable", sourceType: "manual", sourceId: input.source.id })).toMatchObject({ id: p.id, amount: 4_500_000, paidAmount: 0, status: "open" });

    const nhBefore = await accountBalance(db, acc.NH!);
    const first = await db.transaction((tx) => applyDebtPayment(tx, { kind: "payable", debtId: p.id, amount: 2_000_000, accountId: acc.NH!, paidOn: "2028-01-15" }, ACTOR));
    expect(first).toMatchObject({ remaining: 2_500_000, status: "partial" });
    const [cashTx] = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, first.cashTxId));
    expect(cashTx).toMatchObject({ direction: "out", amount: 2_000_000, idempotencyKey: `debt-payment:${first.paymentId}`, counterpartyType: "supplier", sourceType: "payable" });
    expect(await accountBalance(db, acc.NH!)).toBe(nhBefore - 2_000_000);

    await expect(
      db.transaction((tx) => applyDebtPayment(tx, { kind: "payable", debtId: p.id, amount: 2_500_001, accountId: acc.NH!, paidOn: "2028-01-16" }, ACTOR)),
    ).rejects.toThrow("Vượt số còn nợ 2.500.000đ");
    const second = await db.transaction((tx) => applyDebtPayment(tx, { kind: "payable", debtId: p.id, amount: 2_500_000, accountId: acc.NH!, paidOn: "2028-01-16" }, ACTOR));
    expect(second).toMatchObject({ remaining: 0, status: "paid" });
    await expect(
      db.transaction((tx) => applyDebtPayment(tx, { kind: "payable", debtId: p.id, amount: 1, accountId: acc.NH!, paidOn: "2028-01-16" }, ACTOR)),
    ).rejects.toThrow("Khoản nợ đã trả đủ");
    await checkInv6();

    // Hủy lần trả thứ hai → còn 2.500.000, partial, phiếu chi bị hủy, tiền trở lại
    expect(await db.transaction((tx) => cancelDebtPayment(tx, second.paymentId, "Chuyển nhầm", ACTOR))).toEqual({ cancelled: true });
    expect(await findDebtBySource(db, { kind: "payable", sourceType: "manual", sourceId: input.source.id })).toMatchObject({ paidAmount: 2_000_000, status: "partial" });
    expect(await accountBalance(db, acc.NH!)).toBe(nhBefore - 2_000_000);
    await checkInv6();

    // R-TC-13: đã trả thì không hủy được khoản nợ
    await expect(db.transaction((tx) => cancelDebt(tx, { kind: "payable", debtId: p.id, reason: "Thử" }, ACTOR))).rejects.toThrow(/đã trả 2.000.000đ/);
    // R-TC-12: sửa thấp hơn số đã trả
    await expect(
      db.transaction((tx) => adjustDebtAmount(tx, { kind: "payable", debtId: p.id, newAmount: 1_000_000, reason: "Sửa giá" }, ACTOR)),
    ).rejects.toThrow("Thấp hơn số đã trả 2.000.000đ");
    expect(await db.transaction((tx) => adjustDebtAmount(tx, { kind: "payable", debtId: p.id, newAmount: 2_000_000, reason: "Trả hàng NCC" }, ACTOR))).toEqual({
      amount: 2_000_000,
      status: "paid",
    });
  });

  it("R-TC-12, R-TC-13: điều chỉnh về 0 và hủy khoản chưa trả", async () => {
    const p = await db.transaction((tx) =>
      openPayable(tx, { supplierId, categoryCode: "CHI-BAO-BI", source: { type: "manual" }, amount: 450_000, issuedOn: "2028-01-05", dueOn: "2028-01-05" }, ACTOR),
    );
    expect(await db.transaction((tx) => adjustDebtAmount(tx, { kind: "payable", debtId: p.id, newAmount: 0, reason: "Trả NCC hết 300 nhãn" }, ACTOR))).toEqual({
      amount: 450_000,
      status: "cancelled",
    });
    const [row] = await db.select().from(schema.payables).where(eq(schema.payables.id, p.id));
    expect(row!.cancelReason).toBe("Trả NCC hết 300 nhãn");

    const q = await db.transaction((tx) =>
      openPayable(tx, { supplierId, categoryCode: "CHI-BAO-BI", source: { type: "manual" }, amount: 100_000, issuedOn: "2028-01-05", dueOn: "2028-01-05" }, ACTOR),
    );
    expect(q.id).not.toBe(p.id); // nguồn tay không id: luôn tạo mới
    expect(await db.transaction((tx) => cancelDebt(tx, { kind: "payable", debtId: q.id, reason: "Ghi nhầm" }, ACTOR))).toEqual({ cancelled: true });
    expect(await db.transaction((tx) => cancelDebt(tx, { kind: "payable", debtId: q.id, reason: "Ghi nhầm" }, ACTOR))).toEqual({ cancelled: false });
    await expect(
      db.transaction((tx) => applyDebtPayment(tx, { kind: "payable", debtId: q.id, amount: 1, accountId: acc.NH!, paidOn: "2028-01-16" }, ACTOR)),
    ).rejects.toThrow("Khoản nợ đã hủy");
  });

  it("R-TC-9, R-TC-11, R-TC-15: phải thu đại lý tạo tay, trả 2 lần", async () => {
    const r = await db.transaction((tx) =>
      openReceivable(tx, { party: "dealer", dealerId, amount: 3_500_000, issuedOn: "2028-01-05", dueOn: "2028-02-04" }, ACTOR),
    );
    expect(r).toMatchObject({ created: true, code: "CNT-2801-0001" });
    await expect(db.transaction((tx) => openReceivable(tx, { party: "dealer", amount: 1, issuedOn: "2028-01-05", dueOn: "2028-01-05" }, ACTOR))).rejects.toThrow("Chọn đại lý");

    const a = await db.transaction((tx) => applyDebtPayment(tx, { kind: "receivable", debtId: r.id, amount: 1_500_000, accountId: acc.TM!, paidOn: "2028-01-20" }, ACTOR));
    expect(a).toMatchObject({ remaining: 2_000_000, status: "partial" });
    const b = await db.transaction((tx) => applyDebtPayment(tx, { kind: "receivable", debtId: r.id, amount: 2_000_000, accountId: acc.NH!, paidOn: "2028-01-25" }, ACTOR));
    expect(b).toMatchObject({ remaining: 0, status: "paid" });
    const [cash] = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, b.cashTxId));
    expect(cash).toMatchObject({ direction: "in", counterpartyType: "dealer", counterpartyId: dealerId, sourceType: "receivable", sourceId: r.id });

    // Phiếu từ thanh toán công nợ hủy được bằng cancelCashTransaction, paid_amount trừ theo (INV-6)
    expect(await db.transaction((tx) => cancelCashTransaction(tx, { id: a.cashTxId }, "Trả nhầm", ACTOR))).toEqual({ cancelled: true });
    const [after] = await db.select().from(schema.receivables).where(eq(schema.receivables.id, r.id));
    expect(after).toMatchObject({ paidAmount: 2_000_000, status: "partial" });

    await checkInv6();
    await checkInv7();
    await checkInv8();
  });
});
