// Công nợ cho màn hình Tài chính (05-tai-chinh.md R-TC-9…R-TC-15): tạo tay, thanh toán, hủy thanh toán,
// điều chỉnh, hủy, danh sách theo tuổi nợ. Ghi qua hàm dùng chung trong ledger.ts.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { cashAccounts, cashTransactions, customers, dealers, debtPayments, financeCategories, orders, payables, receivables, salesChannels, suppliers } from "@/db/schema";
import { UserError } from "@/lib/errors";
import { formatVnd } from "@/lib/format";
import { vnToday } from "@/modules/numbering";
import { accountBalance, adjustDebtAmount, applyDebtPayment, cancelDebt, cancelDebtPayment, openPayable, openReceivable, type DebtStatus } from "./ledger";
import { addDaysIso, agingBucket, isDueSoon, isIsoDate, isOpenDebt, overdueDays, type AgingBucket } from "./rules";

export type DebtKind = "receivable" | "payable";
export const DEBT_KIND_SLUG: Record<DebtKind, string> = { receivable: "phai-thu", payable: "phai-tra" };
export function debtKindFromSlug(slug: string): DebtKind | null {
  return slug === "phai-thu" ? "receivable" : slug === "phai-tra" ? "payable" : null;
}

// R-TC-9 · Tạo tay phải thu: khách hoặc đại lý
export async function createManualReceivable(
  db: Db,
  input: { party: "customer" | "dealer"; customerId?: string | null; dealerId?: string | null; amount: number; issuedOn: string; dueOn: string; note?: string | null },
  actorId: string,
): Promise<{ id: string; code: string }> {
  return db.transaction(async (tx) => {
    const res = await openReceivable(tx, { party: input.party, customerId: input.customerId ?? null, dealerId: input.dealerId ?? null, amount: input.amount, issuedOn: input.issuedOn, dueOn: input.dueOn, note: input.note ?? null }, actorId);
    return { id: res.id, code: res.code };
  });
}

// R-TC-10 · Tạo tay phải trả: hạn mặc định = ngày + payment_terms_days của NCC
export async function createManualPayable(
  db: Db,
  input: { supplierId: string; categoryId: string; amount: number; issuedOn: string; dueOn?: string | null; note?: string | null },
  actorId: string,
): Promise<{ id: string; code: string }> {
  if (!isIsoDate(input.issuedOn)) throw new UserError("Ngày ghi nợ không hợp lệ");
  return db.transaction(async (tx) => {
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw new UserError("Chọn nhà cung cấp");
    const [category] = await tx.select().from(financeCategories).where(eq(financeCategories.id, input.categoryId));
    if (!category || category.direction !== "out") throw new UserError("Chọn hạng mục chi");
    const dueOn = input.dueOn || addDaysIso(input.issuedOn, supplier.paymentTermsDays);
    const res = await openPayable(tx, { supplierId: supplier.id, categoryCode: category.code, source: { type: "manual" }, amount: input.amount, issuedOn: input.issuedOn, dueOn, note: input.note ?? null }, actorId);
    return { id: res.id, code: res.code };
  });
}

// R-TC-11 · Thanh toán từng phần; ngày trả ≤ hôm nay (R-TC-2)
// expectedPaidAmount (bắt buộc): số đã trả lúc người gọi đọc khoản nợ; form gửi lại hoặc hai tab cùng ghi
// → lần sau bị từ chối (AC-TC-9). Bắt buộc để mọi lối gọi mới (API, nhập file, việc nền) không bỏ qua chống ghi trùng.
export async function payDebt(
  db: Db,
  input: { kind: DebtKind; debtId: string; amount: number; accountId: string; paidOn: string; note?: string | null; expectedPaidAmount: number },
  actorId: string,
  today: string = vnToday(),
): Promise<{ remaining: number; status: DebtStatus; warning: string | null }> {
  if (!isIsoDate(input.paidOn)) throw new UserError("Ngày trả không hợp lệ");
  if (input.paidOn > today) throw new UserError("Ngày trả không được sau hôm nay");
  return db.transaction(async (tx) => {
    const res = await applyDebtPayment(tx, input, actorId);
    let warning: string | null = null;
    if (input.kind === "payable") {
      const [acc] = await tx.select({ kind: cashAccounts.kind, name: cashAccounts.name }).from(cashAccounts).where(eq(cashAccounts.id, input.accountId));
      if (acc && acc.kind !== "cash") {
        const balance = await accountBalance(tx, input.accountId);
        if (balance < 0) warning = `Lưu ý: ${acc.name} đang âm ${formatVnd(-balance)}`;
      }
    }
    return { remaining: res.remaining, status: res.status, warning };
  });
}

