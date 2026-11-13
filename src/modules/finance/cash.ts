// Sổ quỹ cho màn hình Tài chính: phiếu tay, đề nghị chi và duyệt, chuyển quỹ, đối soát COD, hủy phiếu tay,
// đối chiếu quỹ, tài khoản và hạng mục (05-tai-chinh.md R-TC-1…R-TC-8). Ghi sổ qua ledger.ts (hàm dùng chung).
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db/client";
import { cashAccounts, cashReconciliations, cashTransactions, financeCategories, staffUsers } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { formatVnd } from "@/lib/format";
import { nextDocCode, vnToday } from "@/modules/numbering";
import { accountBalance, cancelCashTransaction, recordCashTransaction, type CashTxInput } from "./ledger";
import { docDate, wouldOverdraw } from "./ledger-rules";
import { codSettlement, isIsoDate, manualCancelProblem, reconciliationAdjustment, validateManualCash, validateTransfer, type BudgetGroup, type PlLine } from "./rules";

export const STALE = "Chứng từ vừa được người khác cập nhật, tải lại trang.";

type Counterparty = CashTxInput["counterparty"];

// Số dư tài khoản tiền không phải tiền mặt bị âm → chỉ cảnh báo (R-TC-4)
async function negativeWarning(db: Db | Tx, accountId: string): Promise<string | null> {
  const [acc] = await db.select({ name: cashAccounts.name, kind: cashAccounts.kind }).from(cashAccounts).where(eq(cashAccounts.id, accountId));
  if (!acc || acc.kind === "cash") return null;
  const balance = await accountBalance(db, accountId);
  return balance < 0 ? `Lưu ý: ${acc.name} đang âm ${formatVnd(-balance)}` : null;
}

// Khóa tài khoản tiền mặt và kiểm số dư tại ngày (R-TC-4)
async function assertCashAvailable(tx: Tx, accountId: string, amount: number, onDate: string) {
  const [acc] = await tx.select({ id: cashAccounts.id, kind: cashAccounts.kind }).from(cashAccounts).where(eq(cashAccounts.id, accountId)).for("update");
  if (!acc || acc.kind !== "cash") return;
  const balance = await accountBalance(tx, accountId, onDate);
  if (wouldOverdraw(balance, amount)) throw new UserError(`Tiền mặt chỉ còn ${formatVnd(balance)}`);
}

// ---------------------------------------------------------------------------------------------
// R-TC-2, R-TC-3 · Phiếu tay và đề nghị chi

export type ManualCashInput = {
  direction: "in" | "out";
  accountId: string;
  categoryId: string;
  amount: number;
  occurredOn: string;
  counterparty?: Counterparty;
  channelCode?: string | null;
  note?: string | null;
  fileIds?: string[];
  // Cộng tác viên (finance.request): phiếu chi chờ duyệt
  asRequest?: boolean;
};

export async function createManualCash(db: Db, input: ManualCashInput, actorId: string, today: string = vnToday()): Promise<{ id: string; code: string; warning: string | null }> {
  if (input.asRequest && input.direction !== "out") throw new UserError("Đề nghị chỉ dùng cho phiếu chi");
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(cashAccounts).where(eq(cashAccounts.id, input.accountId));
    const [category] = await tx.select().from(financeCategories).where(eq(financeCategories.id, input.categoryId));
    const problem = validateManualCash({ direction: input.direction, amount: input.amount, occurredOn: input.occurredOn, today, category: category ?? null, account: account ?? null });
    if (problem) throw new UserError(problem);
    const res = await recordCashTransaction(
      tx,
      {
        direction: input.direction,
        accountId: account!.id,
        amount: input.amount,
        categoryCode: category!.code,
        occurredOn: input.occurredOn,
        counterparty: input.counterparty ?? null,
        channelCode: input.channelCode || null,
        note: input.note ?? null,
        fileIds: input.fileIds ?? [],
        status: input.asRequest ? "pending_approval" : "posted",
      },
      actorId,
    );
    const warning = input.asRequest ? null : await negativeWarning(tx, account!.id);
    return { id: res.id, code: res.code, warning };
  });
}

