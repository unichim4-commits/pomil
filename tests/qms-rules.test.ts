import { describe, expect, it } from "vitest";
import {
  CAPA_SUGGESTED_STEPS,
  canTransitionCapa,
  canTransitionNcr,
  checkCapaClose,
  checkCapaVerifying,
  checkDisposition,
  checkNcrClose,
  checkRecallClose,
  computeLotBalance,
  dispositionStatus,
  evaluateFromLotTests,
  evaluateParam,
  formatLimits,
  isOverdue,
  ncrCategoryForItemKind,
  ncrSeverityFromComplaint,
  ncrTransitionPermission,
  parseMeasure,
  recallReturnRate,
  releaseBlockerText,
  suggestVerdict,
  toCsv,
  type EvaluatedParam,
} from "@/modules/qms/rules";

// T-16: quy tắc thuần của phân hệ Chất lượng (03-chat-luong.md)

describe("R-CL-3: giá trị đo × 1000, gõ kiểu Việt Nam", () => {
  it("parses Vietnamese numbers", () => {
    expect(parseMeasure("5,5")).toEqual({ ok: true, milli: 5500 });
    expect(parseMeasure("1.000")).toEqual({ ok: true, milli: 1_000_000 });
    expect(parseMeasure("4,49")).toEqual({ ok: true, milli: 4490 });
    expect(parseMeasure("0,0005")).toEqual({ ok: true, milli: 1 });
    expect(parseMeasure("-2,5")).toEqual({ ok: true, milli: -2500 });
    expect(parseMeasure("abc").ok).toBe(false);
    expect(parseMeasure("").ok).toBe(false);
  });
  it("formats limits", () => {
    expect(formatLimits(4500, 5500, "")).toBe("4,5–5,5");
    expect(formatLimits(null, null)).toBe("Không giới hạn");
  });
});

describe("R-CL-4: đánh giá từng chỉ tiêu (AC-CL-3, AC-CL-16)", () => {
  const ph = { kind: "range" as const, minMilli: 4500, maxMilli: 5500 };
  it("pH 4,5–5,5: 5,6 không đạt; 5,5 đạt; 4,49 không đạt", () => {
    const v = (raw: string) => {
      const p = parseMeasure(raw);
      return p.ok ? evaluateParam({ ...ph, valueMilli: p.milli }) : "error";
    };
    expect(v("5,6")).toBe(false);
    expect(v("5,5")).toBe(true);
    expect(v("4,49")).toBe(false);
    expect(v("abc")).toBe("error");
  });
  it("range không giới hạn → null; pass_fail theo người kiểm; text → null", () => {
    expect(evaluateParam({ kind: "range", minMilli: null, maxMilli: null, valueMilli: 3000 })).toBeNull();
    expect(evaluateParam({ kind: "range", minMilli: 1000, maxMilli: null, valueMilli: 1000 })).toBe(true);
    expect(evaluateParam({ kind: "pass_fail", minMilli: null, maxMilli: null, valueMilli: null, passFail: false })).toBe(false);
    expect(evaluateParam({ kind: "text", minMilli: null, maxMilli: null, valueMilli: null })).toBeNull();
  });
  it("chỉ tiêu nối lot_tests: fail → false; pass → true; pending → null", () => {
    expect(evaluateFromLotTests("microbial", [{ type: "microbial", result: "pass" }])).toBe(true);
    expect(evaluateFromLotTests("microbial", [{ type: "microbial", result: "pass" }, { type: "microbial", result: "fail" }])).toBe(false);
    expect(evaluateFromLotTests("microbial", [{ type: "microbial", result: "pending" }, { type: "heavy_metals", result: "pass" }])).toBeNull();
  });
});