// R-TC-11 · Hủy thanh toán (finance.approve ở trang gọi)
export async function cancelPayment(db: Db, paymentId: string, reason: string, actorId: string): Promise<void> {
  if (!reason.trim()) throw new UserError("Ghi lý do hủy thanh toán");
  await db.transaction(async (tx) => {
    const res = await cancelDebtPayment(tx, paymentId, reason, actorId);
    if (!res.cancelled) throw new UserError("Lần thanh toán đã được hủy trước đó");
  });
}

export async function adjustDebt(db: Db, input: { kind: DebtKind; debtId: string; newAmount: number; reason: string }, actorId: string) {
  return db.transaction((tx) => adjustDebtAmount(tx, input, actorId));
}

export async function cancelDebtManually(db: Db, input: { kind: DebtKind; debtId: string; reason: string }, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const res = await cancelDebt(tx, input, actorId);
    if (!res.cancelled) throw new UserError("Khoản nợ đã hủy trước đó");
  });
}

// ---------------------------------------------------------------------------------------------
// Danh sách (R-TC-14)

export type DebtRow = {
  id: string;
  code: string;
  partyKey: string;
  partyName: string;
  partyKind: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  status: DebtStatus;
  issuedOn: string;
  dueOn: string;
  overdueDays: number;
  bucket: AgingBucket | null;
  dueSoon: boolean;
  sourceLabel: string;
  note: string | null;
};

function decorate(
  base: Omit<DebtRow, "remaining" | "overdueDays" | "bucket" | "dueSoon">,
  today: string,
  dueSoonDays: number,
): DebtRow {
  const open = isOpenDebt(base.status);
  return {
    ...base,
    remaining: base.status === "cancelled" ? 0 : base.amount - base.paidAmount,
    overdueDays: open ? Math.max(0, overdueDays(base.dueOn, today)) : 0,
    bucket: open ? agingBucket(base.dueOn, today) : null,
    dueSoon: open && isDueSoon(base.dueOn, today, dueSoonDays),
  };
}

export async function listReceivables(db: Db | Tx, opts: { today?: string; dueSoonDays?: number; status?: DebtStatus | "open_all" } = {}): Promise<DebtRow[]> {
  const today = opts.today ?? vnToday();
  const where =
    opts.status === "open_all" ? inArray(receivables.status, ["open", "partial"]) : opts.status ? eq(receivables.status, opts.status) : undefined;
  const rows = await db
    .select({
      r: receivables,
      customerName: customers.name,
      dealerName: dealers.name,
      channelName: salesChannels.name,
      orderCode: orders.code,
    })
    .from(receivables)
    .leftJoin(customers, eq(customers.id, receivables.customerId))
    .leftJoin(dealers, eq(dealers.id, receivables.dealerId))
    .leftJoin(salesChannels, eq(salesChannels.code, receivables.channelCode))
    .leftJoin(orders, eq(orders.id, receivables.orderId))
    .where(where)
    .orderBy(asc(receivables.dueOn), asc(receivables.code));
  return rows.map(({ r, customerName, dealerName, channelName, orderCode }) =>
    decorate(
      {
        id: r.id,
        code: r.code,
        partyKey: r.party === "dealer" ? `dealer:${r.dealerId}` : r.party === "channel" ? `channel:${r.channelCode}` : `customer:${r.customerId}`,
        partyName: r.party === "dealer" ? (dealerName ?? "Đại lý") : r.party === "channel" ? (channelName ?? r.channelCode ?? "Kênh") : (customerName ?? "Khách"),
        partyKind: r.party === "dealer" ? "Đại lý" : r.party === "channel" ? "Sàn" : "Khách",
        amount: r.amount,
        paidAmount: r.paidAmount,
        status: r.status,
        issuedOn: r.issuedOn,
        dueOn: r.dueOn,
        sourceLabel: orderCode ? `Đơn ${orderCode}` : "Tạo tay",
        note: r.note,
      },
      today,
      opts.dueSoonDays ?? 7,
    ),
  );
}

const PAYABLE_SOURCE_LABEL: Record<string, string> = { stock_receipt: "Phiếu nhập", production_order: "Lệnh gia công", extraction_run: "Mẻ chiết thuê lò", manual: "Tạo tay" };

