// Tài chính: sổ quỹ và công nợ dùng chung (00-tong-quan.md mục 8.5, 05-tai-chinh.md R-TC-1…R-TC-15).
// Mọi hàm ghi chạy trong giao dịch của người gọi. Lỗi nghiệp vụ ném UserError (câu hiện cho người dùng),
// nên người gọi để giao dịch hủy toàn bộ.
import { randomUUID } from "node:crypto";
import { and, eq, lte, ne, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { cashAccounts, cashTransactions, debtPayments, financeCategories, payables, receivables } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { formatVnd } from "@/lib/format";
import { nextDocCode } from "@/modules/numbering";
import { applyOrderPaymentStatus } from "@/modules/orders/payment";
import { cancelledIdempotencyKey, debtStatusAfterAdjust, debtStatusFor, docDate, staleDebtPayment, validateDebtPayment, wouldOverdraw } from "./ledger-rules";

export type DebtStatus = "open" | "partial" | "paid" | "cancelled";
export type CashTxInput = {
  direction: "in" | "out";
  accountId?: string | null;
  accountCode?: string | null;
  amount: number;
  categoryCode: string;
  occurredOn: string;
  counterparty?: { type: "customer" | "dealer" | "supplier" | "channel" | "staff" | "other"; id?: string | null; name?: string | null } | null;
  channelCode?: string | null;
  source?: { type: string; id: string; code?: string | null } | null;
  idempotencyKey?: string | null;
  note?: string | null;
  fileIds?: string[];
  status?: "posted" | "pending_approval";
};
export type ReceivableInput = {
  party: "customer" | "dealer" | "channel";
  customerId?: string | null;
  dealerId?: string | null;
  channelCode?: string | null;
  orderId?: string | null;
  amount: number;
  issuedOn: string;
  dueOn: string;
  note?: string | null;
};
export type PayableInput = {
  supplierId: string;
  categoryCode: string;
  source: { type: "stock_receipt" | "production_order" | "extraction_run" | "manual"; id?: string | null; code?: string | null };
  amount: number;
  issuedOn: string;
  dueOn: string;
  note?: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string, label: string) {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new UserError(`${label} không hợp lệ`);
}

function assertMoney(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserError("Số tiền phải là số nguyên lớn hơn 0");
}

// Số dư tại ngày asOf = opening_balance + phiếu posted có occurred_on ≤ asOf (R-TC-1, INV-7)
export async function accountBalance(db: Db | Tx, accountId: string, asOf?: string): Promise<number> {
  const [account] = await db.select({ opening: cashAccounts.openingBalance }).from(cashAccounts).where(eq(cashAccounts.id, accountId));
  if (!account) throw new UserError("Không tìm thấy tài khoản tiền");
  const conds = [eq(cashTransactions.status, "posted"), or(eq(cashTransactions.accountId, accountId), eq(cashTransactions.toAccountId, accountId))];
  if (asOf) conds.push(lte(cashTransactions.occurredOn, asOf));
  const [row] = await db
    .select({
      delta: sql<string>`coalesce(sum(case
        when ${cashTransactions.direction} = 'in' and ${cashTransactions.accountId} = ${accountId} then ${cashTransactions.amount}::bigint
        when ${cashTransactions.direction} in ('out', 'transfer') and ${cashTransactions.accountId} = ${accountId} then -${cashTransactions.amount}::bigint
        else 0 end)
        + sum(case when ${cashTransactions.direction} = 'transfer' and ${cashTransactions.toAccountId} = ${accountId} then ${cashTransactions.amount}::bigint else 0 end), 0)`,
    })
    .from(cashTransactions)
    .where(and(...conds));
  return account.opening + Number(row?.delta ?? 0);
}

// idempotencyKey đã có (phiếu chưa hủy) → trả phiếu cũ, created: false (R-TC-7, INV-8)
export async function recordCashTransaction(tx: Tx, input: CashTxInput, actorId: string | null): Promise<{ id: string; code: string; created: boolean }> {
  const key = input.idempotencyKey?.trim() || null;
  if (key) {
    const existing = await findByKey(tx, key);
    if (existing) return { id: existing.id, code: existing.code, created: false };
  }

  assertMoney(input.amount);
  assertDate(input.occurredOn, "Ngày phiếu");
  const status = input.status ?? "posted";
  if (status === "pending_approval" && input.direction !== "out") throw new UserError("Chỉ phiếu chi mới cần duyệt");

  const account = await tx.query.cashAccounts.findFirst({
    where: input.accountId ? eq(cashAccounts.id, input.accountId) : input.accountCode ? eq(cashAccounts.code, input.accountCode) : sql`false`,
  });
  if (!account) throw new UserError("Không tìm thấy tài khoản tiền");
  if (!account.isActive) throw new UserError(`Tài khoản ${account.name} đã ngừng dùng`);

  const category = await tx.query.financeCategories.findFirst({ where: eq(financeCategories.code, input.categoryCode) });
  if (!category || !category.isActive) throw new UserError("Không tìm thấy hạng mục thu chi");
  if (category.direction !== input.direction) throw new UserError(`Hạng mục ${category.name} không dùng cho phiếu ${input.direction === "in" ? "thu" : "chi"}`);

  // Không để tiền mặt âm (R-TC-4). Khóa dòng tài khoản để hai phiếu chi cùng lúc không cùng lọt.
  if (input.direction === "out" && status === "posted" && account.kind === "cash") {
    await tx.select({ id: cashAccounts.id }).from(cashAccounts).where(eq(cashAccounts.id, account.id)).for("update");
    const balance = await accountBalance(tx, account.id, input.occurredOn);
    if (wouldOverdraw(balance, input.amount)) throw new UserError(`Tiền mặt chỉ còn ${formatVnd(balance)}`);
  }

  const code = await nextDocCode(tx, input.direction === "in" ? "PT" : "PC", docDate(input.occurredOn));
  const now = new Date();
  const [row] = await tx
    .insert(cashTransactions)
    .values({
      code,
      direction: input.direction,
      status,
      accountId: account.id,
      amount: input.amount,
      categoryId: category.id,
      occurredOn: input.occurredOn,
      counterpartyType: input.counterparty?.type ?? null,
      counterpartyId: input.counterparty?.id ?? null,
      counterpartyName: input.counterparty?.name?.trim() ?? "",
      channelCode: input.channelCode ?? null,
      sourceType: input.source?.type ?? null,
      sourceId: input.source?.id ?? null,
      sourceCode: input.source?.code ?? null,
      idempotencyKey: key,
      note: input.note?.trim() || null,
      fileIds: input.fileIds ?? [],
      createdBy: actorId,
      approvedBy: status === "posted" ? actorId : null,
      approvedAt: status === "posted" ? now : null,
    })
    // Hai giao dịch cùng ghi một khóa: giao dịch sau không chèn được, trả phiếu của giao dịch trước
    .onConflictDoNothing({ target: cashTransactions.idempotencyKey })
    .returning({ id: cashTransactions.id, code: cashTransactions.code });
  if (!row) {
    const existing = key ? await findByKey(tx, key) : null;
    if (!existing) throw new Error("Không ghi được phiếu thu chi");
    return { id: existing.id, code: existing.code, created: false };
  }

  await writeAudit(tx, {
    actorId,
    action: "cash_tx.created",
    entity: "cash_transactions",
    entityId: row.id,
    after: { code, direction: input.direction, status, account: account.code, amount: input.amount, category: category.code, occurredOn: input.occurredOn, idempotencyKey: key, source: input.source ?? null },
  });
  return { id: row.id, code: row.code, created: true };
}

async function findByKey(db: Db | Tx, key: string) {
  const [row] = await db.select({ id: cashTransactions.id, code: cashTransactions.code }).from(cashTransactions).where(eq(cashTransactions.idempotencyKey, key));
  return row ?? null;
}

// Hủy phiếu (posted hoặc pending_approval). Khóa idempotency được giải phóng bằng đổi thành `<khóa>#cancelled-<id>` (R-TC-7).
// Phiếu của một lần thanh toán công nợ: hủy luôn lần thanh toán đó (trừ paid_amount) để INV-6 còn đúng (R-TC-11 "Hủy thanh toán").
// Hạn chế "chỉ phiếu tay" của R-TC-6 thuộc màn hình Tài chính, không thuộc hàm này (các nghiệp vụ gốc tự hủy phiếu của mình).
export async function cancelCashTransaction(tx: Tx, ref: { id?: string; idempotencyKey?: string }, reason: string, actorId: string | null): Promise<{ cancelled: boolean }> {
  if (!reason.trim()) throw new UserError("Cần ghi lý do hủy");
  const where = ref.id ? eq(cashTransactions.id, ref.id) : ref.idempotencyKey ? eq(cashTransactions.idempotencyKey, ref.idempotencyKey) : null;
  if (!where) throw new Error("cancelCashTransaction cần id hoặc idempotencyKey");
  const [cashTx] = await tx.select().from(cashTransactions).where(where).for("update");
  if (!cashTx || cashTx.status === "cancelled") return { cancelled: false };

  const [payment] = await tx.select().from(debtPayments).where(eq(debtPayments.cashTransactionId, cashTx.id));
  if (payment) {
    await reverseDebtPayment(tx, payment, actorId);
  }

  const updated = await tx
    .update(cashTransactions)
    .set({
      status: "cancelled",
      cancelledBy: actorId,
      cancelledAt: new Date(),
      cancelReason: reason.trim(),
      idempotencyKey: cashTx.idempotencyKey ? cancelledIdempotencyKey(cashTx.idempotencyKey, cashTx.id) : null,
    })
    .where(and(eq(cashTransactions.id, cashTx.id), ne(cashTransactions.status, "cancelled")))
    .returning({ id: cashTransactions.id });
  if (updated.length === 0) throw new UserError("Phiếu vừa được người khác cập nhật, tải lại trang.");

  await writeAudit(tx, {
    actorId,
    action: "cash_tx.cancelled",
    entity: "cash_transactions",
    entityId: cashTx.id,
    before: { status: cashTx.status, idempotencyKey: cashTx.idempotencyKey },
    after: { status: "cancelled", reason: reason.trim(), debtPaymentId: payment?.id ?? null },
  });
  return { cancelled: true };
}

// Hủy một lần thanh toán công nợ (R-TC-11 "Hủy thanh toán"): hủy phiếu thu/chi tương ứng, trừ paid_amount, tính lại trạng thái.
// Thêm ngoài chữ ký mục 8.5 cho màn hình Công nợ; thực chất gọi cancelCashTransaction.
export async function cancelDebtPayment(tx: Tx, paymentId: string, reason: string, actorId: string | null): Promise<{ cancelled: boolean }> {
  const [payment] = await tx.select().from(debtPayments).where(eq(debtPayments.id, paymentId));
  if (!payment) throw new UserError("Không tìm thấy lần thanh toán");
  return cancelCashTransaction(tx, { id: payment.cashTransactionId }, reason, actorId);
}

async function reverseDebtPayment(tx: Tx, payment: typeof debtPayments.$inferSelect, actorId: string | null) {
  const table = payment.receivableId ? receivables : payables;
  const debtId = (payment.receivableId ?? payment.payableId)!;
  const [debt] = await tx.select().from(table).where(eq(table.id, debtId)).for("update");
  if (!debt) throw new Error("Không tìm thấy khoản nợ của lần thanh toán");
  const paid = debt.paidAmount - payment.amount;
  if (paid < 0) throw new Error("paid_amount âm khi hủy thanh toán");
  const status = debt.status === "cancelled" ? "cancelled" : debtStatusFor(debt.amount, paid);
  const updated = await tx
    .update(table)
    .set({ paidAmount: paid, status, updatedAt: new Date() })
    .where(and(eq(table.id, debtId), eq(table.paidAmount, debt.paidAmount)))
    .returning({ id: table.id });
  if (updated.length === 0) throw new UserError("Khoản nợ vừa được người khác cập nhật, tải lại trang.");
  await writeAudit(tx, {
    actorId,
    action: "debt.payment_cancelled",
    entity: payment.receivableId ? "receivables" : "payables",
    entityId: debtId,
    before: { paidAmount: debt.paidAmount, status: debt.status },
    after: { paidAmount: paid, status, paymentId: payment.id, amount: payment.amount },
  });
  if (payment.receivableId && "orderId" in debt && debt.orderId && debt.status === "paid" && status !== "paid") {
    await applyOrderPaymentStatus(tx, debt.orderId, "unpaid", actorId, { source: "receivable", expectedFrom: "paid" });
  }
}

// Mỗi đơn tối đa một khoản phải thu: theo orderId là idempotent (R-TC-9, INV-8)
export async function openReceivable(tx: Tx, input: ReceivableInput, actorId: string | null): Promise<{ id: string; code: string; created: boolean }> {
  if (input.orderId) {
    const [existing] = await tx.select({ id: receivables.id, code: receivables.code }).from(receivables).where(eq(receivables.orderId, input.orderId));
    if (existing) return { ...existing, created: false };
  }
  assertMoney(input.amount);
  assertDate(input.issuedOn, "Ngày ghi nợ");
  assertDate(input.dueOn, "Hạn trả");
  if (input.dueOn < input.issuedOn) throw new UserError("Hạn trả phải từ ngày ghi nợ trở đi");
  if (input.party === "customer" && !input.customerId) throw new UserError("Chọn khách hàng");
  if (input.party === "dealer" && !input.dealerId) throw new UserError("Chọn đại lý");
  if (input.party === "channel" && !input.channelCode) throw new UserError("Chọn kênh bán");

  const code = await nextDocCode(tx, "CNT", docDate(input.issuedOn));
  const [row] = await tx
    .insert(receivables)
    .values({
      code,
      party: input.party,
      customerId: input.party === "customer" ? input.customerId! : (input.customerId ?? null),
      dealerId: input.party === "dealer" ? input.dealerId! : null,
      channelCode: input.party === "channel" ? input.channelCode! : null,
      orderId: input.orderId ?? null,
      amount: input.amount,
      issuedOn: input.issuedOn,
      dueOn: input.dueOn,
      note: input.note?.trim() || null,
      createdBy: actorId,
    })
    .onConflictDoNothing({ target: receivables.orderId })
    .returning({ id: receivables.id, code: receivables.code });
  if (!row) {
    const [existing] = await tx.select({ id: receivables.id, code: receivables.code }).from(receivables).where(eq(receivables.orderId, input.orderId!));
    if (!existing) throw new Error("Không ghi được khoản phải thu");
    return { ...existing, created: false };
  }
  await writeAudit(tx, {
    actorId,
    action: "receivable.created",
    entity: "receivables",
    entityId: row.id,
    after: { code, party: input.party, orderId: input.orderId ?? null, amount: input.amount, issuedOn: input.issuedOn, dueOn: input.dueOn },
  });
  return { ...row, created: true };
}

// Một nguồn một khoản: theo (source.type, source.id) là idempotent (R-TC-10). Nguồn tay (không id) luôn tạo mới.
export async function openPayable(tx: Tx, input: PayableInput, actorId: string | null): Promise<{ id: string; code: string; created: boolean }> {
  const sourceId = input.source.id ?? null;
  if (sourceId) {
    const existing = await payableBySource(tx, input.source.type, sourceId);
    if (existing) return { id: existing.id, code: existing.code, created: false };
  }
  assertMoney(input.amount);
  assertDate(input.issuedOn, "Ngày ghi nợ");
  assertDate(input.dueOn, "Hạn trả");
  if (input.dueOn < input.issuedOn) throw new UserError("Hạn trả phải từ ngày ghi nợ trở đi");
  const category = await tx.query.financeCategories.findFirst({ where: eq(financeCategories.code, input.categoryCode) });
  if (!category || category.direction !== "out") throw new UserError("Hạng mục chi không hợp lệ");

  const code = await nextDocCode(tx, "CNP", docDate(input.issuedOn));
  const values = {
    code,
    supplierId: input.supplierId,
    categoryId: category.id,
    sourceType: input.source.type,
    sourceId,
    sourceCode: input.source.code ?? null,
    amount: input.amount,
    issuedOn: input.issuedOn,
    dueOn: input.dueOn,
    note: input.note?.trim() || null,
    createdBy: actorId,
  };
  const inserted = sourceId
    ? await tx
        .insert(payables)
        .values(values)
        .onConflictDoNothing({ target: [payables.sourceType, payables.sourceId], where: sql`${payables.sourceId} is not null` })
        .returning({ id: payables.id, code: payables.code })
    : await tx.insert(payables).values(values).returning({ id: payables.id, code: payables.code });
  const row = inserted[0];
  if (!row) {
    const existing = await payableBySource(tx, input.source.type, sourceId!);
    if (!existing) throw new Error("Không ghi được khoản phải trả");
    return { id: existing.id, code: existing.code, created: false };
  }
  await writeAudit(tx, {
    actorId,
    action: "payable.created",
    entity: "payables",
    entityId: row.id,
    after: { code, supplierId: input.supplierId, category: category.code, source: input.source, amount: input.amount, issuedOn: input.issuedOn, dueOn: input.dueOn },
  });
  return { ...row, created: true };
}

async function payableBySource(db: Db | Tx, sourceType: string, sourceId: string) {
  const [row] = await db.select().from(payables).where(and(eq(payables.sourceType, sourceType), eq(payables.sourceId, sourceId)));
  return row ?? null;
}

// Thanh toán từng phần (R-TC-11, INV-6). Hàm nền trong transaction của người gọi; lối gọi từ giao diện/API
// đi qua payDebt (debts.ts), nơi expectedPaidAmount là bắt buộc. Phải thu của đơn trả đủ → applyOrderPaymentStatus(paid, source receivable).
export async function applyDebtPayment(
  tx: Tx,
  input: { kind: "receivable" | "payable"; debtId: string; amount: number; accountId: string; paidOn: string; note?: string | null; expectedPaidAmount?: number | null },
  actorId: string,
): Promise<{ paymentId: string; cashTxId: string; remaining: number; status: DebtStatus }> {
  assertDate(input.paidOn, "Ngày trả");
  const isReceivable = input.kind === "receivable";
  const table = isReceivable ? receivables : payables;
  const [debt] = await tx.select().from(table).where(eq(table.id, input.debtId)).for("update");
  if (!debt) throw new UserError("Không tìm thấy khoản nợ");
  // Đã khóa dòng: so số đã trả với số form đọc được (AC-TC-9), rồi mới kiểm số còn nợ
  const stale = staleDebtPayment(input.expectedPaidAmount, debt.paidAmount);
  if (stale) throw new UserError(stale);
  const problem = validateDebtPayment(debt, input.amount);
  if (problem) throw new UserError(problem);

  const paymentId = randomUUID();
  let counterparty: CashTxInput["counterparty"];
  let categoryCode: string;
  if (isReceivable) {
    const r = debt as typeof receivables.$inferSelect;
    categoryCode = "THU-CONG-NO";
    counterparty =
      r.party === "dealer"
        ? { type: "dealer", id: r.dealerId }
        : r.party === "channel"
          ? { type: "channel", id: null, name: r.channelCode }
          : { type: "customer", id: r.customerId };
  } else {
    const p = debt as typeof payables.$inferSelect;
    const [category] = await tx.select({ code: financeCategories.code }).from(financeCategories).where(eq(financeCategories.id, p.categoryId));
    categoryCode = category!.code;
    counterparty = { type: "supplier", id: p.supplierId };
  }

  const cash = await recordCashTransaction(
    tx,
    {
      direction: isReceivable ? "in" : "out",
      accountId: input.accountId,
      amount: input.amount,
      categoryCode,
      occurredOn: input.paidOn,
      counterparty,
      source: { type: input.kind, id: debt.id, code: debt.code },
      idempotencyKey: `debt-payment:${paymentId}`,
      note: input.note ?? null,
    },
    actorId,
  );

  const paid = debt.paidAmount + input.amount;
  const status = debtStatusFor(debt.amount, paid);
  const updated = await tx
    .update(table)
    .set({ paidAmount: paid, status, updatedAt: new Date() })
    .where(and(eq(table.id, debt.id), eq(table.paidAmount, debt.paidAmount), ne(table.status, "cancelled")))
    .returning({ id: table.id });
  if (updated.length === 0) throw new UserError("Khoản nợ vừa được người khác cập nhật, tải lại trang.");

  await tx.insert(debtPayments).values({
    id: paymentId,
    receivableId: isReceivable ? debt.id : null,
    payableId: isReceivable ? null : debt.id,
    amount: input.amount,
    paidOn: input.paidOn,
    cashTransactionId: cash.id,
    createdBy: actorId,
  });
  await writeAudit(tx, {
    actorId,
    action: "debt.payment",
    entity: isReceivable ? "receivables" : "payables",
    entityId: debt.id,
    before: { paidAmount: debt.paidAmount, status: debt.status },
    after: { paidAmount: paid, status, paymentId, amount: input.amount, cashTxId: cash.id },
  });

  if (isReceivable && status === "paid") {
    const orderId = (debt as typeof receivables.$inferSelect).orderId;
    if (orderId) await applyOrderPaymentStatus(tx, orderId, "paid", actorId, { source: "receivable" });
  }
  return { paymentId, cashTxId: cash.id, remaining: debt.amount - paid, status };
}

// Điều chỉnh số nợ (R-TC-12)
export async function adjustDebtAmount(
  tx: Tx,
  input: { kind: "receivable" | "payable"; debtId: string; newAmount: number; reason: string },
  actorId: string | null,
): Promise<{ amount: number; status: DebtStatus }> {
  if (!input.reason.trim()) throw new UserError("Cần ghi lý do điều chỉnh");
  const table = input.kind === "receivable" ? receivables : payables;
  const [debt] = await tx.select().from(table).where(eq(table.id, input.debtId)).for("update");
  if (!debt) throw new UserError("Không tìm thấy khoản nợ");
  const next = debtStatusAfterAdjust(debt, input.newAmount);
  if ("error" in next) throw new UserError(next.error);

  const updated = await tx
    .update(table)
    .set({
      amount: next.amount,
      status: next.status,
      cancelReason: next.status === "cancelled" ? input.reason.trim() : debt.cancelReason,
      updatedAt: new Date(),
    })
    .where(and(eq(table.id, debt.id), eq(table.paidAmount, debt.paidAmount), eq(table.amount, debt.amount)))
    .returning({ id: table.id });
  if (updated.length === 0) throw new UserError("Khoản nợ vừa được người khác cập nhật, tải lại trang.");
  await writeAudit(tx, {
    actorId,
    action: "debt.adjusted",
    entity: input.kind === "receivable" ? "receivables" : "payables",
    entityId: debt.id,
    before: { amount: debt.amount, status: debt.status },
    after: { amount: next.amount, status: next.status, newAmount: input.newAmount, reason: input.reason.trim() },
  });

  // Phải thu của đơn: giữ trạng thái thanh toán đơn khớp với khoản nợ
  const orderId = input.kind === "receivable" ? (debt as typeof receivables.$inferSelect).orderId : null;
  if (orderId && next.status !== "cancelled") {
    if (next.status === "paid" && debt.status !== "paid") await applyOrderPaymentStatus(tx, orderId, "paid", actorId, { source: "receivable" });
    if (debt.status === "paid" && next.status !== "paid") await applyOrderPaymentStatus(tx, orderId, "unpaid", actorId, { source: "receivable", expectedFrom: "paid" });
  }
  return { amount: next.amount, status: next.status };
}

// Hủy khoản nợ (R-TC-13): chỉ khi chưa trả đồng nào
export async function cancelDebt(tx: Tx, input: { kind: "receivable" | "payable"; debtId: string; reason: string }, actorId: string | null): Promise<{ cancelled: boolean }> {
  if (!input.reason.trim()) throw new UserError("Cần ghi lý do hủy");
  const table = input.kind === "receivable" ? receivables : payables;
  const [debt] = await tx.select().from(table).where(eq(table.id, input.debtId)).for("update");
  if (!debt) throw new UserError("Không tìm thấy khoản nợ");
  if (debt.status === "cancelled") return { cancelled: false };
  if (debt.paidAmount > 0) throw new UserError(`Khoản nợ đã trả ${formatVnd(debt.paidAmount)}, hủy các lần thanh toán trước`);
  const updated = await tx
    .update(table)
    .set({ status: "cancelled", cancelReason: input.reason.trim(), updatedAt: new Date() })
    .where(and(eq(table.id, debt.id), eq(table.paidAmount, 0), ne(table.status, "cancelled")))
    .returning({ id: table.id });
  if (updated.length === 0) throw new UserError("Khoản nợ vừa được người khác cập nhật, tải lại trang.");
  await writeAudit(tx, {
    actorId,
    action: "debt.cancelled",
    entity: input.kind === "receivable" ? "receivables" : "payables",
    entityId: debt.id,
    before: { status: debt.status },
    after: { status: "cancelled", reason: input.reason.trim() },
  });
  return { cancelled: true };
}

export async function findDebtBySource(
  db: Db | Tx,
  input: { kind: "receivable"; orderId: string } | { kind: "payable"; sourceType: string; sourceId: string },
): Promise<{ id: string; amount: number; paidAmount: number; status: DebtStatus } | null> {
  if (input.kind === "receivable") {
    const [row] = await db
      .select({ id: receivables.id, amount: receivables.amount, paidAmount: receivables.paidAmount, status: receivables.status })
      .from(receivables)
      .where(eq(receivables.orderId, input.orderId));
    return row ?? null;
  }
  const row = await payableBySource(db, input.sourceType, input.sourceId);
  return row ? { id: row.id, amount: row.amount, paidAmount: row.paidAmount, status: row.status } : null;
}

// Dùng trong test và trang Tài chính: phiếu còn hiệu lực theo khóa
export async function findCashTransactionByKey(db: Db | Tx, key: string) {
  const [row] = await db.select().from(cashTransactions).where(and(eq(cashTransactions.idempotencyKey, key), ne(cashTransactions.status, "cancelled")));
  return row ?? null;
}

