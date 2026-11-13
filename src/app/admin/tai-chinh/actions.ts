"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requirePermission, requireStaff, PermissionError } from "@/modules/auth/service";
import { advanceBudgetStatus, createBudget, deleteBudgetLine, setBudgetLine, type BudgetStatus } from "@/modules/finance/budgets";
import {
  approveRequest,
  cancelManualCash,
  createAccount,
  createCategory,
  createManualCash,
  createTransfer,
  reconcileAccount,
  rejectRequest,
  settleCod,
  updateAccount,
  updateCategory,
} from "@/modules/finance/cash";
import { allocateOverhead, deleteAllocation, setCostLock, type OverheadBasis } from "@/modules/finance/cost";
import { adjustDebt, cancelDebtManually, cancelPayment, createManualPayable, createManualReceivable, payDebt, type DebtKind } from "@/modules/finance/debts";
import { BUDGET_GROUP_LABEL, parseMoneyInput, PL_LINE_LABEL, type BudgetGroup, type BudgetPeriod, type PlLine } from "@/modules/finance/rules";
import { saveImage } from "@/modules/files/service";
import { fail, guard, ok, optStr, str, type ActionResult } from "../_lib/result";

const BASE = "/admin/tai-chinh";

function money(formData: FormData, key: string, opts: { allowNegative?: boolean } = {}): number | null {
  return parseMoneyInput(str(formData, key), opts);
}

function refresh(...paths: string[]) {
  for (const p of [BASE, ...paths]) revalidatePath(p);
}

function withWarning(message: string, warning: string | null): string {
  return warning ? `${message}\n${warning}` : message;
}

const COUNTERPARTY_TYPES = ["customer", "dealer", "supplier", "channel", "staff", "other"] as const;
type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

// ---------------------------------------------------------------------------------------------
// Thu chi

export async function createCashAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const result = await guard(async () => {
    const staff = await requireStaff();
    const direction = str(formData, "direction") === "in" ? "in" : "out";
    // Chủ: finance.write ghi thẳng; cộng tác viên: finance.request lập đề nghị chi
    const asRequest = !can(staff.role, "finance.write");
    if (asRequest && !(direction === "out" && can(staff.role, "finance.request"))) throw new PermissionError();
    const amount = money(formData, "amount");
    if (!amount) return fail("Số tiền phải là số nguyên lớn hơn 0");
    const cpType = str(formData, "counterpartyType") as CounterpartyType;
    const cpName = optStr(formData, "counterpartyName");
    const cpId = optStr(formData, "counterpartyId");
    const counterparty = cpName || cpId ? { type: COUNTERPARTY_TYPES.includes(cpType) ? cpType : ("other" as const), id: cpId, name: cpName } : null;
    const fileIds: string[] = [];
    for (const f of formData.getAll("files")) {
      if (f instanceof File && f.size > 0) fileIds.push(await saveImage(f, staff.id));
    }
    const db = await getDb();
    const res = await createManualCash(
      db,
      {
        direction,
        accountId: str(formData, "accountId"),
        categoryId: str(formData, "categoryId"),
        amount,
        occurredOn: str(formData, "occurredOn"),
        counterparty,
        channelCode: optStr(formData, "channelCode"),
        note: optStr(formData, "note"),
        fileIds,
        asRequest,
      },
      staff.id,
    );
    createdId = res.id;
    refresh(`${BASE}/thu-chi`);
    return ok(withWarning(asRequest ? `Đã gửi đề nghị ${res.code}, chờ chủ duyệt.` : `Đã ghi ${res.code}.`, res.warning));
  });
  if (createdId && result.status === "ok" && !result.message.includes("\n")) redirect(`${BASE}/thu-chi/${createdId}`);
  return result;
}

export async function createTransferAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const amount = money(formData, "amount");
    if (!amount) return fail("Số tiền phải là số nguyên lớn hơn 0");
    const res = await createTransfer(await getDb(), { fromId: str(formData, "fromId"), toId: str(formData, "toId"), amount, occurredOn: str(formData, "occurredOn"), note: optStr(formData, "note") }, staff.id);
    refresh(`${BASE}/thu-chi`);
    return ok(withWarning(`Đã chuyển quỹ ${res.code}.`, res.warning));
  });
}