describe("R-CL-5, R-CL-6: kết luận gợi ý và quyết định (AC-CL-4)", () => {
  const p = (passed: boolean | null, isCritical = true, kind: EvaluatedParam["kind"] = "pass_fail"): EvaluatedParam => ({ kind, minMilli: null, maxMilli: null, isCritical, passed });
  it("4 chỉ tiêu, tạp chất không trọng yếu không đạt → Cần xem xét", () => {
    const params = [p(true), p(true), p(false, false), p(true)];
    expect(suggestVerdict(params)).toBe("review");
    expect(suggestVerdict([p(true), p(false)])).toBe("fail");
    expect(suggestVerdict([p(true), p(null)])).toBe("incomplete");
    // range không giới hạn chưa có kết quả không làm thiếu
    expect(suggestVerdict([p(true), p(null, true, "range"), p(null, true, "text")])).toBe("pass");
    expect(suggestVerdict([])).toBe("pass");
    expect(suggestVerdict([{ kind: "text", minMilli: null, maxMilli: null, isCritical: true, passed: null, fromLotTest: true }])).toBe("incomplete");
  });
  it("Đạt chỉ khi gợi ý Đạt; chấp nhận có điều kiện cần lý do, chỉ IQC/IPQC; trả NCC chỉ IQC", () => {
    expect(checkDisposition({ stage: "iqc", verdict: "review", disposition: "accept", note: null })).toMatch(/Chỉ chọn Đạt/);
    expect(checkDisposition({ stage: "iqc", verdict: "review", disposition: "use_as_is", note: "" })).toBe("Ghi lý do chấp nhận có điều kiện");
    expect(checkDisposition({ stage: "iqc", verdict: "review", disposition: "use_as_is", note: "Tạp chất ít" })).toBeNull();
    expect(checkDisposition({ stage: "fqc", verdict: "review", disposition: "use_as_is", note: "x" })).toMatch(/IQC và IPQC/);
    expect(checkDisposition({ stage: "ipqc", verdict: "fail", disposition: "use_as_is", note: "x" })).toMatch(/trọng yếu/);
    expect(checkDisposition({ stage: "iqc", verdict: "incomplete", disposition: "use_as_is", note: "x" })).toMatch(/chưa có kết quả/);
    expect(checkDisposition({ stage: "fqc", verdict: "pass", disposition: "reject", note: "" })).toBe("Ghi lý do không đạt");
    expect(checkDisposition({ stage: "fqc", verdict: "pass", disposition: "reject", note: "Nhãn lệch" })).toBeNull();
    expect(checkDisposition({ stage: "fqc", verdict: "fail", disposition: "return_to_supplier", note: "x" })).toMatch(/chỉ dùng cho IQC/);
    expect(checkDisposition({ stage: "iqc", verdict: "fail", disposition: "return_to_supplier", note: "x" })).toBeNull();
    expect(dispositionStatus("use_as_is")).toBe("passed");
    expect(dispositionStatus("return_to_supplier")).toBe("failed");
  });
});

describe("R-CL-8, R-CL-12, R-CL-16: NCR tự tạo, câu blocker", () => {
  it("maps categories and severities", () => {
    expect(ncrCategoryForItemKind("raw_material")).toBe("material");
    expect(ncrCategoryForItemKind("other")).toBe("material");
    expect(ncrCategoryForItemKind("extract")).toBe("extract");
    expect(ncrCategoryForItemKind("packaging")).toBe("packaging");
    expect(ncrSeverityFromComplaint("mild")).toBe("minor");
    expect(ncrSeverityFromComplaint("moderate")).toBe("major");
    expect(ncrSeverityFromComplaint("severe")).toBe("critical");
  });
  it("blocker texts", () => {
    expect(releaseBlockerText({ code: "missing_test", test: "heavy_metals" })).toBe("Thiếu phiếu kiểm nghiệm Kim loại nặng");
    expect(releaseBlockerText({ code: "failed_test", test: "microbial" })).toBe("Phiếu Vi sinh không đạt");
    expect(releaseBlockerText({ code: "notification_expired" })).toBe("Phiếu công bố đã hết hạn");
    expect(releaseBlockerText({ code: "no_notification" })).toBe("Chưa có phiếu công bố cho sản phẩm");
  });
});

