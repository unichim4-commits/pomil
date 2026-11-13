// Tiện ích dùng chung cho test tích hợp T-19 (QA). Không phải file test: vitest chỉ chạy *.test.ts.
// Mỗi file test tự đặt PGLITE_DIR trước khi gọi getDb() (getDb đọc biến môi trường lúc gọi).
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import { auditLog, cashAccounts, cashTransactions, debtPayments, lots, orderItems, orders, payables, products, receivables, staffUsers, stockBalances, stockMovements } from "@/db/schema";
import { listAccountsWithBalance } from "@/modules/finance/cash";
import { previewInventoryTracking } from "@/modules/inventory/ledger";
import { lotBalance } from "@/modules/qms/trace";

export type Role = "owner" | "collaborator" | "viewer";
export type TestActor = { id: string; role: Role };

export async function tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

export async function makeStaff(prefix: string): Promise<{ owner: TestActor; collab: TestActor; viewer: TestActor }> {
  const db = await getDb();
  const mk = async (role: Role): Promise<TestActor> => {
    const [s] = await db.insert(staffUsers).values({ email: `${prefix}-${role}@qa.test`, name: `QA ${role}`, role, passwordHash: "x" }).returning({ id: staffUsers.id });
    return { id: s!.id, role };
  };
  return { owner: await mk("owner"), collab: await mk("collaborator"), viewer: await mk("viewer") };
}

export type InvReport = { inv: string; detail: string }[];

