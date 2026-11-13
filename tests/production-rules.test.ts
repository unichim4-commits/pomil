import { describe, expect, it } from "vitest";
import { checkDevStage, checkGtin13, resolveDevStage, sizeLabelFromNet, DISCONTINUED_ACTIVE } from "@/modules/catalog/rules";
import { computeProductionCost } from "@/modules/production/costing";
import {
  avgDays,
  batchesFor,
  buildOrderMaterials,
  bulkForUnits,
  cancelPermission,
  checkCustomLotNo,
  checkFinishStep,
  checkFormulaItem,
  checkFormulaTotals,
  checkIssue,
  checkOrderReady,
  checkOrderVersion,
  checkReturn,
  checkStartStep,
  convertForItem,
  costVariance,
  DEVIATION_BLOCK,
  diffVersions,
  equipmentSummary,
  extractionTotalCost,
  FACTORY_SUPPLIES,
  formatHours,
  formatPercent,
  formatRecovery,
  formulaRequirement,
  formulaVersionLabel,
  hoursPerBatch,
  nextLotNo,
  orderMetrics,
  orderMovePermission,
  parseParams,
  parsePercent,
  performanceSummary,
  plannedCostOf,
  planLineProgress,
  qcResultFromLot,
  recoveryOf,
  resolveOutput,
  scaleFormula,
  shortageOf,
  type PerfOrder,
} from "@/modules/production/rules";

const water = { itemId: "w", itemCode: "NL-001", ppm: 0, isBalance: true };
const td2 = { itemId: "t2", itemCode: "TD-002", ppm: 150_000, isBalance: false };
const nl2 = { itemId: "n2", itemCode: "NL-002", ppm: 100_000, isBalance: false };
const nl3 = { itemId: "n3", itemCode: "NL-003", ppm: 50_000, isBalance: false };

describe("R-CHUNG-3 tỷ lệ phần triệu", () => {
  it("đọc và hiển thị %", () => {
    expect(parsePercent("15%")).toEqual({ ok: true, ppm: 150_000 });
    expect(parsePercent("0,5")).toEqual({ ok: true, ppm: 5_000 });
    expect(parsePercent("0,05")).toEqual({ ok: true, ppm: 500 });
    expect(parsePercent("0,0001")).toEqual({ ok: true, ppm: 1 });
    expect(parsePercent("0,00005")).toEqual({ ok: false, message: "Tỷ lệ nhỏ nhất 0,0001%" });
    expect(parsePercent("abc").ok).toBe(false);
    expect(formatPercent(150_000)).toBe("15%");
    expect(formatPercent(5_000)).toBe("0,5%");
  });
});

describe("R-SX-1, R-SX-2 sản phẩm (AC-SX-1…3)", () => {
  it("ngừng sản xuất + đang bán bị chặn; đang phát triển + đang bán chỉ cảnh báo", () => {
    expect(checkDevStage("discontinued", "active").error).toBe(DISCONTINUED_ACTIVE);
    const dev = checkDevStage("developing", "active");
    expect(dev.error).toBeNull();
    expect(dev.warning).toBeTruthy();
    expect(checkDevStage("discontinued", "archived")).toEqual({ error: null, warning: null });
  });
  it("không gửi giai đoạn: giữ cũ; tạo mới theo trạng thái", () => {
    expect(resolveDevStage(undefined, "testing", "active")).toBe("testing");
    expect(resolveDevStage(undefined, null, "active")).toBe("commercial");
    expect(resolveDevStage(undefined, null, "draft")).toBe("developing");
    expect(resolveDevStage("discontinued", "commercial", "active")).toBe("discontinued");
  });
  it("GTIN-13", () => {
    expect(checkGtin13("8938500000003")).toBeNull();
    expect(checkGtin13("8938500000004")).toBe("Mã vạch sai số kiểm tra");
    expect(checkGtin13("12345")).toBeTruthy();
    expect(sizeLabelFromNet(100_000, "ul")).toBe("100 ml");
  });
});

describe("R-SX-4 nhãn phiên bản", () => {
  it("theo mã sản phẩm hoặc mã công thức", () => {
    expect(formulaVersionLabel("PST", "FORM-001", 2)).toBe("PST-v2");
    expect(formulaVersionLabel(null, "FORM-003", 1)).toBe("FORM-003-v1");
  });
});

