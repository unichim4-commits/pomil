// Quy tắc thuần của phân hệ Tài chính (05-tai-chinh.md R-TC-2…R-TC-29). Service và trang gọi lại, không lặp logic.
// Quy tắc sổ quỹ/công nợ dùng chung (R-TC-4, 7, 11, 12) ở ledger-rules.ts.
import { formatVnd } from "@/lib/format";

export type CashDirection = "in" | "out" | "transfer";
export type PlLine = "none" | "capitalized" | "selling" | "marketing" | "admin" | "other_income" | "other_expense" | "tax";
export type BudgetGroup = "materials" | "production" | "marketing" | "personnel" | "operations" | "investment" | "other";
export type BudgetPeriod = "month" | "quarter" | "year";

export const LEGAL_NOTICE =
  "Đây là quản trị tài chính nội bộ, không phải sổ kế toán pháp định. Khi chạy chính thức cần phần mềm kế toán, kê khai thuế, hóa đơn điện tử theo quy định.";

export const BUDGET_GROUP_LABEL: Record<BudgetGroup, string> = {
  materials: "Nguyên liệu",
  production: "Sản xuất",
  marketing: "Marketing",
  personnel: "Nhân sự",
  operations: "Vận hành",
  investment: "Đầu tư",
  other: "Khác",
};

export const PL_LINE_LABEL: Record<PlLine, string> = {
  none: "Không vào lãi lỗ",
  capitalized: "Vào giá vốn (phân bổ)",
  selling: "Chi phí bán hàng",
  marketing: "Chi phí marketing",
  admin: "Chi phí quản lý",
  other_income: "Thu nhập khác",
  other_expense: "Chi phí khác",
  tax: "Thuế",
};

export const PERIOD_LABEL: Record<BudgetPeriod, string> = { month: "Tháng", quarter: "Quý", year: "Năm" };

export const ACCOUNT_KIND_LABEL = { cash: "Tiền mặt", bank: "Ngân hàng", clearing: "Chờ đối soát" } as const;

export const CASH_STATUS_LABEL = { pending_approval: "Chờ duyệt", posted: "Đã ghi", cancelled: "Đã hủy" } as const;

export const DEBT_STATUS_LABEL = { open: "Chưa trả", partial: "Trả một phần", paid: "Đã trả đủ", cancelled: "Đã hủy" } as const;

export const SOURCE_LABEL: Record<string, string> = {
  order: "Đơn hàng",
  receivable: "Thu công nợ",
  payable: "Trả công nợ",
  return_request: "Đổi trả",
  stock_receipt: "Phiếu nhập",
  production_order: "Lệnh sản xuất",
  extraction_run: "Mẻ chiết",
  reconciliation: "Đối chiếu quỹ",
  manual: "Phiếu tay",
};

// ---------------------------------------------------------------------------------------------
// Ngày (giờ Việt Nam, chuỗi YYYY-MM-DD)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Đầu ngày giờ VN → thời điểm UTC, để lọc cột timestamptz theo kỳ
export function vnStartOf(date: string): Date {
  return new Date(`${date}T00:00:00+07:00`);
}

// "2027-11-20" → "20/11"
export function shortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

// ---------------------------------------------------------------------------------------------
// Kỳ tháng/quý/năm (R-TC-16, R-TC-22)

export function normalizePeriodStart(period: BudgetPeriod, date: string): string {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  if (period === "year") return `${y}-01-01`;
  if (period === "quarter") return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function addMonths(start: string, months: number): string {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7)) - 1 + months;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

const PERIOD_MONTHS: Record<BudgetPeriod, number> = { month: 1, quarter: 3, year: 12 };

// Kỳ [from, to): to là ngày đầu kỳ sau
export function periodBounds(period: BudgetPeriod, anyDate: string): { from: string; to: string } {
  const from = normalizePeriodStart(period, anyDate);
  return { from, to: addMonths(from, PERIOD_MONTHS[period]) };
}

export function previousPeriodStart(period: BudgetPeriod, start: string): string {
  return addMonths(normalizePeriodStart(period, start), -PERIOD_MONTHS[period]);
}

export function periodLabel(period: BudgetPeriod, start: string): string {
  const y = start.slice(0, 4);
  const m = Number(start.slice(5, 7));
  if (period === "year") return `Năm ${y}`;
  if (period === "quarter") return `Quý ${Math.floor((m - 1) / 3) + 1}/${y}`;
  return `Tháng ${m}/${y}`;
}

// ---------------------------------------------------------------------------------------------
// R-TC-2 · Phiếu tay