export async function settleCodAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const collected = money(formData, "collected");
    const received = money(formData, "received");
    if (!collected || received === null) return fail("Nhập số COD và số hãng trả");
    const res = await settleCod(
      await getDb(),
      { codAccountId: str(formData, "codAccountId"), bankAccountId: str(formData, "bankAccountId"), collected, received, occurredOn: str(formData, "occurredOn"), carrier: optStr(formData, "carrier"), note: optStr(formData, "note") },
      staff.id,
    );
    refresh(`${BASE}/thu-chi`);
    return ok(`Đã đối soát: ${[res.transferCode, res.feeCode].filter(Boolean).join(", ")}.`);
  });
}

export async function approveCashAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.approve");
    const id = str(formData, "id");
    const res = await approveRequest(await getDb(), id, { accountId: optStr(formData, "accountId"), occurredOn: optStr(formData, "occurredOn") }, staff.id);
    refresh(`${BASE}/thu-chi`, `${BASE}/thu-chi/${id}`);
    return ok(withWarning(`Đã duyệt ${res.code}.`, res.warning));
  });
}

export async function rejectCashAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.approve");
    const id = str(formData, "id");
    await rejectRequest(await getDb(), id, str(formData, "reason"), staff.id);
    refresh(`${BASE}/thu-chi`, `${BASE}/thu-chi/${id}`);
    return ok("Đã từ chối đề nghị.");
  });
}

export async function cancelCashAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.approve");
    const id = str(formData, "id");
    await cancelManualCash(await getDb(), id, str(formData, "reason"), staff.id);
    refresh(`${BASE}/thu-chi`, `${BASE}/thu-chi/${id}`);
    return ok("Đã hủy phiếu.");
  });
}

// ---------------------------------------------------------------------------------------------
// Công nợ

function debtKind(formData: FormData): DebtKind {
  return str(formData, "kind") === "payable" ? "payable" : "receivable";
}

function debtPath(kind: DebtKind, id: string) {
  return `${BASE}/cong-no/${kind === "receivable" ? "phai-thu" : "phai-tra"}/${id}`;
}

export async function createReceivableAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const amount = money(formData, "amount");
    if (!amount) return fail("Số tiền phải là số nguyên lớn hơn 0");
    const party = str(formData, "party") === "dealer" ? "dealer" : "customer";
    const res = await createManualReceivable(
      await getDb(),
      { party, customerId: party === "customer" ? optStr(formData, "customerId") : null, dealerId: party === "dealer" ? optStr(formData, "dealerId") : null, amount, issuedOn: str(formData, "issuedOn"), dueOn: str(formData, "dueOn"), note: optStr(formData, "note") },
      staff.id,
    );
    refresh(`${BASE}/cong-no`);
    return ok(`Đã tạo khoản phải thu ${res.code}.`);
  });
}

export async function createPayableAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const amount = money(formData, "amount");
    if (!amount) return fail("Số tiền phải là số nguyên lớn hơn 0");
    const res = await createManualPayable(
      await getDb(),
      { supplierId: str(formData, "supplierId"), categoryId: str(formData, "categoryId"), amount, issuedOn: str(formData, "issuedOn"), dueOn: optStr(formData, "dueOn"), note: optStr(formData, "note") },
      staff.id,
    );
    refresh(`${BASE}/cong-no`);
    return ok(`Đã tạo khoản phải trả ${res.code}.`);
  });
}

export async function payDebtAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const kind = debtKind(formData);
    const id = str(formData, "debtId");
    const amount = money(formData, "amount");
    if (!amount) return fail("Số tiền phải là số nguyên lớn hơn 0");
    // Số đã trả lúc mở form (AC-TC-9): thiếu hoặc sai dạng → bắt tải lại trang thay vì ghi mù
    const expectedPaidAmount = money(formData, "expectedPaidAmount");
    if (expectedPaidAmount === null) return fail("Trang đã cũ, tải lại trang rồi ghi lại.");
    const res = await payDebt(
      await getDb(),
      { kind, debtId: id, amount, accountId: str(formData, "accountId"), paidOn: str(formData, "paidOn"), note: optStr(formData, "note"), expectedPaidAmount },
      staff.id,
    );
    refresh(`${BASE}/cong-no`, debtPath(kind, id));
    return ok(withWarning(res.status === "paid" ? "Đã ghi. Khoản nợ đã trả đủ." : "Đã ghi thanh toán.", res.warning));
  });
}