describe("R-SX-5 tổng tỷ lệ (AC-SX-5)", () => {
  it("dòng cân bằng nhận phần còn lại", () => {
    expect(checkFormulaTotals([water, td2, nl2, nl3])).toEqual({ ok: true, balancePpm: 700_000 });
  });
  it("không cân bằng phải đúng 100%", () => {
    const r = checkFormulaTotals([{ ...water, isBalance: false, ppm: 700_000 }, td2, nl2, { ...nl3, ppm: 40_000 }]);
    expect(r).toEqual({ ok: false, message: "Tổng tỷ lệ 99%, cần đúng 100%" });
  });
  it("có cân bằng mà các dòng khác vượt 100%", () => {
    const r = checkFormulaTotals([water, { ...td2, ppm: 1_000_000 }, { ...nl3, ppm: 10_000 }]);
    expect(r).toEqual({ ok: false, message: "Các dòng khác đã 101%, vượt 100%" });
  });
  it("một hàng một dòng, một dòng cân bằng", () => {
    expect(checkFormulaTotals([td2, td2]).ok).toBe(false);
    expect(checkFormulaTotals([water, { ...nl2, isBalance: true }]).ok).toBe(false);
  });
});

describe("R-SX-6 hàng trong công thức", () => {
  it("bao bì khai ở định mức bao bì", () => {
    expect(checkFormulaItem({ code: "BB-001", kind: "packaging", baseUom: "pcs" })).toBe("Bao bì khai ở định mức bao bì");
    expect(checkFormulaItem({ code: "TD-001", kind: "extract", baseUom: "ul" })).toBeNull();
    expect(checkFormulaItem({ code: "X", kind: "raw_material", baseUom: "pcs" })).toBeTruthy();
  });
});

describe("R-SX-7 scaleFormula (AC-SX-6)", () => {
  it("phần chênh vào dòng ppm lớn nhất", () => {
    const r = scaleFormula(1_000, [
      { ppm: 333_333, isBalance: false },
      { ppm: 333_333, isBalance: false },
      { ppm: 333_334, isBalance: false },
    ]);
    expect(r).toEqual([333, 333, 334]);
  });
  it("mẻ 30.612.245 ul với công thức R-SX-5", () => {
    const r = scaleFormula(30_612_245, [water, td2, nl2, nl3]);
    expect(r).toEqual([21_428_571, 4_591_837, 3_061_225, 1_530_612]);
    expect(r.reduce((s, x) => s + x, 0)).toBe(30_612_245);
  });
  it("bằng ppm thì dòng sort nhỏ nhất", () => {
    expect(scaleFormula(10, [{ ppm: 500_000, isBalance: false, sort: 2 }, { ppm: 500_000, isBalance: false, sort: 1 }])).toEqual([5, 5]);
    expect(scaleFormula(3, [{ ppm: 500_000, isBalance: false, sort: 2 }, { ppm: 500_000, isBalance: false, sort: 1 }])).toEqual([2, 1]);
  });
});

