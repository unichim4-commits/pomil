import { describe, expect, it } from "vitest";
import { can } from "@/modules/auth/rules";
import {
  agingBucket,
  agingSummary,
  allocateLargestRemainder,
  budgetTone,
  changeBp,
  channelMetrics,
  codSettlement,
  computeBudgetLines,
  computePnl,
  costVsPlan,
  forecastCash,
  formatBpPct,
  isDueSoon,
  manualCancelProblem,
  normalizePeriodStart,
  overdueDays,
  periodBounds,
  previousPeriodStart,
  reconciliationAdjustment,
  shortageText,
  shouldSuggestLock,
  splitOrderAmounts,
  suggestedOverhead,
  toCsv,
  validateManualCash,
  validateTransfer,
  workingCapital,
} from "@/modules/finance/rules";

// T-18: quy tắc thuần phân hệ Tài chính (05-tai-chinh.md)

const zeroPnl = {
  goodsRevenue: 0, discount: 0, shippingIncome: 0, returns: 0, cogs: 0, platformFee: 0, sellingTx: 0, marketingTx: 0, sampleValue: 0, adminTx: 0,
  qcResearchValue: 0, otherIncomeTx: 0, countGain: 0, otherExpenseTx: 0, scrapValue: 0, countLoss: 0, cancelLoss: 0, taxTx: 0, capitalizedTx: 0, capitalizedAbsorbed: 0,
};

describe("R-TC-2, R-TC-5, R-TC-6, R-TC-8: phiếu tay, chuyển quỹ, hủy, đối chiếu", () => {
  const ok = { direction: "out" as const, amount: 200_000, occurredOn: "2028-01-20", today: "2028-01-20", category: { direction: "out", isActive: true }, account: { isActive: true } };
  it("R-TC-2: số tiền > 0, ngày ≤ hôm nay, hạng mục cùng chiều, tài khoản đang dùng", () => {
    expect(validateManualCash(ok)).toBeNull();
    expect(validateManualCash({ ...ok, amount: 0 })).toBe("Số tiền phải là số nguyên lớn hơn 0");
    expect(validateManualCash({ ...ok, amount: 1.5 })).toBe("Số tiền phải là số nguyên lớn hơn 0");
    expect(validateManualCash({ ...ok, occurredOn: "2028-01-21" })).toBe("Ngày phiếu không được sau hôm nay");
    expect(validateManualCash({ ...ok, occurredOn: "2028-02-30" })).toBe("Ngày phiếu không hợp lệ");
    expect(validateManualCash({ ...ok, category: { direction: "in", isActive: true } })).toBe("Hạng mục không dùng cho phiếu chi");
    expect(validateManualCash({ ...ok, account: { isActive: false } })).toBe("Tài khoản đã ngừng dùng");
  });
  it("R-TC-5: hai tài khoản khác nhau; đối soát COD 1.000.000 → CQ 985.000 + PC 15.000", () => {
    expect(validateTransfer({ fromId: "a", toId: "a", amount: 1, occurredOn: "2028-01-01", today: "2028-01-01" })).toBe("Hai tài khoản phải khác nhau");
    expect(validateTransfer({ fromId: "a", toId: "b", amount: 1, occurredOn: "2028-01-02", today: "2028-01-01" })).toBe("Ngày chuyển không được sau hôm nay");
    expect(validateTransfer({ fromId: "a", toId: "b", amount: 3_000_000, occurredOn: "2028-01-01", today: "2028-01-01" })).toBeNull();
    expect(codSettlement(1_000_000, 985_000)).toEqual({ transfer: 985_000, fee: 15_000 });
    expect(codSettlement(1_000_000, 1_000_001)).toEqual({ error: "Số hãng trả lớn hơn số COD" });
  });
  it("R-TC-6: chỉ hủy phiếu tay", () => {
    expect(manualCancelProblem({ status: "posted", sourceType: null, idempotencyKey: null })).toBeNull();
    expect(manualCancelProblem({ status: "posted", sourceType: "manual", idempotencyKey: null })).toBeNull();
    expect(manualCancelProblem({ status: "posted", sourceType: "reconciliation", idempotencyKey: null })).toBeNull();
    expect(manualCancelProblem({ status: "posted", sourceType: "order", idempotencyKey: "order-paid:x" })).toBe("Phiếu tạo từ nghiệp vụ, hủy ở chứng từ gốc (đơn, công nợ, phiếu nhập, đổi trả)");
    expect(manualCancelProblem({ status: "posted", sourceType: null, idempotencyKey: "order-paid:x" })).toMatch(/từ nghiệp vụ/);
    expect(manualCancelProblem({ status: "posted", sourceType: "payable", idempotencyKey: "debt-payment:x" })).toMatch(/Hủy thanh toán/);
    expect(manualCancelProblem({ status: "cancelled", sourceType: null, idempotencyKey: null })).toBe("Phiếu đã hủy");
  });
  it("R-TC-8: hệ thống 5.250.000, thực tế 5.200.000 → PC 50.000 CHI-CHENH-LECH", () => {
    expect(reconciliationAdjustment(5_250_000, 5_200_000)).toEqual({ difference: -50_000, direction: "out", categoryCode: "CHI-CHENH-LECH", amount: 50_000 });
    expect(reconciliationAdjustment(100, 130)).toEqual({ difference: 30, direction: "in", categoryCode: "THU-CHENH-LECH", amount: 30 });
    expect(reconciliationAdjustment(100, 100).direction).toBeNull();
  });
});