export async function cancelPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.approve");
    const kind = debtKind(formData);
    await cancelPayment(await getDb(), str(formData, "paymentId"), str(formData, "reason"), staff.id);
    refresh(`${BASE}/cong-no`, debtPath(kind, str(formData, "debtId")));
    return ok("Đã hủy lần thanh toán và phiếu tương ứng.");
  });
}

export async function adjustDebtAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const kind = debtKind(formData);
    const id = str(formData, "debtId");
    const newAmount = money(formData, "newAmount");
    if (newAmount === null) return fail("Số tiền mới phải là số nguyên không âm");
    const res = await adjustDebt(await getDb(), { kind, debtId: id, newAmount, reason: str(formData, "reason") }, staff.id);
    refresh(`${BASE}/cong-no`, debtPath(kind, id));
    return ok(res.status === "cancelled" ? "Khoản nợ về 0, đã hủy." : "Đã điều chỉnh số nợ.");
  });
}

export async function cancelDebtAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const kind = debtKind(formData);
    const id = str(formData, "debtId");
    await cancelDebtManually(await getDb(), { kind, debtId: id, reason: str(formData, "reason") }, staff.id);
    refresh(`${BASE}/cong-no`, debtPath(kind, id));
    return ok("Đã hủy khoản nợ.");
  });
}

// ---------------------------------------------------------------------------------------------
// Ngân sách

export async function createBudgetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("finance.write");
    const period = str(formData, "period") as BudgetPeriod;
    if (!["month", "quarter", "year"].includes(period)) return fail("Chọn kỳ");
    id = await createBudget(await getDb(), { period, anyDate: str(formData, "start"), name: optStr(formData, "name"), note: optStr(formData, "note") }, staff.id);
    return ok("Đã tạo ngân sách.");
  });
  if (id) redirect(`${BASE}/ngan-sach/${id}`);
  return result;
}

export async function setBudgetLineAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const budgetId = str(formData, "budgetId");
    const group = str(formData, "group") as BudgetGroup;
    if (!(group in BUDGET_GROUP_LABEL)) return fail("Chọn nhóm");
    const amount = money(formData, "amount");
    if (amount === null) return fail("Số tiền phải là số nguyên không âm");
    await setBudgetLine(await getDb(), budgetId, { group, categoryId: optStr(formData, "categoryId"), amount }, staff.id);
    refresh(`${BASE}/ngan-sach`, `${BASE}/ngan-sach/${budgetId}`);
    return ok("Đã lưu dòng ngân sách.");
  });
}

export async function deleteBudgetLineAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    await deleteBudgetLine(await getDb(), str(formData, "lineId"), staff.id);
    refresh(`${BASE}/ngan-sach/${str(formData, "budgetId")}`);
    return ok("Đã xóa dòng.");
  });
}

export async function advanceBudgetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const budgetId = str(formData, "budgetId");
    const to = await advanceBudgetStatus(await getDb(), budgetId, str(formData, "from") as BudgetStatus, staff.id);
    refresh(`${BASE}/ngan-sach`, `${BASE}/ngan-sach/${budgetId}`);
    return ok(to === "active" ? "Đã kích hoạt ngân sách." : "Đã đóng ngân sách.");
  });
}

// ---------------------------------------------------------------------------------------------
// Giá vốn

export async function allocateOverheadAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.approve");
    const total = money(formData, "total");
    if (!total) return fail("Số tiền phân bổ phải là số nguyên lớn hơn 0");
    const basis = str(formData, "basis") as OverheadBasis;
    const res = await allocateOverhead(await getDb(), { month: str(formData, "month"), total, basis, note: optStr(formData, "note") }, staff.id);
    refresh(`${BASE}/gia-von`);
    return ok(`Đã phân bổ ${res.code} cho ${res.lines.length} lệnh.`);
  });
}