// R-TC-3: chủ duyệt (sửa được ngày, tài khoản trước khi duyệt)
export async function approveRequest(db: Db, id: string, edits: { accountId?: string | null; occurredOn?: string | null }, actorId: string, today: string = vnToday()): Promise<{ code: string; warning: string | null }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(cashTransactions).where(eq(cashTransactions.id, id)).for("update");
    if (!row) throw new UserError("Không tìm thấy phiếu");
    if (row.status !== "pending_approval") throw new UserError(STALE);
    const accountId = edits.accountId || row.accountId;
    const occurredOn = edits.occurredOn || row.occurredOn;
    if (!isIsoDate(occurredOn)) throw new UserError("Ngày phiếu không hợp lệ");
    if (occurredOn > today) throw new UserError("Ngày phiếu không được sau hôm nay");
    const [account] = await tx.select().from(cashAccounts).where(eq(cashAccounts.id, accountId));
    if (!account) throw new UserError("Không tìm thấy tài khoản tiền");
    if (!account.isActive) throw new UserError(`Tài khoản ${account.name} đã ngừng dùng`);
    await assertCashAvailable(tx, accountId, row.amount, occurredOn);
    const now = new Date();
    const updated = await tx
      .update(cashTransactions)
      .set({ status: "posted", accountId, occurredOn, approvedBy: actorId, approvedAt: now })
      .where(and(eq(cashTransactions.id, id), eq(cashTransactions.status, "pending_approval")))
      .returning({ id: cashTransactions.id });
    if (updated.length === 0) throw new UserError(STALE);
    await writeAudit(tx, {
      actorId,
      action: "cash_tx.approved",
      entity: "cash_transactions",
      entityId: id,
      before: { status: row.status, accountId: row.accountId, occurredOn: row.occurredOn },
      after: { status: "posted", accountId, occurredOn },
    });
    return { code: row.code, warning: await negativeWarning(tx, accountId) };
  });
}

// R-TC-3: chủ từ chối → cancelled có lý do
export async function rejectRequest(db: Db, id: string, reason: string, actorId: string): Promise<void> {
  if (!reason.trim()) throw new UserError("Ghi lý do từ chối");
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ status: cashTransactions.status }).from(cashTransactions).where(eq(cashTransactions.id, id));
    if (!row) throw new UserError("Không tìm thấy phiếu");
    if (row.status !== "pending_approval") throw new UserError(STALE);
    const res = await cancelCashTransaction(tx, { id }, `Từ chối: ${reason.trim()}`, actorId);
    if (!res.cancelled) throw new UserError(STALE);
  });
}

// R-TC-6: chỉ phiếu tay (source null, manual, reconciliation), lý do bắt buộc
export async function cancelManualCash(db: Db, id: string, reason: string, actorId: string): Promise<void> {
  if (!reason.trim()) throw new UserError("Ghi lý do hủy");
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(cashTransactions).where(eq(cashTransactions.id, id));
    if (!row) throw new UserError("Không tìm thấy phiếu");
    const problem = manualCancelProblem(row);
    if (problem) throw new UserError(problem);
    if (row.status === "pending_approval") throw new UserError("Phiếu đang chờ duyệt: dùng “Từ chối”");
    const res = await cancelCashTransaction(tx, { id }, reason, actorId);
    if (!res.cancelled) throw new UserError(STALE);
  });
}

// ---------------------------------------------------------------------------------------------
// R-TC-5 · Chuyển quỹ