describe("R-TC-14: tuổi nợ (AC-TC-13)", () => {
  const today = "2028-01-20";
  it("quá hạn, nhóm, sắp đến hạn", () => {
    expect(overdueDays("2028-01-05", today)).toBe(15);
    expect(agingBucket("2028-01-05", today)).toBe("d1_30");
    expect(overdueDays("2027-10-15", today)).toBe(97);
    expect(agingBucket("2027-10-15", today)).toBe("d90_plus");
    expect(agingBucket("2028-01-25", today)).toBe("current");
    expect(isDueSoon("2028-01-25", today, 7)).toBe(true);
    expect(isDueSoon("2028-01-28", today, 7)).toBe(false);
    expect(isDueSoon("2028-01-19", today, 7)).toBe(false);
    expect(agingBucket("2027-11-21", today)).toBe("d31_60");
    expect(agingBucket("2027-10-22", today)).toBe("d61_90");
  });
  it("cộng số còn lại theo nhóm, bỏ khoản đã trả/hủy", () => {
    const s = agingSummary(
      [
        { amount: 1_000, paidAmount: 400, status: "partial", dueOn: "2028-01-05" },
        { amount: 500, paidAmount: 0, status: "open", dueOn: "2027-10-15" },
        { amount: 900, paidAmount: 900, status: "paid", dueOn: "2027-10-15" },
        { amount: 700, paidAmount: 0, status: "cancelled", dueOn: "2027-10-15" },
        { amount: 300, paidAmount: 0, status: "open", dueOn: "2028-01-25" },
      ],
      today,
    );
    expect(s).toEqual({ current: 300, d1_30: 600, d31_60: 0, d61_90: 0, d90_plus: 500 });
  });
});

describe("R-TC-16: ngân sách (AC-TC-14)", () => {
  it("dòng nhóm trừ hạng mục có dòng riêng; 85% vàng, 120% đỏ", () => {
    const res = computeBudgetLines(
      [
        { id: "g", group: "marketing", categoryId: null, amount: 2_000_000 },
        { id: "c", group: "marketing", categoryId: "hh", amount: 500_000 },
      ],
      [
        { categoryId: "mkt", group: "marketing", amount: 1_700_000 },
        { categoryId: "hh", group: "marketing", amount: 600_000 },
        { categoryId: "luong", group: "personnel", amount: 9_000_000 },
      ],
      8000,
    );
    expect(res[0]).toMatchObject({ actual: 1_700_000, ratioBp: 8500, tone: "amber", over: 0 });
    expect(res[1]).toMatchObject({ actual: 600_000, ratioBp: 12000, tone: "red", over: 100_000 });
  });
  it("vượt 100% đỏ; ngân sách 0 mà có chi → đỏ", () => {
    expect(budgetTone(2_100_000, 2_000_000, 8000)).toBe("red");
    expect(budgetTone(2_000_000, 2_000_000, 8000)).toBe("amber");
    expect(budgetTone(1_500_000, 2_000_000, 8000)).toBe("green");
    expect(budgetTone(1, 0, 8000)).toBe("red");
    expect(budgetTone(0, 0, 8000)).toBe("green");
  });
  it("kỳ tháng/quý/năm", () => {
    expect(normalizePeriodStart("quarter", "2028-05-17")).toBe("2028-04-01");
    expect(periodBounds("month", "2028-12-05")).toEqual({ from: "2028-12-01", to: "2029-01-01" });
    expect(periodBounds("quarter", "2028-11-05")).toEqual({ from: "2028-10-01", to: "2029-01-01" });
    expect(periodBounds("year", "2028-11-05")).toEqual({ from: "2028-01-01", to: "2029-01-01" });
    expect(previousPeriodStart("month", "2028-01-01")).toBe("2027-12-01");
  });
});

