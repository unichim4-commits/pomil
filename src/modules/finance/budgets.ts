// Ngân sách tháng/quý/năm theo nhóm và hạng mục (05-tai-chinh.md R-TC-16). Trạng thái draft → active → closed.
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { budgetLines, budgets, cashTransactions, financeCategories } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { STALE } from "./cash";
import { computeBudgetLines, isIsoDate, normalizePeriodStart, periodBounds, periodLabel, type BudgetGroup, type BudgetPeriod, type CategorySpend } from "./rules";

export type BudgetStatus = "draft" | "active" | "closed";
export const BUDGET_STATUS_LABEL: Record<BudgetStatus, string> = { draft: "Nháp", active: "Đang dùng", closed: "Đã đóng" };
const NEXT_STATUS: Record<BudgetStatus, BudgetStatus | null> = { draft: "active", active: "closed", closed: null };

export async function createBudget(db: Db, input: { period: BudgetPeriod; anyDate: string; name?: string | null; note?: string | null }, actorId: string): Promise<string> {
  if (!isIsoDate(input.anyDate)) throw new UserError("Ngày bắt đầu không hợp lệ");
  const periodStart = normalizePeriodStart(input.period, input.anyDate);
  const name = input.name?.trim() || `Ngân sách ${periodLabel(input.period, periodStart).toLowerCase()}`;
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.period, input.period), eq(budgets.periodStart, periodStart)));
    if (dup) throw new UserError(`${periodLabel(input.period, periodStart)} đã có ngân sách`);
    const [row] = await tx.insert(budgets).values({ name, period: input.period, periodStart, note: input.note?.trim() || null, createdBy: actorId }).returning({ id: budgets.id });
    await writeAudit(tx, { actorId, action: "budget.created", entity: "budgets", entityId: row!.id, after: { name, period: input.period, periodStart } });
    return row!.id;
  });
}

// Thêm hoặc sửa một dòng: (nhóm, hạng mục|null). Hạng mục phải là chiều chi và thuộc nhóm.
export async function setBudgetLine(db: Db, budgetId: string, input: { group: BudgetGroup; categoryId: string | null; amount: number }, actorId: string): Promise<void> {
  if (!Number.isSafeInteger(input.amount) || input.amount < 0 || input.amount > 2_147_483_647) throw new UserError("Số tiền ngân sách phải là số nguyên không âm");
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(budgets).where(eq(budgets.id, budgetId)).for("update");
    if (!b) throw new UserError("Không tìm thấy ngân sách");
    if (b.status === "closed") throw new UserError("Ngân sách đã đóng");
    if (input.categoryId) {
      const [c] = await tx.select().from(financeCategories).where(eq(financeCategories.id, input.categoryId));
      if (!c || c.direction !== "out") throw new UserError("Chọn hạng mục chi");
      if (c.budgetGroup !== input.group) throw new UserError(`Hạng mục ${c.name} không thuộc nhóm đã chọn`);
    }
    const [existing] = await tx
      .select()
      .from(budgetLines)
      .where(and(eq(budgetLines.budgetId, budgetId), eq(budgetLines.budgetGroup, input.group), input.categoryId ? eq(budgetLines.categoryId, input.categoryId) : sql`${budgetLines.categoryId} is null`));
    if (existing) await tx.update(budgetLines).set({ amount: input.amount }).where(eq(budgetLines.id, existing.id));
    else await tx.insert(budgetLines).values({ budgetId, budgetGroup: input.group, categoryId: input.categoryId, amount: input.amount });
    await tx.update(budgets).set({ updatedAt: new Date() }).where(eq(budgets.id, budgetId));
    await writeAudit(tx, {
      actorId,
      action: "budget.line_set",
      entity: "budgets",
      entityId: budgetId,
      before: existing ? { group: existing.budgetGroup, categoryId: existing.categoryId, amount: existing.amount } : null,
      after: { group: input.group, categoryId: input.categoryId, amount: input.amount },
    });
  });
}