async function insertTransfer(tx: Tx, input: { fromId: string; toId: string; amount: number; occurredOn: string; note?: string | null }, actorId: string) {
  const accounts = await tx.select().from(cashAccounts).where(inArray(cashAccounts.id, [input.fromId, input.toId]));
  const from = accounts.find((a) => a.id === input.fromId);
  const to = accounts.find((a) => a.id === input.toId);
  if (!from || !to) throw new UserError("Không tìm thấy tài khoản tiền");
  for (const a of [from, to]) if (!a.isActive) throw new UserError(`Tài khoản ${a.name} đã ngừng dùng`);
  await assertCashAvailable(tx, from.id, input.amount, input.occurredOn);
  const code = await nextDocCode(tx, "CQ", docDate(input.occurredOn));
  const now = new Date();
  const [row] = await tx
    .insert(cashTransactions)
    .values({
      code,
      direction: "transfer",
      status: "posted",
      accountId: from.id,
      toAccountId: to.id,
      amount: input.amount,
      categoryId: null,
      occurredOn: input.occurredOn,
      counterpartyName: "",
      sourceType: "manual",
      note: input.note?.trim() || null,
      createdBy: actorId,
      approvedBy: actorId,
      approvedAt: now,
    })
    .returning({ id: cashTransactions.id, code: cashTransactions.code });
  await writeAudit(tx, {
    actorId,
    action: "cash_tx.created",
    entity: "cash_transactions",
    entityId: row!.id,
    after: { code, direction: "transfer", from: from.code, to: to.code, amount: input.amount, occurredOn: input.occurredOn },
  });
  return { id: row!.id, code: row!.code, fromId: from.id };
}

export async function createTransfer(
  db: Db,
  input: { fromId: string; toId: string; amount: number; occurredOn: string; note?: string | null },
  actorId: string,
  today: string = vnToday(),
): Promise<{ id: string; code: string; warning: string | null }> {
  const problem = validateTransfer({ ...input, today });
  if (problem) throw new UserError(problem);
  return db.transaction(async (tx) => {
    const res = await insertTransfer(tx, input, actorId);
    return { id: res.id, code: res.code, warning: await negativeWarning(tx, res.fromId) };
  });
}

// R-TC-5 · Đối soát COD: chuyển COD → NH số hãng trả, phiếu chi CHI-VAN-CHUYEN từ COD phần phí thu hộ
export async function settleCod(
  db: Db,
  input: { codAccountId: string; bankAccountId: string; collected: number; received: number; occurredOn: string; carrier?: string | null; note?: string | null },
  actorId: string,
  today: string = vnToday(),
): Promise<{ transferCode: string | null; feeCode: string | null }> {
  const split = codSettlement(input.collected, input.received);
  if ("error" in split) throw new UserError(split.error);
  if (split.transfer > 0) {
    const problem = validateTransfer({ fromId: input.codAccountId, toId: input.bankAccountId, amount: split.transfer, occurredOn: input.occurredOn, today });
    if (problem) throw new UserError(problem);
  } else if (input.occurredOn > today || !isIsoDate(input.occurredOn)) throw new UserError("Ngày đối soát không hợp lệ");
  return db.transaction(async (tx) => {
    let transferCode: string | null = null;
    let feeCode: string | null = null;
    const note = input.note?.trim() || (input.carrier ? `Đối soát COD ${input.carrier}` : "Đối soát COD");
    if (split.transfer > 0) transferCode = (await insertTransfer(tx, { fromId: input.codAccountId, toId: input.bankAccountId, amount: split.transfer, occurredOn: input.occurredOn, note }, actorId)).code;
    if (split.fee > 0) {
      const fee = await recordCashTransaction(
        tx,
        {
          direction: "out",
          accountId: input.codAccountId,
          amount: split.fee,
          categoryCode: "CHI-VAN-CHUYEN",
          occurredOn: input.occurredOn,
          counterparty: input.carrier ? { type: "other", name: input.carrier } : null,
          note: `Phí thu hộ. ${note}`,
        },
        actorId,
      );
      feeCode = fee.code;
    }
    return { transferCode, feeCode };
  });
}

// ---------------------------------------------------------------------------------------------
// R-TC-8 · Đối chiếu quỹ