describe("R-TC-17…R-TC-20: giá vốn", () => {
  it("R-TC-18 (AC-TC-16): 1.000.000 cho 300 và 196 chai → 604.839 / 395.161", () => {
    expect(allocateLargestRemainder(1_000_000, [300, 196])).toEqual([604_839, 395_161]);
    expect(allocateLargestRemainder(10, [0, 0])).toBeNull();
    expect(allocateLargestRemainder(2, [1, 1, 1])).toEqual([1, 1, 0]);
    const big = allocateLargestRemainder(2_000_000_000, [9_000_000_000_000, 1_000_000_000_000])!;
    expect(big.reduce((a, b) => a + b, 0)).toBe(2_000_000_000);
  });
  it("R-TC-17 (AC-TC-15): 16.800.000 / 296 chai = 56.757, kế hoạch 56.000, chênh +757", () => {
    expect(costVsPlan({ totalCost: 16_800_000, goodUnits: 296, plannedCost: 16_800_000, plannedUnits: 300 })).toEqual({ unitCost: 56_757, plannedUnitCost: 56_000, diffPerUnit: 757, diffBp: 135 });
    expect(formatBpPct(changeBp(54_000, 56_757))).toBe("−4,9%");
  });
  it("R-TC-20 (AC-TC-18): 2.000.000 rồi 2.300.000 → +15%", () => {
    expect(changeBp(2_300_000, 2_000_000)).toBe(1500);
    expect(formatBpPct(1500)).toBe("+15%");
    expect(changeBp(1, 0)).toBeNull();
  });
  it("R-TC-18 gợi ý, R-TC-19 gợi ý chốt", () => {
    expect(suggestedOverhead(2_000_000, 500_000)).toBe(1_500_000);
    expect(suggestedOverhead(100, 500)).toBe(0);
    expect(shouldSuggestLock({ status: "completed", finishedOn: "2028-01-31", locked: false }, "2028-02-01")).toBe(true);
    expect(shouldSuggestLock({ status: "completed", finishedOn: "2028-02-01", locked: false }, "2028-02-20")).toBe(false);
    expect(shouldSuggestLock({ status: "qc", finishedOn: "2028-01-01", locked: false }, "2028-03-01")).toBe(false);
  });
});

describe("R-TC-22…R-TC-24: lãi lỗ", () => {
  it("AC-TC-22: doanh thu thuần 185.000 → lợi nhuận ròng 60.000, biên 3.243 bp", () => {
    const r = computePnl({ ...zeroPnl, goodsRevenue: 185_000, cogs: 65_000, sellingTx: 30_000, marketingTx: 15_000, adminTx: 15_000 });
    expect(r.netRevenue).toBe(185_000);
    expect(r.netProfit).toBe(60_000);
    expect(r.marginBp).toBe(3243);
  });
  it("AC-TICHHOP-7: 458.000 + 25.000 − 113.514 = lãi gộp 369.486; ghi chú chi SX chưa vào giá vốn", () => {
    const r = computePnl({ ...zeroPnl, goodsRevenue: 458_000, shippingIncome: 25_000, cogs: 113_514, capitalizedTx: 2_000_000, capitalizedAbsorbed: 0 });
    expect(r.grossProfit).toBe(369_486);
    expect(r.capitalizedNotInCost).toBe(2_000_000);
    expect(r.netProfit).toBe(369_486);
  });
  it("chi phí khác gồm hủy, kiểm kê thiếu, hao hụt hủy lệnh; thu nhập khác gồm kiểm kê thừa", () => {
    const r = computePnl({ ...zeroPnl, otherExpenseTx: 1, scrapValue: 10, countLoss: 100, cancelLoss: 1000, otherIncomeTx: 5, countGain: 50, taxTx: 7 });
    expect(r.otherExpense).toBe(1111);
    expect(r.otherIncome).toBe(55);
    expect(r.netProfit).toBe(55 - 1111 - 7);
    expect(r.marginBp).toBeNull();
  });
  it("R-TC-23 (AC-TC-23): chiết khấu 30.000 cho 229.000 + 69.000 → 23.054 / 6.946", () => {
    expect(splitOrderAmounts([{ lineTotal: 229_000 }, { lineTotal: 69_000 }], 30_000, 0)).toEqual([
      { discount: 23_054, platformFee: 0 },
      { discount: 6_946, platformFee: 0 },
    ]);
  });
  it("R-TC-24: lợi nhuận góp và sau marketing", () => {
    expect(channelMetrics({ netRevenue: 1_000_000, cogs: 300_000, platformFee: 100_000, marketing: 200_000 })).toEqual({ contribution: 600_000, afterMarketing: 400_000, revenuePerMarketing: 5 });
    expect(channelMetrics({ netRevenue: 1, cogs: 0, platformFee: 0, marketing: 0 }).revenuePerMarketing).toBeNull();
  });
});