export function validateManualCash(input: {
  direction: "in" | "out";
  amount: number;
  occurredOn: string;
  today: string;
  category: { direction: string; isActive: boolean } | null;
  account: { isActive: boolean } | null;
}): string | null {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return "Số tiền phải là số nguyên lớn hơn 0";
  if (!isIsoDate(input.occurredOn)) return "Ngày phiếu không hợp lệ";
  if (input.occurredOn > input.today) return "Ngày phiếu không được sau hôm nay";
  if (!input.account) return "Chọn tài khoản tiền";
  if (!input.account.isActive) return "Tài khoản đã ngừng dùng";
  if (!input.category || !input.category.isActive) return "Chọn hạng mục thu chi";
  if (input.category.direction !== input.direction) return `Hạng mục không dùng cho phiếu ${input.direction === "in" ? "thu" : "chi"}`;
  return null;
}

// R-TC-5 · Chuyển quỹ
export function validateTransfer(input: { fromId: string; toId: string; amount: number; occurredOn: string; today: string }): string | null {
  if (!input.fromId || !input.toId) return "Chọn tài khoản đi và tài khoản đến";
  if (input.fromId === input.toId) return "Hai tài khoản phải khác nhau";
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return "Số tiền phải là số nguyên lớn hơn 0";
  if (!isIsoDate(input.occurredOn)) return "Ngày chuyển không hợp lệ";
  if (input.occurredOn > input.today) return "Ngày chuyển không được sau hôm nay";
  return null;
}

// R-TC-5 · Đối soát COD: hãng trả `received`, giữ lại `collected − received` làm phí thu hộ
export function codSettlement(collected: number, received: number): { transfer: number; fee: number } | { error: string } {
  if (!Number.isSafeInteger(collected) || collected <= 0) return { error: "Số tiền COD phải lớn hơn 0" };
  if (!Number.isSafeInteger(received) || received < 0) return { error: "Số hãng trả không hợp lệ" };
  if (received > collected) return { error: "Số hãng trả lớn hơn số COD" };
  return { transfer: received, fee: collected - received };
}

// R-TC-6 · Hủy phiếu: chỉ phiếu tay (source null, manual, reconciliation). Trả null nếu hủy được.
export function manualCancelProblem(tx: { status: string; sourceType: string | null; idempotencyKey: string | null }): string | null {
  if (tx.status === "cancelled") return "Phiếu đã hủy";
  if (tx.sourceType === "receivable" || tx.sourceType === "payable" || tx.idempotencyKey?.startsWith("debt-payment:")) {
    return "Phiếu của thanh toán công nợ: hủy bằng “Hủy thanh toán” ở Công nợ";
  }
  const manualSource = tx.sourceType === null || tx.sourceType === "manual" || tx.sourceType === "reconciliation";
  if (!manualSource || (tx.sourceType === null && tx.idempotencyKey)) {
    return "Phiếu tạo từ nghiệp vụ, hủy ở chứng từ gốc (đơn, công nợ, phiếu nhập, đổi trả)";
  }
  return null;
}

// R-TC-8 · Đối chiếu quỹ: chênh lệch = thực tế − hệ thống; ≠ 0 thì phiếu THU/CHI-CHENH-LECH
export function reconciliationAdjustment(systemBalance: number, actualBalance: number): { difference: number; direction: "in" | "out" | null; categoryCode: string | null; amount: number } {
  const difference = actualBalance - systemBalance;
  if (difference === 0) return { difference, direction: null, categoryCode: null, amount: 0 };
  return difference > 0
    ? { difference, direction: "in", categoryCode: "THU-CHENH-LECH", amount: difference }
    : { difference, direction: "out", categoryCode: "CHI-CHENH-LECH", amount: -difference };
}

// ---------------------------------------------------------------------------------------------
// R-TC-14 · Đến hạn, quá hạn, tuổi nợ

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const AGING_LABEL: Record<AgingBucket, string> = {
  current: "Chưa đến hạn",
  d1_30: "Quá hạn 1–30 ngày",
  d31_60: "31–60 ngày",
  d61_90: "61–90 ngày",
  d90_plus: "Trên 90 ngày",
};

export const AGING_ORDER: AgingBucket[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];

export function overdueDays(dueOn: string, today: string): number {
  return daysFrom(dueOn, today);
}

export function agingBucket(dueOn: string, today: string): AgingBucket {
  const d = overdueDays(dueOn, today);
  if (d <= 0) return "current";
  if (d <= 30) return "d1_30";
  if (d <= 60) return "d31_60";
  if (d <= 90) return "d61_90";
  return "d90_plus";
}