export async function reconcileAccount(
  db: Db,
  input: { accountId: string; asOf: string; actualBalance: number; writeAdjustment: boolean; note?: string | null },
  actorId: string,
  today: string = vnToday(),
): Promise<{ id: string; systemBalance: number; difference: number; adjustmentCode: string | null }> {
  if (!isIsoDate(input.asOf)) throw new UserError("Ngày đối chiếu không hợp lệ");
  if (input.asOf > today) throw new UserError("Ngày đối chiếu không được sau hôm nay");
  if (!Number.isSafeInteger(input.actualBalance)) throw new UserError("Số thực tế phải là số nguyên");
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(cashAccounts).where(eq(cashAccounts.id, input.accountId)).for("update");
    if (!account) throw new UserError("Không tìm thấy tài khoản tiền");
    if (account.kind === "cash" && input.actualBalance < 0) throw new UserError("Tiền mặt thực tế không âm");
    const systemBalance = await accountBalance(tx, account.id, input.asOf);
    const adj = reconciliationAdjustment(systemBalance, input.actualBalance);
    const id = randomUUID();
    await tx.insert(cashReconciliations).values({
      id,
      accountId: account.id,
      asOf: input.asOf,
      systemBalance,
      actualBalance: input.actualBalance,
      difference: adj.difference,
      note: input.note?.trim() || null,
      createdBy: actorId,
    });
    let adjustmentCode: string | null = null;
    if (input.writeAdjustment && adj.direction) {
      const res = await recordCashTransaction(
        tx,
        {
          direction: adj.direction,
          accountId: account.id,
          amount: adj.amount,
          categoryCode: adj.categoryCode!,
          occurredOn: input.asOf,
          source: { type: "reconciliation", id },
          note: `Chênh lệch đối chiếu ${account.name} ngày ${input.asOf}`,
        },
        actorId,
      );
      adjustmentCode = res.code;
      await tx.update(cashReconciliations).set({ adjustmentTxId: res.id }).where(eq(cashReconciliations.id, id));
    }
    await writeAudit(tx, {
      actorId,
      action: "cash_reconciliation.created",
      entity: "cash_reconciliations",
      entityId: id,
      after: { account: account.code, asOf: input.asOf, systemBalance, actualBalance: input.actualBalance, difference: adj.difference, adjustmentCode },
    });
    return { id, systemBalance, difference: adj.difference, adjustmentCode };
  });
}

export async function listReconciliations(db: Db, limit = 20) {
  return db
    .select({
      id: cashReconciliations.id,
      asOf: cashReconciliations.asOf,
      systemBalance: cashReconciliations.systemBalance,
      actualBalance: cashReconciliations.actualBalance,
      difference: cashReconciliations.difference,
      note: cashReconciliations.note,
      accountName: cashAccounts.name,
      adjustmentTxId: cashReconciliations.adjustmentTxId,
      adjustmentCode: cashTransactions.code,
    })
    .from(cashReconciliations)
    .innerJoin(cashAccounts, eq(cashAccounts.id, cashReconciliations.accountId))
    .leftJoin(cashTransactions, eq(cashTransactions.id, cashReconciliations.adjustmentTxId))
    .orderBy(desc(cashReconciliations.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------------------------
// Tài khoản tiền

export async function listAccountsWithBalance(db: Db | Tx, opts: { activeOnly?: boolean } = {}) {
  const rows = await db
    .select()
    .from(cashAccounts)
    .where(opts.activeOnly ? eq(cashAccounts.isActive, true) : undefined)
    .orderBy(asc(cashAccounts.sort), asc(cashAccounts.code));
  return Promise.all(rows.map(async (a) => ({ ...a, balance: await accountBalance(db, a.id) })));
}

export type AccountInput = { code: string; name: string; kind: "cash" | "bank" | "clearing"; bankName?: string | null; accountNo?: string | null; openingBalance: number; openingOn: string; sort?: number; note?: string | null };

export async function createAccount(db: Db, input: AccountInput, actorId: string): Promise<string> {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,20}$/.test(code)) throw new UserError("Mã tài khoản chỉ gồm chữ không dấu, số, gạch ngang");
  if (!input.name.trim()) throw new UserError("Nhập tên tài khoản");
  if (!Number.isSafeInteger(input.openingBalance)) throw new UserError("Số dư đầu phải là số nguyên");
  if (!isIsoDate(input.openingOn)) throw new UserError("Ngày số dư đầu không hợp lệ");
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: cashAccounts.id }).from(cashAccounts).where(eq(cashAccounts.code, code));
    if (dup) throw new UserError(`Mã ${code} đã có`);
    const [row] = await tx
      .insert(cashAccounts)
      .values({ code, name: input.name.trim(), kind: input.kind, bankName: input.bankName || null, accountNo: input.accountNo || null, openingBalance: input.openingBalance, openingOn: input.openingOn, sort: input.sort ?? 0, note: input.note || null })
      .returning({ id: cashAccounts.id });
    await writeAudit(tx, { actorId, action: "cash_account.created", entity: "cash_accounts", entityId: row!.id, after: { code, name: input.name, kind: input.kind, openingBalance: input.openingBalance, openingOn: input.openingOn } });
    return row!.id;
  });
}