describe("R-SX-8 đổi đơn vị (AC-SX-7)", () => {
  it("mẻ 100 kg, tinh dầu 0,5%, khối lượng riêng 850 → 588.235 ul", () => {
    const item = { id: "td1", code: "TD-001", kind: "extract", baseUom: "ul" as const, densityMgPerMl: 850 };
    const r = formulaRequirement(100_000_000, "mg", [
      { ppm: 5_000, isBalance: false, item },
      { ppm: 0, isBalance: true, item: { id: "w", code: "NL-001", kind: "raw_material", baseUom: "mg", densityMgPerMl: null } },
    ]);
    expect(r.ok && r.lines[0]).toEqual({ itemId: "td1", qtyBatchUom: 500_000, qty: 588_235 });
  });
  it("thiếu khối lượng riêng", () => {
    const r = convertForItem(500_000, "mg", { code: "TD-001", baseUom: "ul", densityMgPerMl: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("Thiếu khối lượng riêng của TD-001");
  });
});

describe("R-SX-9, R-SX-15 phiên bản và trường của lệnh (AC-SX-15)", () => {
  it("tự làm cần bản approved/trial", () => {
    expect(checkOrderVersion("in_house", null, null)).toBeTruthy();
    expect(checkOrderVersion("in_house", "draft", null)).toBeTruthy();
    expect(checkOrderVersion("in_house", "archived", null)).toBeTruthy();
    expect(checkOrderVersion("in_house", "trial", null)).toBeNull();
    expect(checkOrderVersion("outsourced", null, "Công thức nhà máy A")).toBeNull();
  });
  it("gia công cần nhà máy", () => {
    expect(checkOrderReady({ kind: "outsourced", productId: "p", plannedUnits: 300, versionStatus: null, formulaLabel: "NM", supplierId: null, supplierKind: null })).toBe("Lệnh gia công cần chọn nhà máy");
    expect(checkOrderReady({ kind: "outsourced", productId: "p", plannedUnits: 300, versionStatus: null, formulaLabel: "NM", supplierId: "s", supplierKind: "farm" })).toBe("Lệnh gia công cần chọn nhà máy");
    expect(checkOrderReady({ kind: "outsourced", productId: "p", plannedUnits: 300, versionStatus: null, formulaLabel: "NM", supplierId: "s", supplierKind: "factory" })).toBeNull();
  });
  it("quyền theo bước chuyển", () => {
    expect(orderMovePermission("planned", "approved")).toBe("production.approve");
    expect(orderMovePermission("draft", "planned")).toBe("production.write");
    expect(orderMovePermission("qc", "cancelled")).toBeNull();
    expect(cancelPermission("in_progress")).toBe("production.approve");
    expect(cancelPermission("draft")).toBe("production.write");
    expect(cancelPermission("qc")).toEqual({ error: "Lệnh đã ghi sản lượng, không hủy được" });
  });
});

describe("R-SX-11 so sánh phiên bản (AC-SX-9)", () => {
  it("hai thay đổi", () => {
    const v1 = { batchSize: 100, batchUom: "ul" as const, lines: [water, td2, nl2, nl3], packaging: [] };
    const v2 = { ...v1, lines: [water, { ...td2, ppm: 120_000 }, nl2, nl3, { itemId: "n4", itemCode: "NL-004", ppm: 30_000, isBalance: false }] };
    expect(diffVersions(v1, v2)).toEqual(["TD-002: 15% → 12%", "Thêm NL-004: 3%"]);
  });
  it("cỡ mẻ và bao bì", () => {
    const a = { batchSize: 100, batchUom: "ul" as const, lines: [], packaging: [{ itemId: "b", itemCode: "BB-001", qtyPerUnit: 1 }] };
    const b = { batchSize: 200, batchUom: "ul" as const, lines: [], packaging: [{ itemId: "b", itemCode: "BB-001", qtyPerUnit: 2 }] };
    expect(diffVersions(a, b)).toHaveLength(2);
  });
});

describe("R-SX-12 nhu cầu kế hoạch (AC-SX-11, AC-SX-13)", () => {
  const base = { netQty: 100_000, netUom: "ul" as const, batchUom: "ul" as const, bulkDensityMgPerMl: null, expectedYieldBp: 9_800 };
  it("300 chai → 1 mẻ; 1.000 chai → 2 mẻ", () => {
    expect(bulkForUnits({ ...base, targetUnits: 300 })).toEqual({ ok: true, bulk: 30_612_245 });
    expect(batchesFor(30_612_245, 100_000_000)).toBe(1);
    const b = bulkForUnits({ ...base, targetUnits: 1_000 });
    expect(b).toEqual({ ok: true, bulk: 102_040_817 });
    expect(batchesFor(102_040_817, 100_000_000)).toBe(2);
  });
  it("thiếu dung tích", () => {
    expect(bulkForUnits({ ...base, netQty: null, targetUnits: 300 })).toEqual({ ok: false, message: "Nhập dung tích sản phẩm trước khi lập kế hoạch" });
  });
  it("khác chiều cần khối lượng riêng bán thành phẩm", () => {
    expect(bulkForUnits({ ...base, batchUom: "mg", targetUnits: 1 }).ok).toBe(false);
    expect(bulkForUnits({ ...base, batchUom: "mg", bulkDensityMgPerMl: 1_000, expectedYieldBp: 10_000, targetUnits: 1 })).toEqual({ ok: true, bulk: 100_000 });
  });
});

describe("R-SX-13, R-SX-14, R-SX-16", () => {
  it("thiếu 591.837 ul (AC-SX-12)", () => {
    expect(shortageOf(4_591_837, 10_000_000, 6_000_000)).toBe(591_837);
    expect(shortageOf(100, 1_000, 0)).toBe(0);
  });
  it("ước tính 10,7 giờ (AC-SX-14)", () => {
    const h = hoursPerBatch([
      { startedAt: new Date("2027-01-01T00:00:00Z"), finishedAt: new Date("2027-01-01T06:00:00Z"), batchCount: 1 },
      { startedAt: new Date("2027-01-02T00:00:00Z"), finishedAt: new Date("2027-01-02T10:00:00Z"), batchCount: 2 },
    ]);
    expect(h).toBeCloseTo(16 / 3);
    expect(formatHours(h! * 2)).toBe("khoảng 10,7 giờ");
    expect(hoursPerBatch([])).toBeNull();
    expect(avgDays([])).toBeNull();
  });
  it("tiến độ dòng kế hoạch bỏ lệnh hủy", () => {
    const p = planLineProgress(300, [
      { status: "completed", plannedUnits: 300, goodUnits: 296 },
      { status: "cancelled", plannedUnits: 100, goodUnits: null },
    ]);
    expect(p).toEqual({ ordered: 300, good: 296, pctBp: 9_867 });
  });
});

describe("R-SX-17 định mức vật tư", () => {
  it("gia công mặc định nhà máy cấp; bao bì = số chai × định mức", () => {
    const item = { id: "td", code: "TD-002", kind: "extract", baseUom: "ul" as const, densityMgPerMl: null };
    const r = buildOrderMaterials({ kind: "outsourced", plannedUnits: 300, plannedBulk: 1_000, batchUom: "ul", lines: [{ ppm: 1_000_000, isBalance: false, item }], packaging: [{ itemId: "bb", qtyPerUnit: 1 }] });
    expect(r.ok && r.materials).toEqual([
      { itemId: "td", role: "formula", plannedQty: 1_000, suppliedBy: "factory", sort: 0 },
      { itemId: "bb", role: "packaging", plannedQty: 300, suppliedBy: "factory", sort: 1000 },
    ]);
    const ih = buildOrderMaterials({ kind: "in_house", plannedUnits: 300, plannedBulk: null, batchUom: "ul", lines: [{ ppm: 1_000_000, isBalance: false, item }], packaging: [] });
    expect(ih.ok).toBe(false);
  });
});

describe("R-SX-18 xuất, trả NVL (AC-SX-18, AC-SX-19)", () => {
  const m = { role: "formula", plannedQty: 150_000, suppliedBy: "pomil" as const };
  it("vượt 5% cần lý do", () => {
    expect(checkIssue({ orderStatus: "in_progress", material: m, netIssued: 150_000, qty: 10_000, overIssueWarnBp: 500, reason: null })).toContain("ghi lý do");
    expect(checkIssue({ orderStatus: "in_progress", material: m, netIssued: 150_000, qty: 10_000, overIssueWarnBp: 500, reason: "Rơi vãi" })).toBeNull();
    expect(checkIssue({ orderStatus: "in_progress", material: m, netIssued: 150_000, qty: 7_000, overIssueWarnBp: 500, reason: null })).toBeNull();
  });
  it("nhà máy tự cấp, chưa duyệt, ngoài định mức", () => {
    expect(checkIssue({ orderStatus: "approved", material: { ...m, suppliedBy: "factory" }, netIssued: 0, qty: 1, overIssueWarnBp: 500, reason: null })).toBe(FACTORY_SUPPLIES);
    expect(checkIssue({ orderStatus: "planned", material: m, netIssued: 0, qty: 1, overIssueWarnBp: 500, reason: null })).toBeTruthy();
    expect(checkIssue({ orderStatus: "approved", material: null, netIssued: 0, qty: 1, overIssueWarnBp: 500, reason: null })).toContain("dòng phát sinh");
  });
  it("trả không vượt số đã xuất từ lô", () => {
    expect(checkReturn(10_000, 160_000, "VT-1")).toBeNull();
    expect(checkReturn(200_000, 160_000, "VT-1")).toBe("Trả vượt số đã xuất từ lô VT-1");
  });
});

describe("R-SX-19, R-SX-30 ghi sản lượng (AC-SX-20, AC-SX-22)", () => {
  const base = { kind: "outsourced" as const, goodUnits: 296, rejectedUnits: 4, manufacturedOn: "2027-11-20", expiresOn: null, actualBulk: null, outsourcingUnitPrice: 40_000, outsourcingCost: null };
  it("hạn mặc định 730 ngày, chi phí gia công mặc định", () => {
    expect(resolveOutput(base, "2027-11-20", 730)).toEqual({ ok: true, manufacturedOn: "2027-11-20", expiresOn: "2029-11-19", outsourcingCost: 12_000_000, actualBulk: null });
  });
  it("chưa có đơn giá, ngày tương lai, thiếu hạn", () => {
    expect(resolveOutput({ ...base, outsourcingUnitPrice: null }, "2027-11-20", 730)).toEqual({ ok: false, message: "Nhập đơn giá gia công trước" });
    expect(resolveOutput({ ...base, manufacturedOn: "2027-11-21" }, "2027-11-20", 730).ok).toBe(false);
    expect(resolveOutput(base, "2027-11-20", null).ok).toBe(false);
    expect(resolveOutput({ ...base, goodUnits: 0 }, "2027-11-20", 730).ok).toBe(false);
    expect(resolveOutput({ ...base, kind: "in_house" }, "2027-11-20", 730).ok).toBe(false);
  });
  it("số lô tiếp theo (AC-SX-21)", () => {
    expect(nextLotNo("PST", "2027-11-20", [])).toBe("PST-271120-01");
    expect(nextLotNo("PST", "2027-11-20", ["PST-271120-01"])).toBe("PST-271120-02");
    expect(nextLotNo("PST", "2027-11-20", ["PST-271120-02"])).toBe("PST-271120-03");
    expect(checkCustomLotNo("PST-271120-05", "PST")).toBeNull();
    expect(checkCustomLotNo("ABC-271120-05", "PST")).toBeTruthy();
    expect(checkCustomLotNo("PST-2711", "PST")).toBeTruthy();
  });
});

describe("R-SX-20 kết quả QC (AC-SX-23)", () => {
  it("theo trạng thái lô", () => {
    expect(qcResultFromLot("quarantine", null)).toEqual({ ok: false, message: "Lô chưa có kết luận FQC" });
    expect(qcResultFromLot("released", new Date())).toEqual({ ok: true, result: "pass" });
    expect(qcResultFromLot("rejected", null)).toEqual({ ok: true, result: "fail" });
    expect(qcResultFromLot("on_hold", new Date())).toEqual({ ok: true, result: "pass" });
  });
});

describe("R-SX-22 công đoạn (AC-SX-24)", () => {
  const steps = [
    { seq: 1, status: "done" as const },
    { seq: 2, status: "in_progress" as const },
    { seq: 3, status: "pending" as const },
  ];
  it("sai lệch chặn, công đoạn trước chưa xong chặn", () => {
    expect(checkStartStep(steps, 3, true)).toBe(DEVIATION_BLOCK);
    expect(checkStartStep(steps, 3, false)).toBe("Làm xong công đoạn 2 trước");
    expect(checkStartStep([{ seq: 1, status: "skipped" }, { seq: 2, status: "pending" }], 2, false)).toBeNull();
  });
  it("công đoạn cần QC chỉ xong khi IPQC mới nhất đạt", () => {
    expect(checkFinishStep({ status: "in_progress", needsQc: true }, "failed")).toBeTruthy();
    expect(checkFinishStep({ status: "in_progress", needsQc: true }, "passed")).toBeNull();
    expect(checkFinishStep({ status: "in_progress", needsQc: false }, null)).toBeNull();
  });
});

describe("R-SX-24, R-SX-25 mẻ chiết (AC-SX-26)", () => {
  it("thu hồi 0,68% hoặc 8 ml/kg", () => {
    const r = recoveryOf(50_000_000, 400_000, "ul", 850);
    expect(r).toEqual({ kind: "percent", bp: 68 });
    expect(formatRecovery(r)).toBe("0,68%");
    const r2 = recoveryOf(50_000_000, 400_000, "ul", null);
    expect(r2).toEqual({ kind: "ml_per_kg", value: 8 });
    expect(formatRecovery(r2)).toBe("8 ml/kg");
  });
  it("giá thành mẻ", () => {
    expect(extractionTotalCost(1_000_000, 1_500_000, 0)).toBe(2_500_000);
  });
  it("thông số ×1000", () => {
    expect(parseParams("Nhiệt độ | 100,5 | °C\nThời gian | 6 | giờ")).toEqual({
      ok: true,
      params: [
        { name: "Nhiệt độ", valueMilli: 100_500, unit: "°C" },
        { name: "Thời gian", valueMilli: 6_000, unit: "giờ" },
      ],
    });
    expect(parseParams("chỉ tên").ok).toBe(false);
  });
});

describe("R-SX-26, R-SX-27 giá thành (AC-SX-28, AC-SX-16)", () => {
  it("tự làm 19.500.000đ / 300 chai = 65.000đ", () => {
    expect(computeProductionCost({ material: 10_500_000, packaging: 4_500_000, labor: 2_400_000, overheadManual: 2_100_000, overheadAllocated: 0, outsourcing: 0, other: 0, goodUnits: 300 })).toEqual({ total: 19_500_000, unitCost: 65_000 });
  });
  it("giá thành kế hoạch gia công 16.800.000đ, chênh +757đ/chai", () => {
    const pc = plannedCostOf({
      kind: "outsourced",
      plannedUnits: 300,
      outsourcingUnitPrice: 40_000,
      labor: 0,
      overhead: 0,
      materials: [
        { itemCode: "TD-001", plannedQty: 150_000, suppliedBy: "pomil", refUnitPrice: 2_000_000, purchaseUom: "l" },
        { itemCode: "BB-001", plannedQty: 300, suppliedBy: "pomil", refUnitPrice: 15_000, purchaseUom: "cái" },
        { itemCode: "NL-009", plannedQty: 300, suppliedBy: "factory", refUnitPrice: null, purchaseUom: "cái" },
        { itemCode: "BB-009", plannedQty: 5, suppliedBy: "pomil", refUnitPrice: null, purchaseUom: "cái" },
      ],
    });
    expect(pc).toEqual({ total: 16_800_000, missing: ["BB-009"] });
    const v = costVariance({ totalCost: 16_800_000, goodUnits: 296, plannedCost: 16_800_000, plannedUnits: 300 });
    expect(v.actualUnit).toBe(56_757);
    expect(v.plannedUnit).toBe(56_000);
    expect(v.unitDiff).toBe(757);
    expect(v.unitDiffBp).toBe(135);
  });
});

describe("R-SX-28 hiệu suất (AC-SX-30)", () => {
  const o = (over: Partial<PerfOrder>): PerfOrder => ({
    kind: "outsourced",
    plannedUnits: 300,
    goodUnits: 296,
    rejectedUnits: 4,
    actualBulk: null,
    netQty: 100_000,
    totalCost: 16_800_000,
    batchCount: 1,
    qcResult: "pass",
    startedAt: null,
    approvedAt: new Date("2027-11-01T00:00:00Z"),
    finishedAt: new Date("2027-11-11T00:00:00Z"),
    ...over,
  });
  it("chỉ số một lệnh như ví dụ", () => {
    const m = orderMetrics(o({}));
    expect(m.goodVsPlanBp).toBe(9_867);
    expect(m.rejectBp).toBe(133);
    expect(m.unitCost).toBe(56_757);
    expect(m.costPerBatch).toBe(16_800_000);
    const ih = orderMetrics(o({ kind: "in_house", actualBulk: 30_500_000 }));
    expect(ih.bulkLossBp).toBe(164);
  });
  it("tỷ lệ mẻ đạt 4/5 = 80%", () => {
    const s = performanceSummary([o({}), o({}), o({}), o({}), o({ qcResult: "fail" })]);
    expect(s.passRateBp).toBe(8_000);
    expect(s.daysPerOrder).toBe(10);
  });
  it("theo thiết bị", () => {
    const r = equipmentSummary([
      { equipment: "Nồi chưng A", startedAt: new Date("2027-01-01T00:00:00Z"), endedAt: new Date("2027-01-01T06:00:00Z"), recovery: { kind: "percent", bp: 68 } },
      { equipment: "Nồi chưng A", startedAt: new Date("2027-01-02T00:00:00Z"), endedAt: new Date("2027-01-02T12:00:00Z"), recovery: { kind: "percent", bp: 70 } },
    ]);
    expect(r).toEqual([{ equipment: "Nồi chưng A", runs: 2, hours: 18, avgRecoveryBp: 69 }]);
  });
});