export async function deleteAllocationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.approve");
    await deleteAllocation(await getDb(), str(formData, "id"), staff.id);
    refresh(`${BASE}/gia-von`);
    return ok("Đã xóa lần phân bổ, giá thành đã tính lại.");
  });
}

export async function costLockAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.approve");
    const lock = str(formData, "lock") === "1";
    await setCostLock(await getDb(), str(formData, "id"), lock, optStr(formData, "reason"), staff.id);
    refresh(`${BASE}/gia-von`);
    return ok(lock ? "Đã chốt giá vốn." : "Đã mở chốt giá vốn.");
  });
}

// ---------------------------------------------------------------------------------------------
// Tài khoản, đối chiếu, hạng mục

export async function createAccountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const kind = str(formData, "kind");
    if (kind !== "cash" && kind !== "bank" && kind !== "clearing") return fail("Chọn loại tài khoản");
    const opening = money(formData, "openingBalance", { allowNegative: true });
    if (opening === null) return fail("Số dư đầu phải là số nguyên");
    await createAccount(
      await getDb(),
      { code: str(formData, "code"), name: str(formData, "name"), kind, bankName: optStr(formData, "bankName"), accountNo: optStr(formData, "accountNo"), openingBalance: opening, openingOn: str(formData, "openingOn"), note: optStr(formData, "note") },
      staff.id,
    );
    refresh(`${BASE}/tai-khoan`);
    return ok("Đã thêm tài khoản.");
  });
}

export async function updateAccountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const opening = money(formData, "openingBalance", { allowNegative: true });
    if (opening === null) return fail("Số dư đầu phải là số nguyên");
    await updateAccount(
      await getDb(),
      str(formData, "id"),
      { name: str(formData, "name"), bankName: optStr(formData, "bankName"), accountNo: optStr(formData, "accountNo"), openingBalance: opening, openingOn: str(formData, "openingOn"), isActive: formData.get("isActive") === "on", note: optStr(formData, "note") },
      staff.id,
    );
    refresh(`${BASE}/tai-khoan`);
    return ok("Đã lưu tài khoản.");
  });
}

export async function reconcileAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.approve");
    const actual = money(formData, "actualBalance", { allowNegative: true });
    if (actual === null) return fail("Nhập số dư thực tế (số nguyên)");
    const res = await reconcileAccount(
      await getDb(),
      { accountId: str(formData, "accountId"), asOf: str(formData, "asOf"), actualBalance: actual, writeAdjustment: formData.get("writeAdjustment") === "on", note: optStr(formData, "note") },
      staff.id,
    );
    refresh(`${BASE}/tai-khoan`);
    const diff = res.difference === 0 ? "Khớp, không chênh lệch." : `Chênh lệch ${res.difference > 0 ? "+" : ""}${res.difference.toLocaleString("vi-VN")}đ.`;
    return ok(res.adjustmentCode ? `${diff} Đã ghi ${res.adjustmentCode}.` : diff);
  });
}

export async function createCategoryAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const direction = str(formData, "direction") === "in" ? "in" : "out";
    const plLine = str(formData, "plLine") as PlLine;
    if (!(plLine in PL_LINE_LABEL)) return fail("Chọn dòng lãi lỗ");
    const group = optStr(formData, "budgetGroup") as BudgetGroup | null;
    await createCategory(await getDb(), { code: str(formData, "code"), name: str(formData, "name"), direction, plLine, budgetGroup: group && group in BUDGET_GROUP_LABEL ? group : null }, staff.id);
    refresh(`${BASE}/tai-khoan`);
    return ok("Đã thêm hạng mục.");
  });
}

export async function updateCategoryAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const plLine = str(formData, "plLine") as PlLine;
    if (!(plLine in PL_LINE_LABEL)) return fail("Chọn dòng lãi lỗ");
    const group = optStr(formData, "budgetGroup") as BudgetGroup | null;
    await updateCategory(await getDb(), str(formData, "id"), { name: str(formData, "name"), plLine, budgetGroup: group && group in BUDGET_GROUP_LABEL ? group : null, isActive: formData.get("isActive") === "on" }, staff.id);
    refresh(`${BASE}/tai-khoan`);
    return ok("Đã lưu hạng mục.");
  });
}