export function isDueSoon(dueOn: string, today: string, dueSoonDays: number): boolean {
  const left = daysFrom(today, dueOn);
  return left >= 0 && left <= dueSoonDays;
}

export function isOpenDebt(status: string): boolean {
  return status === "open" || status === "partial";
}

// Cộng số còn lại theo nhóm tuổi (chỉ khoản open/partial)
export function agingSummary(debts: { amount: number; paidAmount: number; status: string; dueOn: string }[], today: string): Record<AgingBucket, number> {
  const out: Record<AgingBucket, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const d of debts) {
    if (!isOpenDebt(d.status)) continue;
    out[agingBucket(d.dueOn, today)] += d.amount - d.paidAmount;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// R-TC-16 · Ngân sách

export type BudgetLineInput = { id: string; group: BudgetGroup; categoryId: string | null; amount: number };
export type CategorySpend = { categoryId: string; group: BudgetGroup | null; amount: number };
export type BudgetTone = "green" | "amber" | "red";
export type BudgetLineResult = BudgetLineInput & { actual: number; ratioBp: number | null; tone: BudgetTone; over: number };

export function budgetTone(actual: number, budget: number, warnBp: number): BudgetTone {
  if (actual > budget) return "red";
  if (budget > 0 && actual * 10_000 >= warnBp * budget) return "amber";
  return "green";
}

export function computeBudgetLines(lines: BudgetLineInput[], spend: CategorySpend[], warnBp: number): BudgetLineResult[] {
  const ownLine = new Set(lines.filter((l) => l.categoryId).map((l) => l.categoryId!));
  return lines.map((line) => {
    const actual = line.categoryId
      ? spend.filter((s) => s.categoryId === line.categoryId).reduce((a, s) => a + s.amount, 0)
      : spend.filter((s) => s.group === line.group && !ownLine.has(s.categoryId)).reduce((a, s) => a + s.amount, 0);
    return {
      ...line,
      actual,
      ratioBp: line.amount > 0 ? Math.round((actual * 10_000) / line.amount) : null,
      tone: budgetTone(actual, line.amount, warnBp),
      over: Math.max(0, actual - line.amount),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Chia theo tỷ lệ, làm tròn kiểu phần dư lớn nhất: tổng đúng bằng total (R-TC-18, R-TC-23).
// Phần dư bằng nhau thì dòng đứng trước được trước. Mọi trọng số 0 → null.

export function allocateLargestRemainder(total: number, weights: number[]): number[] | null {
  const W = weights.reduce((a, w) => a + BigInt(Math.max(0, Math.trunc(w))), 0n);
  if (W === 0n) return null;
  const T = BigInt(Math.trunc(total));
  const parts = weights.map((w, i) => {
    const num = T * BigInt(Math.max(0, Math.trunc(w)));
    return { i, base: num / W, rem: num % W };
  });
  let left = T - parts.reduce((a, p) => a + p.base, 0n);
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  const out = parts.map((p) => p.base);
  for (const p of order) {
    if (left <= 0n) break;
    out[p.i]! += 1n;
    left -= 1n;
  }
  return out.map(Number);
}

// ---------------------------------------------------------------------------------------------
// Tỷ lệ thay đổi (R-TC-17, R-TC-20): bp, làm tròn nửa lên theo độ lớn

export function changeBp(current: number, previous: number): number | null {
  if (!previous) return null;
  const raw = ((current - previous) * 10_000) / previous;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

// 1500 → "+15%"; -486 → "−4,9%"
export function formatBpPct(bp: number | null, opts: { signed?: boolean } = { signed: true }): string {
  if (bp === null) return "—";
  const abs = Math.round(Math.abs(bp) / 10) / 10;
  const body = (Number.isInteger(abs) ? String(abs) : abs.toFixed(1)).replace(".", ",");
  if (bp === 0 || abs === 0) return "0%";
  const sign = bp < 0 ? "−" : opts.signed ? "+" : "";
  return `${sign}${body}%`;
}

// R-SX-27 / R-TC-17: giá/chai thực tế, kế hoạch/chai và chênh lệch
export function unitCostOf(total: number, units: number | null): number | null {
  return units && units > 0 ? Math.round(total / units) : null;
}

export function costVsPlan(input: { totalCost: number; goodUnits: number | null; plannedCost: number | null; plannedUnits: number }): {
  unitCost: number | null;
  plannedUnitCost: number | null;
  diffPerUnit: number | null;
  diffBp: number | null;
} {
  const unitCost = unitCostOf(input.totalCost, input.goodUnits);
  const plannedUnitCost = input.plannedCost === null ? null : unitCostOf(input.plannedCost, input.plannedUnits);
  const diffPerUnit = unitCost !== null && plannedUnitCost !== null ? unitCost - plannedUnitCost : null;
  return { unitCost, plannedUnitCost, diffPerUnit, diffBp: unitCost !== null && plannedUnitCost ? changeBp(unitCost, plannedUnitCost) : null };
}

// R-TC-18: tổng đã chi capitalized trong tháng trừ đã phân bổ, không âm
export function suggestedOverhead(capitalizedSpend: number, alreadyAllocated: number): number {
  return Math.max(0, capitalizedSpend - alreadyAllocated);
}

// R-TC-19: gợi ý chốt khi lệnh completed và đã qua tháng hoàn thành
export function shouldSuggestLock(input: { status: string; finishedOn: string | null; locked: boolean }, today: string): boolean {
  if (input.locked || input.status !== "completed" || !input.finishedOn) return false;
  return input.finishedOn.slice(0, 7) < today.slice(0, 7);
}

// ---------------------------------------------------------------------------------------------
// R-TC-22 · Lãi lỗ theo kỳ

export type PnlInput = {
  goodsRevenue: number;
  discount: number;
  shippingIncome: number;
  returns: number;
  cogs: number;
  platformFee: number;
  sellingTx: number;
  marketingTx: number;
  sampleValue: number;
  adminTx: number;
  qcResearchValue: number;
  otherIncomeTx: number;
  countGain: number;
  otherExpenseTx: number;
  scrapValue: number;
  countLoss: number;
  cancelLoss: number;
  taxTx: number;
  capitalizedTx: number;
  capitalizedAbsorbed: number;
};

export type PnlResult = {
  goodsRevenue: number;
  discount: number;
  shippingIncome: number;
  returns: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  selling: number;
  marketing: number;
  admin: number;
  operatingProfit: number;
  otherIncome: number;
  otherExpense: number;
  tax: number;
  netProfit: number;
  marginBp: number | null;
  capitalizedNotInCost: number;
};

export function computePnl(i: PnlInput): PnlResult {
  const netRevenue = i.goodsRevenue - i.discount + i.shippingIncome - i.returns;
  const grossProfit = netRevenue - i.cogs;
  const selling = i.platformFee + i.sellingTx;
  const marketing = i.marketingTx + i.sampleValue;
  const admin = i.adminTx + i.qcResearchValue;
  const operatingProfit = grossProfit - selling - marketing - admin;
  const otherIncome = i.otherIncomeTx + i.countGain;
  const otherExpense = i.otherExpenseTx + i.scrapValue + i.countLoss + i.cancelLoss;
  const tax = i.taxTx;
  const netProfit = operatingProfit + otherIncome - otherExpense - tax;
  return {
    goodsRevenue: i.goodsRevenue,
    discount: i.discount,
    shippingIncome: i.shippingIncome,
    returns: i.returns,
    netRevenue,
    cogs: i.cogs,
    grossProfit,
    selling,
    marketing,
    admin,
    operatingProfit,
    otherIncome,
    otherExpense,
    tax,
    netProfit,
    marginBp: netRevenue > 0 ? Math.round((netProfit * 10_000) / netRevenue) : null,
    capitalizedNotInCost: i.capitalizedTx - i.capitalizedAbsorbed,
  };
}

export const PNL_ROWS: { key: keyof PnlResult; label: string; strong?: boolean }[] = [
  { key: "goodsRevenue", label: "1. Doanh thu hàng" },
  { key: "discount", label: "2. Chiết khấu" },
  { key: "shippingIncome", label: "3. Thu phí giao" },
  { key: "returns", label: "4. Hàng bán bị trả lại" },
  { key: "netRevenue", label: "5. Doanh thu thuần", strong: true },
  { key: "cogs", label: "6. Giá vốn hàng bán" },
  { key: "grossProfit", label: "7. Lãi gộp", strong: true },
  { key: "selling", label: "8. Chi phí bán hàng" },
  { key: "marketing", label: "9. Chi phí marketing" },
  { key: "admin", label: "10. Chi phí quản lý" },
  { key: "operatingProfit", label: "11. Lợi nhuận hoạt động", strong: true },
  { key: "otherIncome", label: "12. Thu nhập khác" },
  { key: "otherExpense", label: "13. Chi phí khác" },
  { key: "tax", label: "14. Thuế" },
  { key: "netProfit", label: "15. Lợi nhuận ròng", strong: true },
];

// ---------------------------------------------------------------------------------------------
// R-TC-23 · Lợi nhuận theo sản phẩm: chia chiết khấu và phí nền tảng của đơn cho dòng theo line_total

export type OrderLineForProfit = { lineTotal: number };

export function splitOrderAmounts(lines: OrderLineForProfit[], discount: number, platformFee: number): { discount: number; platformFee: number }[] {
  const weights = lines.map((l) => l.lineTotal);
  const d = discount > 0 ? allocateLargestRemainder(discount, weights) : null;
  const f = platformFee > 0 ? allocateLargestRemainder(platformFee, weights) : null;
  return lines.map((_, i) => ({ discount: d?.[i] ?? 0, platformFee: f?.[i] ?? 0 }));
}

// R-TC-24 · Hiệu quả kênh
export function channelMetrics(input: { netRevenue: number; cogs: number; platformFee: number; marketing: number }): {
  contribution: number;
  afterMarketing: number;
  revenuePerMarketing: number | null;
} {
  const contribution = input.netRevenue - input.cogs - input.platformFee;
  return {
    contribution,
    afterMarketing: contribution - input.marketing,
    revenuePerMarketing: input.marketing > 0 ? Math.round((input.netRevenue * 100) / input.marketing) / 100 : null,
  };
}

// ---------------------------------------------------------------------------------------------
// R-TC-26 · Dự báo dòng tiền theo tuần

export type ForecastWeek = { week: number; from: string; to: string; opening: number; inflow: number; outflow: number; closing: number };

export function forecastCash(input: {
  today: string;
  weeks: number;
  openingBalance: number;
  receivables: { remaining: number; dueOn: string }[];
  payables: { remaining: number; dueOn: string }[];
  pendingRequests: number;
  minCash: number;
}): { weeks: ForecastWeek[]; shortages: { week: number; from: string; shortBy: number }[] } {
  const weekIndex = (due: string): number | null => {
    const d = daysFrom(input.today, due);
    if (d < 0) return 0; // quá hạn dồn vào tuần 1
    const w = Math.floor(d / 7);
    return w < input.weeks ? w : null;
  };
  const inflow = new Array<number>(input.weeks).fill(0);
  const outflow = new Array<number>(input.weeks).fill(0);
  for (const r of input.receivables) {
    const w = weekIndex(r.dueOn);
    if (w !== null) inflow[w]! += r.remaining;
  }
  for (const p of input.payables) {
    const w = weekIndex(p.dueOn);
    if (w !== null) outflow[w]! += p.remaining;
  }
  if (input.weeks > 0) outflow[0]! += input.pendingRequests;

  const weeks: ForecastWeek[] = [];
  const shortages: { week: number; from: string; shortBy: number }[] = [];
  let opening = input.openingBalance;
  for (let i = 0; i < input.weeks; i++) {
    const from = addDaysIso(input.today, i * 7);
    const closing = opening + inflow[i]! - outflow[i]!;
    weeks.push({ week: i + 1, from, to: addDaysIso(from, 6), opening, inflow: inflow[i]!, outflow: outflow[i]!, closing });
    if (closing < input.minCash) shortages.push({ week: i + 1, from, shortBy: input.minCash - closing });
    opening = closing;
  }
  return { weeks, shortages };
}

export function shortageText(s: { week: number; from: string; shortBy: number }): string {
  return `Tuần ${s.week} (từ ${shortDate(s.from)}) có thể thiếu ${formatVnd(s.shortBy)}`;
}

// R-TC-27 · Vốn lưu động
export function workingCapital(input: { stockValue: number; receivables: number; payables: number }): number {
  return input.stockValue + input.receivables - input.payables;
}

// ---------------------------------------------------------------------------------------------
// R-TC-29 · CSV: UTF-8 có BOM, tiền là số nguyên không phân cách

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "number" ? String(Math.round(value)) : value;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// Ô nhập tiền kiểu Việt Nam: "1.500.000", "1 500 000", "1500000đ" → 1500000. Không nhận phần lẻ. Sai → null.
export function parseMoneyInput(raw: string, opts: { allowNegative?: boolean } = {}): number | null {
  const s = raw.replace(/[\s.đ₫]/g, "").replace(/^−/, "-");
  if (!/^-?\d{1,13}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || (n < 0 && !opts.allowNegative)) return null;
  return n === 0 ? 0 : n;
}