export async function deleteBudgetLine(db: Db, lineId: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [line] = await tx.select().from(budgetLines).where(eq(budgetLines.id, lineId));
    if (!line) return;
    const [b] = await tx.select({ status: budgets.status }).from(budgets).where(eq(budgets.id, line.budgetId));
    if (b?.status === "closed") throw new UserError("Ngân sách đã đóng");
    await tx.delete(budgetLines).where(eq(budgetLines.id, lineId));
    await writeAudit(tx, { actorId, action: "budget.line_deleted", entity: "budgets", entityId: line.budgetId, before: { group: line.budgetGroup, categoryId: line.categoryId, amount: line.amount } });
  });
}

// draft → active → closed, cập nhật có điều kiện
export async function advanceBudgetStatus(db: Db, budgetId: string, expectedFrom: BudgetStatus, actorId: string): Promise<BudgetStatus> {
  const to = NEXT_STATUS[expectedFrom];
  if (!to) throw new UserError("Ngân sách đã đóng");
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(budgets)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(budgets.id, budgetId), eq(budgets.status, expectedFrom)))
      .returning({ id: budgets.id });
    if (updated.length === 0) throw new UserError(STALE);
    await writeAudit(tx, { actorId, action: "budget.status", entity: "budgets", entityId: budgetId, before: { status: expectedFrom }, after: { status: to } });
    return to;
  });
}

// Chi posted trong kỳ theo hạng mục (chuyển quỹ không tính)
export async function spendByCategory(db: Db | Tx, from: string, toExclusive: string): Promise<CategorySpend[]> {
  const rows = await db
    .select({ categoryId: cashTransactions.categoryId, group: financeCategories.budgetGroup, amount: sql<string>`sum(${cashTransactions.amount})` })
    .from(cashTransactions)
    .innerJoin(financeCategories, eq(financeCategories.id, cashTransactions.categoryId))
    .where(and(eq(cashTransactions.status, "posted"), eq(cashTransactions.direction, "out"), gte(cashTransactions.occurredOn, from), lt(cashTransactions.occurredOn, toExclusive)))
    .groupBy(cashTransactions.categoryId, financeCategories.budgetGroup);
  return rows.map((r) => ({ categoryId: r.categoryId!, group: r.group, amount: Number(r.amount) }));
}

export async function getBudgetReport(db: Db | Tx, budgetId: string, warnBp: number) {
  const [b] = await db.select().from(budgets).where(eq(budgets.id, budgetId));
  if (!b) return null;
  const { from, to } = periodBounds(b.period, b.periodStart);
  const lines = await db
    .select({ id: budgetLines.id, group: budgetLines.budgetGroup, categoryId: budgetLines.categoryId, amount: budgetLines.amount, categoryName: financeCategories.name, categoryCode: financeCategories.code })
    .from(budgetLines)
    .leftJoin(financeCategories, eq(financeCategories.id, budgetLines.categoryId))
    .where(eq(budgetLines.budgetId, budgetId))
    .orderBy(asc(budgetLines.budgetGroup), asc(financeCategories.code));
  const spend = await spendByCategory(db, from, to);
  const computed = computeBudgetLines(lines, spend, warnBp);
  const names = new Map(lines.map((l) => [l.id, { categoryName: l.categoryName, categoryCode: l.categoryCode }]));
  return {
    budget: b,
    from,
    to,
    lines: computed.map((l) => ({ ...l, ...names.get(l.id)! })),
    totalBudget: computed.reduce((a, l) => a + l.amount, 0),
    totalActual: computed.reduce((a, l) => a + l.actual, 0),
  };
}

export async function listBudgets(db: Db) {
  return db.select().from(budgets).orderBy(desc(budgets.periodStart), asc(budgets.period));
}

// Ngân sách đang dùng có kỳ chứa hôm nay (cho Tổng quan và cảnh báo)
export async function activeBudgetsOn(db: Db | Tx, today: string) {
  const rows = await db.select().from(budgets).where(and(eq(budgets.status, "active"), lte(budgets.periodStart, today)));
  return rows.filter((b) => periodBounds(b.period, b.periodStart).to > today);
}