// Kiểm INV-1…INV-9 (00-tong-quan.md mục 13). Trả danh sách vi phạm (rỗng = đạt).
// releasedLotIds: các lô thành phẩm được duyệt trong test (lô seed/fixture chèn thẳng bảng không có audit).
export async function checkInvariants(opts: { releasedLotIds?: string[]; productLotIds?: string[] } = {}): Promise<InvReport> {
  const db = await getDb();
  const out: InvReport = [];

  // INV-1
  const neg = await db.select().from(stockBalances).where(sql`${stockBalances.qty} < 0`);
  for (const b of neg) out.push({ inv: "INV-1", detail: `số dư âm ${b.qty} ở lô ${b.stockLotId}` });

  // INV-2: tổng biến động theo (vị trí, lô) = số dư; dòng cuối có balance_after = số dư
  const sums = await db
    .select({ locationId: stockMovements.locationId, stockLotId: stockMovements.stockLotId, s: sql<string>`sum(${stockMovements.qty})` })
    .from(stockMovements)
    .groupBy(stockMovements.locationId, stockMovements.stockLotId);
  const bal = new Map((await db.select().from(stockBalances)).map((b) => [`${b.locationId}|${b.stockLotId}`, b.qty]));
  for (const s of sums) {
    const key = `${s.locationId}|${s.stockLotId}`;
    const b = bal.get(key) ?? 0;
    if (Number(s.s) !== b) out.push({ inv: "INV-2", detail: `tổng biến động ${s.s} ≠ số dư ${b} (${key})` });
    // Các dòng cùng giao dịch có cùng created_at: chỉ cần một dòng ở thời điểm cuối có balance_after = số dư
    const last = await db
      .select({ after: stockMovements.balanceAfter })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.locationId, s.locationId),
          eq(stockMovements.stockLotId, s.stockLotId),
          sql`${stockMovements.createdAt} = (select max(m2.created_at) from stock_movements m2 where m2.location_id = ${s.locationId} and m2.stock_lot_id = ${s.stockLotId})`,
        ),
      );
    if (!last.some((l) => l.after === b)) out.push({ inv: "INV-2", detail: `balance_after dòng cuối [${last.map((l) => l.after).join(",")}] ≠ số dư ${b} (${key})` });
  }
  for (const [key, q] of bal) if (q !== 0 && !sums.some((s) => `${s.locationId}|${s.stockLotId}` === key)) out.push({ inv: "INV-2", detail: `số dư ${q} không có biến động (${key})` });

  // INV-3
  const tracked = await db.select({ id: products.id, code: products.code, stock: products.stock }).from(products).where(eq(products.trackInventory, true));
  for (const p of tracked) {
    const pv = await previewInventoryTracking(db, p.id);
    if (pv.after !== p.stock) out.push({ inv: "INV-3", detail: `${p.code}: stock ${p.stock} ≠ max(0, khả dụng ${pv.availableFg} − giữ ${pv.reserved}) = ${pv.after}` });
  }

  // INV-4
  const os = await db.select().from(orders);
  const lineSums = new Map(
    (await db.select({ orderId: orderItems.orderId, s: sql<string>`sum(${orderItems.lineTotal})` }).from(orderItems).groupBy(orderItems.orderId)).map((r) => [r.orderId, Number(r.s)]),
  );
  for (const o of os) {
    const s = lineSums.get(o.id) ?? 0;
    if (s !== o.subtotal) out.push({ inv: "INV-4", detail: `${o.code}: tổng dòng ${s} ≠ subtotal ${o.subtotal}` });
    if (o.total !== o.subtotal - o.discountTotal + o.shippingFee) out.push({ inv: "INV-4", detail: `${o.code}: total ${o.total} ≠ ${o.subtotal} − ${o.discountTotal} + ${o.shippingFee}` });
  }

  // INV-5: cân đối lô thành phẩm
  for (const lotId of opts.productLotIds ?? []) {
    const b = await lotBalance(db, lotId);
    if (!b.balanced) out.push({ inv: "INV-5", detail: `lô ${lotId}: ${JSON.stringify(b)}` });
  }

  // INV-6
  for (const [kind, table, col] of [
    ["receivable", receivables, debtPayments.receivableId],
    ["payable", payables, debtPayments.payableId],
  ] as const) {
    const debts = await db.select({ id: table.id, code: table.code, amount: table.amount, paid: table.paidAmount }).from(table);
    for (const d of debts) {
      const [row] = await db
        .select({ s: sql<string>`coalesce(sum(${debtPayments.amount}), 0)` })
        .from(debtPayments)
        .innerJoin(cashTransactions, eq(cashTransactions.id, debtPayments.cashTransactionId))
        .where(and(eq(col, d.id), sql`${cashTransactions.status} <> 'cancelled'`));
      if (Number(row?.s ?? 0) !== d.paid) out.push({ inv: "INV-6", detail: `${kind} ${d.code}: paid_amount ${d.paid} ≠ tổng thanh toán ${row?.s}` });
      if (d.paid > d.amount) out.push({ inv: "INV-6", detail: `${kind} ${d.code}: paid ${d.paid} > amount ${d.amount}` });
    }
  }

  // INV-7: tính độc lập từ phiếu posted
  const accounts = await db.select().from(cashAccounts);
  const listed = new Map((await listAccountsWithBalance(db)).map((a) => [a.id, a.balance]));
  const txs = await db.select().from(cashTransactions).where(eq(cashTransactions.status, "posted"));
  for (const a of accounts) {
    let b = a.openingBalance;
    for (const t of txs) {
      if (t.direction === "in" && t.accountId === a.id) b += t.amount;
      if ((t.direction === "out" || t.direction === "transfer") && t.accountId === a.id) b -= t.amount;
      if (t.direction === "transfer" && t.toAccountId === a.id) b += t.amount;
    }
    if (listed.has(a.id) && listed.get(a.id) !== b) out.push({ inv: "INV-7", detail: `${a.code}: số dư hệ thống ${listed.get(a.id)} ≠ tính lại ${b}` });
  }

  // INV-8
  const dupKeys = await db
    .select({ k: cashTransactions.idempotencyKey, n: sql<number>`count(*)::int` })
    .from(cashTransactions)
    .where(and(isNotNull(cashTransactions.idempotencyKey), sql`${cashTransactions.status} <> 'cancelled'`))
    .groupBy(cashTransactions.idempotencyKey)
    .having(sql`count(*) > 1`);
  for (const d of dupKeys) out.push({ inv: "INV-8", detail: `khóa ${d.k} có ${d.n} phiếu` });
  const dupAr = await db
    .select({ o: receivables.orderId, n: sql<number>`count(*)::int` })
    .from(receivables)
    .where(and(isNotNull(receivables.orderId), sql`${receivables.status} <> 'cancelled'`))
    .groupBy(receivables.orderId)
    .having(sql`count(*) > 1`);
  for (const d of dupAr) out.push({ inv: "INV-8", detail: `đơn ${d.o} có ${d.n} khoản phải thu` });
  const dupRev = await db
    .select({ r: stockMovements.reversalOf, n: sql<number>`count(*)::int` })
    .from(stockMovements)
    .where(isNotNull(stockMovements.reversalOf))
    .groupBy(stockMovements.reversalOf)
    .having(sql`count(*) > 1`);
  for (const d of dupRev) out.push({ inv: "INV-8", detail: `biến động ${d.r} bị đảo ${d.n} lần` });

  // INV-9
  if (opts.releasedLotIds?.length) {
    const rel = await db.select({ id: lots.id, lotNo: lots.lotNo }).from(lots).where(and(inArray(lots.id, opts.releasedLotIds), isNotNull(lots.releasedAt)));
    for (const l of rel) {
      const a = await db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, "lot.released"), eq(auditLog.entityId, l.id)));
      if (a.length !== 1) out.push({ inv: "INV-9", detail: `lô ${l.lotNo}: ${a.length} dòng audit lot.released` });
    }
  }
  return out;
}