describe("R-TC-26, R-TC-27, R-TC-29", () => {
  it("AC-TC-25: dự báo 8 tuần, tuần 2 thiếu 3.000.000", () => {
    const today = "2028-01-20";
    const fc = forecastCash({
      today,
      weeks: 8,
      openingBalance: 10_000_000,
      receivables: [{ remaining: 3_500_000, dueOn: "2028-01-05" }],
      payables: [
        { remaining: 4_500_000, dueOn: "2028-01-22" },
        { remaining: 12_000_000, dueOn: "2028-01-27" },
        { remaining: 99, dueOn: "2028-06-01" },
      ],
      pendingRequests: 0,
      minCash: 0,
    });
    expect(fc.weeks).toHaveLength(8);
    expect(fc.weeks[0]!.closing).toBe(9_000_000);
    expect(fc.weeks[1]!.closing).toBe(-3_000_000);
    expect(fc.weeks[7]!.closing).toBe(-3_000_000);
    expect(fc.shortages[0]).toEqual({ week: 2, from: "2028-01-27", shortBy: 3_000_000 });
    expect(shortageText(fc.shortages[0]!)).toBe("Tuần 2 (từ 27/01) có thể thiếu 3.000.000đ");
    const withPending = forecastCash({ today, weeks: 2, openingBalance: 100, receivables: [], payables: [], pendingRequests: 30, minCash: 80 });
    expect(withPending.weeks[0]!.closing).toBe(70);
    expect(withPending.shortages[0]!.shortBy).toBe(10);
  });
  it("AC-TC-26: vốn lưu động 5.500.000", () => {
    expect(workingCapital({ stockValue: 16_000_000, receivables: 3_500_000, payables: 14_000_000 })).toBe(5_500_000);
  });
  it("AC-TC-28: CSV UTF-8 có BOM, tiền số nguyên", () => {
    const csv = toCsv(["Dòng", "Số tiền"], [["Doanh thu thuần, kỳ 11", 458_000], ["Giá vốn \"lô\"", 113_513.5]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe('﻿Dòng,Số tiền\r\n"Doanh thu thuần, kỳ 11",458000\r\n"Giá vốn ""lô""",113514\r\n');
  });
});

describe("AC-TC-29: quyền", () => {
  it("cộng tác viên chỉ lập đề nghị chi; chỉ xem không có quyền tài chính", () => {
    expect(can("collaborator", "finance.request")).toBe(true);
    for (const p of ["finance.view", "finance.write", "finance.approve"] as const) {
      expect(can("collaborator", p)).toBe(false);
      expect(can("viewer", p)).toBe(false);
    }
    expect(can("viewer", "finance.request")).toBe(false);
    expect(can("owner", "finance.approve")).toBe(true);
  });
});

describe("ô nhập tiền", () => {
  it("kiểu Việt Nam, số nguyên", async () => {
    const { parseMoneyInput } = await import("@/modules/finance/rules");
    expect(parseMoneyInput("1.500.000")).toBe(1_500_000);
    expect(parseMoneyInput("1 500 000đ")).toBe(1_500_000);
    expect(parseMoneyInput("1,5")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("-50.000")).toBeNull();
    expect(parseMoneyInput("-50.000", { allowNegative: true })).toBe(-50_000);
  });
});