export async function updateAccount(
  db: Db,
  id: string,
  input: { name: string; bankName?: string | null; accountNo?: string | null; openingBalance: number; openingOn: string; isActive: boolean; sort?: number; note?: string | null },
  actorId: string,
): Promise<void> {
  if (!input.name.trim()) throw new UserError("Nhập tên tài khoản");
  if (!Number.isSafeInteger(input.openingBalance)) throw new UserError("Số dư đầu phải là số nguyên");
  if (!isIsoDate(input.openingOn)) throw new UserError("Ngày số dư đầu không hợp lệ");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(cashAccounts).where(eq(cashAccounts.id, id)).for("update");
    if (!before) throw new UserError("Không tìm thấy tài khoản tiền");
    await tx
      .update(cashAccounts)
      .set({ name: input.name.trim(), bankName: input.bankName || null, accountNo: input.accountNo || null, openingBalance: input.openingBalance, openingOn: input.openingOn, isActive: input.isActive, sort: input.sort ?? before.sort, note: input.note || null })
      .where(eq(cashAccounts.id, id));
    await writeAudit(tx, {
      actorId,
      action: "cash_account.updated",
      entity: "cash_accounts",
      entityId: id,
      before: { name: before.name, openingBalance: before.openingBalance, openingOn: before.openingOn, isActive: before.isActive },
      after: { name: input.name, openingBalance: input.openingBalance, openingOn: input.openingOn, isActive: input.isActive },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Hạng mục thu chi (5.5): chủ thêm được; hạng mục hệ thống không xóa, không đổi mã, không tắt

export async function listCategories(db: Db | Tx, opts: { activeOnly?: boolean; direction?: "in" | "out" } = {}) {
  const conds: SQL[] = [];
  if (opts.activeOnly) conds.push(eq(financeCategories.isActive, true));
  if (opts.direction) conds.push(eq(financeCategories.direction, opts.direction));
  return db
    .select()
    .from(financeCategories)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(financeCategories.direction), asc(financeCategories.sort), asc(financeCategories.code));
}

export async function createCategory(
  db: Db,
  input: { code: string; name: string; direction: "in" | "out"; plLine: PlLine; budgetGroup: BudgetGroup | null },
  actorId: string,
): Promise<string> {
  const code = input.code.trim().toUpperCase();
  if (!/^(THU|CHI)-[A-Z0-9-]{2,30}$/.test(code)) throw new UserError("Mã hạng mục dạng THU-… hoặc CHI-…, chữ không dấu");
  if ((input.direction === "in") !== code.startsWith("THU-")) throw new UserError("Mã THU-… cho chiều thu, CHI-… cho chiều chi");
  if (!input.name.trim()) throw new UserError("Nhập tên hạng mục");
  const budgetGroup = input.direction === "out" ? input.budgetGroup : null;
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: financeCategories.id }).from(financeCategories).where(eq(financeCategories.code, code));
    if (dup) throw new UserError(`Mã ${code} đã có`);
    const [max] = await tx.select({ s: sql<number>`coalesce(max(${financeCategories.sort}), 0)` }).from(financeCategories);
    const [row] = await tx
      .insert(financeCategories)
      .values({ code, name: input.name.trim(), direction: input.direction, plLine: input.plLine, budgetGroup, isSystem: false, sort: Number(max?.s ?? 0) + 1 })
      .returning({ id: financeCategories.id });
    await writeAudit(tx, { actorId, action: "finance_category.created", entity: "finance_categories", entityId: row!.id, after: { code, name: input.name, direction: input.direction, plLine: input.plLine, budgetGroup } });
    return row!.id;
  });
}