export async function listPayables(db: Db | Tx, opts: { today?: string; dueSoonDays?: number; status?: DebtStatus | "open_all" } = {}): Promise<DebtRow[]> {
  const today = opts.today ?? vnToday();
  const where = opts.status === "open_all" ? inArray(payables.status, ["open", "partial"]) : opts.status ? eq(payables.status, opts.status) : undefined;
  const rows = await db
    .select({ p: payables, supplierName: suppliers.name })
    .from(payables)
    .innerJoin(suppliers, eq(suppliers.id, payables.supplierId))
    .where(where)
    .orderBy(asc(payables.dueOn), asc(payables.code));
  return rows.map(({ p, supplierName }) =>
    decorate(
      {
        id: p.id,
        code: p.code,
        partyKey: `supplier:${p.supplierId}`,
        partyName: supplierName,
        partyKind: "Nhà cung cấp",
        amount: p.amount,
        paidAmount: p.paidAmount,
        status: p.status,
        issuedOn: p.issuedOn,
        dueOn: p.dueOn,
        sourceLabel: `${PAYABLE_SOURCE_LABEL[p.sourceType] ?? p.sourceType}${p.sourceCode ? ` ${p.sourceCode}` : ""}`,
        note: p.note,
      },
      today,
      opts.dueSoonDays ?? 7,
    ),
  );
}

// Theo đối tượng: tổng còn lại và quá hạn
export function groupByParty(rows: DebtRow[]): { partyKey: string; partyName: string; partyKind: string; remaining: number; overdue: number; count: number }[] {
  const map = new Map<string, { partyKey: string; partyName: string; partyKind: string; remaining: number; overdue: number; count: number }>();
  for (const r of rows) {
    if (!isOpenDebt(r.status)) continue;
    const g = map.get(r.partyKey) ?? { partyKey: r.partyKey, partyName: r.partyName, partyKind: r.partyKind, remaining: 0, overdue: 0, count: 0 };
    g.remaining += r.remaining;
    if (r.overdueDays > 0) g.overdue += r.remaining;
    g.count += 1;
    map.set(r.partyKey, g);
  }
  return [...map.values()].sort((a, b) => b.remaining - a.remaining);
}

// R-TC-15 · Dư nợ đại lý
export async function dealerOutstanding(db: Db | Tx, dealerId: string): Promise<number> {
  const [row] = await db
    .select({ s: sql<string>`coalesce(sum(${receivables.amount} - ${receivables.paidAmount}), 0)` })
    .from(receivables)
    .where(and(eq(receivables.dealerId, dealerId), inArray(receivables.status, ["open", "partial"])));
  return Number(row?.s ?? 0);
}

// Chi tiết: nguồn, lịch sử thanh toán
export async function getDebt(db: Db, kind: DebtKind, id: string, today: string = vnToday()) {
  const list = kind === "receivable" ? await listReceivables(db, { today }) : await listPayables(db, { today });
  const row = list.find((d) => d.id === id);
  if (!row) return null;
  let sourceHref: string | null = null;
  let categoryName: string | null = null;
  if (kind === "receivable") {
    const [r] = await db.select({ orderId: receivables.orderId }).from(receivables).where(eq(receivables.id, id));
    if (r?.orderId) sourceHref = `/admin/don-hang/${r.orderId}`;
  } else {
    const [p] = await db
      .select({ sourceType: payables.sourceType, sourceId: payables.sourceId, categoryName: financeCategories.name })
      .from(payables)
      .innerJoin(financeCategories, eq(financeCategories.id, payables.categoryId))
      .where(eq(payables.id, id));
    categoryName = p?.categoryName ?? null;
    if (p?.sourceId) {
      sourceHref =
        p.sourceType === "stock_receipt" ? `/admin/kho/nhap/${p.sourceId}` : p.sourceType === "production_order" ? `/admin/san-xuat/lenh/${p.sourceId}` : p.sourceType === "extraction_run" ? `/admin/san-xuat/chiet-xuat/${p.sourceId}` : null;
    }
  }
  const [cancelInfo] =
    kind === "receivable"
      ? await db.select({ cancelReason: receivables.cancelReason }).from(receivables).where(eq(receivables.id, id))
      : await db.select({ cancelReason: payables.cancelReason }).from(payables).where(eq(payables.id, id));
  const payments = await db
    .select({
      id: debtPayments.id,
      amount: debtPayments.amount,
      paidOn: debtPayments.paidOn,
      cashTxId: cashTransactions.id,
      cashCode: cashTransactions.code,
      cashStatus: cashTransactions.status,
      cancelReason: cashTransactions.cancelReason,
      accountName: cashAccounts.name,
    })
    .from(debtPayments)
    .innerJoin(cashTransactions, eq(cashTransactions.id, debtPayments.cashTransactionId))
    .innerJoin(cashAccounts, eq(cashAccounts.id, cashTransactions.accountId))
    .where(kind === "receivable" ? eq(debtPayments.receivableId, id) : eq(debtPayments.payableId, id))
    .orderBy(desc(debtPayments.createdAt));
  return { ...row, sourceHref, categoryName, cancelReason: cancelInfo?.cancelReason ?? null, payments };
}