describe("R-CL-15: NCR", () => {
  it("transitions and permissions", () => {
    expect(canTransitionNcr("open", "investigating")).toBe(true);
    expect(canTransitionNcr("open", "closed")).toBe(false);
    expect(canTransitionNcr("action", "cancelled")).toBe(false);
    expect(canTransitionNcr("verifying", "closed")).toBe(true);
    expect(canTransitionNcr("closed", "open")).toBe(false);
    expect(ncrTransitionPermission("closed")).toBe("quality.approve");
    expect(ncrTransitionPermission("cancelled")).toBe("quality.approve");
    expect(ncrTransitionPermission("action")).toBe("quality.write");
  });
  it("close needs cause, correction, verification; critical needs CAPA", () => {
    const base = { severity: "critical" as const, rootCause: "Nguyên liệu", correction: "Đổi NCC", verificationNote: "Đã kiểm", capaCount: 0 };
    expect(checkNcrClose(base)).toBe("NCR nghiêm trọng cần CAPA trước khi đóng");
    expect(checkNcrClose({ ...base, capaCount: 1 })).toBeNull();
    expect(checkNcrClose({ ...base, severity: "major", rootCause: " " })).toMatch(/nguyên nhân/);
  });
});

describe("R-CL-17, R-CL-18: CAPA và quá hạn", () => {
  it("transitions and checks", () => {
    expect(CAPA_SUGGESTED_STEPS).toHaveLength(7);
    expect(canTransitionCapa("verifying", "in_progress")).toBe(true);
    expect(canTransitionCapa("open", "closed")).toBe(false);
    expect(checkCapaVerifying([])).toMatch(/chưa có bước/);
    expect(checkCapaVerifying([{ doneAt: new Date() }, { doneAt: null }])).toBe("Còn 1 bước chưa xong");
    expect(checkCapaVerifying([{ doneAt: new Date() }])).toBeNull();
    expect(checkCapaClose({ effectivenessResult: "Không tái diễn", effective: false })).toMatch(/chưa hiệu quả/);
    expect(checkCapaClose({ effectivenessResult: "", effective: true })).toMatch(/kết quả/);
    expect(checkCapaClose({ effectivenessResult: "Không tái diễn", effective: true })).toBeNull();
  });
  it("overdue", () => {
    expect(isOverdue("2026-11-10", "2026-11-11", false)).toBe(true);
    expect(isOverdue("2026-11-11", "2026-11-11", false)).toBe(false);
    expect(isOverdue("2026-11-10", "2026-11-11", true)).toBe(false);
    expect(isOverdue(null, "2026-11-11", false)).toBe(false);
  });
});

describe("R-CL-21: cân đối lô (AC-CL-22)", () => {
  it("nhập 296, bán 120, mẫu 10, hủy 2, khách trả 3 (2 FG, 1 REJ) → tồn 167 (FG 166, REJ 1)", () => {
    const b = computeLotBalance([
      { type: "production_receipt", qty: 296, warehouseKind: "finished" },
      { type: "sale_issue", qty: -121, warehouseKind: "finished" },
      { type: "reversal", originalType: "sale_issue", qty: 1, warehouseKind: "finished" },
      { type: "sample_issue", qty: -4, warehouseKind: "finished" },
      { type: "qc_sample_issue", qty: -6, warehouseKind: "finished" },
      { type: "scrap_issue", qty: -2, warehouseKind: "finished" },
      { type: "return_receipt", qty: 2, warehouseKind: "finished" },
      { type: "return_receipt", qty: 1, warehouseKind: "rejected" },
      { type: "transfer_out", qty: -5, warehouseKind: "finished" },
      { type: "transfer_in", qty: 5, warehouseKind: "finished" },
    ]);
    expect(b).toMatchObject({ received: 296, sold: 120, samples: 10, scrap: 2, returned: 3, other: 0, onHand: 167, balanced: true });
    expect(b.onHandByWarehouse).toEqual({ finished: 166, rejected: 1 });
  });
});

describe("R-CL-23, R-CL-24: thu hồi", () => {
  it("close and rate", () => {
    expect(checkRecallClose([{ status: "contacted" }, { status: "pending" }])).toMatch(/Còn 1 liên hệ/);
    expect(checkRecallClose([{ status: "returned" }, { status: "refused" }])).toBeNull();
    expect(recallReturnRate(120, 90)).toBe(75);
    expect(recallReturnRate(0, 0)).toBeNull();
  });
  it("CSV escapes cells", () => {
    expect(toCsv([["a,b", 'x"y', 3]])).toBe('﻿"a,b","x""y",3');
    expect(toCsv([["=1+1", -5]])).toBe("﻿'=1+1,-5");
  });
});