export async function updateCategory(db: Db, id: string, input: { name: string; plLine: PlLine; budgetGroup: BudgetGroup | null; isActive: boolean }, actorId: string): Promise<void> {
  if (!input.name.trim()) throw new UserError("Nhập tên hạng mục");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(financeCategories).where(eq(financeCategories.id, id)).for("update");
    if (!before) throw new UserError("Không tìm thấy hạng mục");
    if (before.isSystem && !input.isActive) throw new UserError("Hạng mục hệ thống không tắt được");
    const budgetGroup = before.direction === "out" ? input.budgetGroup : null;
    await tx.update(financeCategories).set({ name: input.name.trim(), plLine: input.plLine, budgetGroup, isActive: input.isActive }).where(eq(financeCategories.id, id));
    await writeAudit(tx, {
      actorId,
      action: "finance_category.updated",
      entity: "finance_categories",
      entityId: id,
      before: { name: before.name, plLine: before.plLine, budgetGroup: before.budgetGroup, isActive: before.isActive },
      after: { name: input.name, plLine: input.plLine, budgetGroup, isActive: input.isActive },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Danh sách và chi tiết phiếu

export const CASH_PAGE_SIZE = 50;

export type CashFilter = {
  accountId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  status?: "pending_approval" | "posted" | "cancelled";
  origin?: "manual" | "auto";
  direction?: "in" | "out" | "transfer";
  createdBy?: string;
  page?: number;
  limit?: number;
};

function cashConds(f: CashFilter): SQL[] {
  const conds: SQL[] = [];
  if (f.accountId) conds.push(or(eq(cashTransactions.accountId, f.accountId), eq(cashTransactions.toAccountId, f.accountId))!);
  if (f.categoryId) conds.push(eq(cashTransactions.categoryId, f.categoryId));
  if (f.from && isIsoDate(f.from)) conds.push(gte(cashTransactions.occurredOn, f.from));
  if (f.to && isIsoDate(f.to)) conds.push(lte(cashTransactions.occurredOn, f.to));
  if (f.status) conds.push(eq(cashTransactions.status, f.status));
  if (f.direction) conds.push(eq(cashTransactions.direction, f.direction));
  if (f.createdBy) conds.push(eq(cashTransactions.createdBy, f.createdBy));
  if (f.origin === "manual") conds.push(or(isNull(cashTransactions.sourceType), inArray(cashTransactions.sourceType, ["manual", "reconciliation"]))!);
  if (f.origin === "auto") conds.push(sql`${cashTransactions.sourceType} is not null and ${cashTransactions.sourceType} not in ('manual', 'reconciliation')`);
  return conds;
}

export async function listCashTransactions(db: Db, f: CashFilter) {
  const toAcc = alias(cashAccounts, "to_acc");
  const where = cashConds(f);
  const limit = f.limit ?? CASH_PAGE_SIZE;
  const page = Math.max(1, f.page ?? 1);
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: cashTransactions.id,
        code: cashTransactions.code,
        direction: cashTransactions.direction,
        status: cashTransactions.status,
        amount: cashTransactions.amount,
        occurredOn: cashTransactions.occurredOn,
        accountName: cashAccounts.name,
        toAccountName: toAcc.name,
        categoryCode: financeCategories.code,
        categoryName: financeCategories.name,
        counterpartyName: cashTransactions.counterpartyName,
        channelCode: cashTransactions.channelCode,
        sourceType: cashTransactions.sourceType,
        sourceCode: cashTransactions.sourceCode,
        note: cashTransactions.note,
        createdBy: cashTransactions.createdBy,
      })
      .from(cashTransactions)
      .innerJoin(cashAccounts, eq(cashAccounts.id, cashTransactions.accountId))
      .leftJoin(toAcc, eq(toAcc.id, cashTransactions.toAccountId))
      .leftJoin(financeCategories, eq(financeCategories.id, cashTransactions.categoryId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(cashTransactions.occurredOn), desc(cashTransactions.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(cashTransactions)
      .where(where.length ? and(...where) : undefined),
  ]);
  return { rows, total: Number(total?.n ?? 0) };
}

export async function listPendingRequests(db: Db | Tx) {
  return db
    .select({
      id: cashTransactions.id,
      code: cashTransactions.code,
      amount: cashTransactions.amount,
      occurredOn: cashTransactions.occurredOn,
      categoryName: financeCategories.name,
      counterpartyName: cashTransactions.counterpartyName,
      note: cashTransactions.note,
      requesterName: staffUsers.name,
    })
    .from(cashTransactions)
    .leftJoin(financeCategories, eq(financeCategories.id, cashTransactions.categoryId))
    .leftJoin(staffUsers, eq(staffUsers.id, cashTransactions.createdBy))
    .where(eq(cashTransactions.status, "pending_approval"))
    .orderBy(asc(cashTransactions.createdAt));
}

export function sourceHref(sourceType: string | null, sourceId: string | null): string | null {
  if (!sourceType || !sourceId) return null;
  switch (sourceType) {
    case "order":
      return `/admin/don-hang/${sourceId}`;
    case "receivable":
      return `/admin/tai-chinh/cong-no/phai-thu/${sourceId}`;
    case "payable":
      return `/admin/tai-chinh/cong-no/phai-tra/${sourceId}`;
    case "stock_receipt":
      return `/admin/kho/nhap/${sourceId}`;
    case "return_request":
      return `/admin/ban-hang/doi-tra/${sourceId}`;
    case "production_order":
      return `/admin/san-xuat/lenh/${sourceId}`;
    case "extraction_run":
      return `/admin/san-xuat/chiet-xuat/${sourceId}`;
    case "reconciliation":
      return "/admin/tai-chinh/tai-khoan";
    default:
      return null;
  }
}

export async function getCashTransaction(db: Db, id: string) {
  const toAcc = alias(cashAccounts, "to_acc");
  const creator = alias(staffUsers, "creator");
  const approver = alias(staffUsers, "approver");
  const [row] = await db
    .select({
      tx: cashTransactions,
      accountName: cashAccounts.name,
      accountKind: cashAccounts.kind,
      toAccountName: toAcc.name,
      categoryCode: financeCategories.code,
      categoryName: financeCategories.name,
      plLine: financeCategories.plLine,
      creatorName: creator.name,
      approverName: approver.name,
    })
    .from(cashTransactions)
    .innerJoin(cashAccounts, eq(cashAccounts.id, cashTransactions.accountId))
    .leftJoin(toAcc, eq(toAcc.id, cashTransactions.toAccountId))
    .leftJoin(financeCategories, eq(financeCategories.id, cashTransactions.categoryId))
    .leftJoin(creator, eq(creator.id, cashTransactions.createdBy))
    .leftJoin(approver, eq(approver.id, cashTransactions.approvedBy))
    .where(eq(cashTransactions.id, id));
  return row ?? null;
}
