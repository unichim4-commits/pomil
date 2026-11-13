import { describe, expect, it } from "vitest";
import {
  canChangeQcStatus,
  checkItemWarehouse,
  checkMoveRule,
  checkUom,
  classifyBalance,
  convertQty,
  costOfQty,
  expiryFlag,
  formatQty,
  isLotUsable,
  lineCostOf,
  moveSign,
  normalizeItemCode,
  parseQty,
  planFefo,
  priceDeviates,
  resolveLineDates,
  sellableStock,
  slowMovingDays,
  unitPriceOf,
  unusableLotMessage,
  type FefoCandidate,
} from "@/modules/inventory/rules";

describe("costOfQty (R-CHUNG-5, R-KHO-28)", () => {
  it("tính bằng BigInt, làm tròn nửa lên", () => {
    expect(costOfQty(150_000, 1_000_000, 2_000_000)).toBe(300_000);
    expect(costOfQty(2, 296, 16_800_000)).toBe(113_514);
    expect(costOfQty(850_000, 1_000_000, 2_000_000)).toBe(1_700_000);
  });
  it("biên: số lớn, âm, mẫu số 0", () => {
    expect(costOfQty(9_000_000_000_000, 9_000_000_000_000, 2_000_000_000)).toBe(2_000_000_000);
    expect(costOfQty(-2, 296, 16_800_000)).toBe(-113_514);
    expect(costOfQty(5, 0, 100)).toBe(0);
    expect(costOfQty(1, 3, 1)).toBe(0);
    expect(costOfQty(1, 2, 1)).toBe(1);
  });
});

describe("parseQty (R-CHUNG-1, R-CHUNG-2, AC-KHO-4)", () => {
  it("các ví dụ trong đặc tả", () => {
    expect(parseQty("1,5", "kg")).toEqual({ ok: true, qty: 1_500_000 });
    expect(parseQty("1.500", "g")).toEqual({ ok: true, qty: 1_500_000 });
    expect(parseQty("0,25", "ml")).toEqual({ ok: true, qty: 250 });
    expect(parseQty("100", "ml")).toEqual({ ok: true, qty: 100_000 });
    expect(parseQty("2,5", "chai")).toEqual({ ok: false, message: "Số chai phải là số nguyên" });
    expect(parseQty("0,0005", "g")).toEqual({ ok: false, message: "Số lẻ quá nhỏ, tối đa 3 chữ số sau dấu phẩy với g" });
    expect(parseQty("abc", "ml").ok).toBe(false);
  });
  it("phân cách nghìn và khoảng trắng", () => {
    expect(parseQty("1.234,5", "g")).toEqual({ ok: true, qty: 1_234_500 });
    expect(parseQty("1 234,5", "g")).toEqual({ ok: true, qty: 1_234_500 });
    expect(parseQty("300", "cái")).toEqual({ ok: true, qty: 300 });
    expect(parseQty("2,50", "kg")).toEqual({ ok: true, qty: 2_500_000 });
    expect(parseQty("1.5", "kg").ok).toBe(false);
    expect(parseQty("-1", "kg").ok).toBe(false);
    expect(parseQty("", "kg").ok).toBe(false);
  });
  it("giới hạn 9.000.000.000.000", () => {
    expect(parseQty("9.000", "kg").ok).toBe(true);
    expect(parseQty("9.000.001", "kg").ok).toBe(false);
  });
});

describe("formatQty", () => {
  it("định dạng kiểu Việt Nam", () => {
    expect(formatQty(1_500_000, "mg", "kg")).toBe("1,5 kg");
    expect(formatQty(5_000_000, "ul", "l")).toBe("5 l");
    expect(formatQty(80, "pcs", "cái")).toBe("80 cái");
    expect(formatQty(1_850_000, "ul", "ml")).toBe("1.850 ml");
    expect(formatQty(-1, "pcs", "chai")).toBe("-1 chai");
  });
  it("tự chọn đơn vị khi không truyền", () => {
    expect(formatQty(250, "ul")).toBe("0,25 ml");
    expect(formatQty(1_500_000, "mg")).toBe("1,5 kg");
    expect(formatQty(12, "pcs")).toBe("12 cái");
  });
});

describe("convertQty", () => {
  it("đổi ul ↔ mg theo khối lượng riêng", () => {
    expect(convertQty(1_000_000, "ul", "mg", 850)).toEqual({ ok: true, qty: 850_000 });
    expect(convertQty(850_000, "mg", "ul", 850)).toEqual({ ok: true, qty: 1_000_000 });
    expect(convertQty(5, "pcs", "pcs", null)).toEqual({ ok: true, qty: 5 });
    expect(convertQty(5, "ul", "mg", null).ok).toBe(false);
    expect(convertQty(5, "pcs", "mg", 1000).ok).toBe(false);
  });
});

describe("isLotUsable (R-KHO-8)", () => {
  const today = "2027-11-20";
  it("bảng ví dụ", () => {
    expect(isLotUsable({ qcStatus: "released", productLotStatus: null, expiresOn: "2028-01-01" }, today)).toBe(true);
    expect(isLotUsable({ qcStatus: "released", productLotStatus: null, expiresOn: null }, today)).toBe(true);
    expect(isLotUsable({ qcStatus: "released", productLotStatus: null, expiresOn: "2027-11-20" }, today)).toBe(false);
    expect(isLotUsable({ qcStatus: "pending", productLotStatus: null, expiresOn: "2028-01-01" }, today)).toBe(false);
    expect(isLotUsable({ qcStatus: "on_hold", productLotStatus: null, expiresOn: "2028-01-01" }, today)).toBe(false);
    expect(isLotUsable({ qcStatus: "rejected", productLotStatus: null, expiresOn: "2028-01-01" }, today)).toBe(false);
    expect(isLotUsable({ qcStatus: null, productLotStatus: "released", expiresOn: "2029-11-20" }, today)).toBe(true);
    for (const st of ["quarantine", "on_hold", "recalled", "rejected"] as const) {
      expect(isLotUsable({ qcStatus: null, productLotStatus: st, expiresOn: "2029-11-20" }, today)).toBe(false);
    }
  });
});

describe("unusableLotMessage (R-KHO-11, AC-TICHHOP-18)", () => {
  const today = "2027-11-20";
  it("câu lỗi theo đúng nguyên nhân, hết hạn báo trước", () => {
    expect(unusableLotMessage("PSTM-QA-A", { qcStatus: null, productLotStatus: "released", expiresOn: "2027-11-10" }, today)).toBe("Lô PSTM-QA-A đã hết hạn");
    expect(unusableLotMessage("PSTM-QA-A", { qcStatus: null, productLotStatus: "on_hold", expiresOn: "2027-11-10" }, today)).toBe("Lô PSTM-QA-A đã hết hạn");
    expect(unusableLotMessage("L1", { qcStatus: null, productLotStatus: "on_hold", expiresOn: "2029-01-01" }, today)).toBe("Lô L1 đang bị giữ, không xuất được");
    expect(unusableLotMessage("L1", { qcStatus: null, productLotStatus: "recalled", expiresOn: "2029-01-01" }, today)).toBe("Lô L1 không đạt hoặc đang thu hồi, không xuất được");
    expect(unusableLotMessage("L1", { qcStatus: null, productLotStatus: "quarantine", expiresOn: "2029-01-01" }, today)).toBe("Lô L1 đang chờ kiểm, chưa xuất được");
  });
});

describe("planFefo (R-KHO-10, AC-KHO-12)", () => {
  const today = "2027-11-20";
  const c = (code: string, qty: number, expiresOn: string | null, usable = true, manufacturedOn: string | null = null): FefoCandidate => ({
    stockLotId: code,
    locationId: "L",
    warehouseId: "W",
    qty,
    code,
    expiresOn,
    manufacturedOn,
    usable,
  });
  const lots = [c("B", 10, "2028-09-01"), c("C", 5, "2027-12-31", false), c("A", 2, "2028-03-01"), c("D", 3, "2027-10-01", true)];
  it("cần 3 → A 2, B 1", () => {
    const r = planFefo(lots, 3, today);
    expect(r).toEqual({
      ok: true,
      picks: [
        { stockLotId: "A", locationId: "L", warehouseId: "W", qty: 2 },
        { stockLotId: "B", locationId: "L", warehouseId: "W", qty: 1 },
      ],
    });
  });
  it("cần 13 → thiếu, còn 12", () => {
    expect(planFefo(lots, 13, today)).toEqual({ ok: false, available: 12 });
  });
  it("HSD null cuối; cùng HSD thì NSX sớm trước rồi mã lô", () => {
    const r = planFefo([c("Z", 5, null), c("Y", 5, "2028-01-01", true, "2027-06-01"), c("X", 5, "2028-01-01", true, "2027-05-01"), c("W", 5, "2028-01-01", true, "2027-05-01")], 16, today);
    expect(r.ok && r.picks.map((p) => p.stockLotId)).toEqual(["W", "X", "Y", "Z"]);
  });
});

describe("sellableStock (R-KHO-23)", () => {
  it("ví dụ", () => {
    expect(sellableStock(120, 5)).toBe(115);
    expect(sellableStock(416, 5)).toBe(411);
    expect(sellableStock(296, 300)).toBe(0);
  });
});

describe("moveSign và checkMoveRule (R-KHO-6, AC-KHO-11)", () => {
  it("dấu", () => {
    expect(moveSign("purchase_receipt")).toBe(1);
    expect(moveSign("sale_issue")).toBe(-1);
    expect(moveSign("transfer_out")).toBe(-1);
    expect(moveSign("transfer_in")).toBe(1);
    expect(moveSign("count_adjust")).toBe(0);
    expect(moveSign("reversal")).toBe(0);
  });
  it("sale_issue +2 → Sai dấu; production_issue từ FG → lỗi", () => {
    expect(checkMoveRule("sale_issue", 2, "finished", true)).toBe("Sai dấu");
    expect(checkMoveRule("production_issue", -1, "finished", true)).toBe("Không xuất sản xuất từ kho thành phẩm");
    expect(checkMoveRule("qc_sample_issue", -1, "rejected", false)).toBeNull();
    expect(checkMoveRule("sample_issue", -1, "rejected", false)).not.toBeNull();
    expect(checkMoveRule("purchase_receipt", 5, "finished", false)).not.toBeNull();
    expect(checkMoveRule("count_adjust", -3, "raw", false)).toBeNull();
    expect(checkMoveRule("count_adjust", 0, "raw", false)).not.toBeNull();
  });
  it("R-KHO-4: thành phẩm chỉ vào kho finished/rejected (AC-KHO-19)", () => {
    expect(checkItemWarehouse(true, "raw")).not.toBeNull();
    expect(checkItemWarehouse(true, "rejected")).toBeNull();
    expect(checkItemWarehouse(false, "finished")).not.toBeNull();
    expect(checkMoveRule("transfer_in", 5, "raw", true)).not.toBeNull();
  });
});

describe("mã hàng, đơn vị (R-KHO-1, R-KHO-2, AC-KHO-2)", () => {
  it("mã", () => {
    expect(normalizeItemCode("nl-001")).toEqual({ ok: true, code: "NL-001" });
    expect(normalizeItemCode("NL 001")).toEqual({ ok: false, message: "Mã chỉ gồm chữ, số và gạch ngang" });
    expect(normalizeItemCode("N").ok).toBe(false);
  });
  it("đơn vị", () => {
    expect(checkUom("ul", "kg")).toBe("Đơn vị kg không hợp với hàng đo theo thể tích");
    expect(checkUom("ul", "ml")).toBeNull();
    expect(checkUom("pcs", "chai")).toBeNull();
  });
});

describe("ngày dòng nhập (R-KHO-12, AC-KHO-8)", () => {
  it("điền HSD theo hạn mặc định", () => {
    expect(resolveLineDates({ manufacturedOn: "2026-11-10", expiresOn: null }, "2026-11-11", 3, { newLot: true })).toEqual({
      ok: true,
      manufacturedOn: "2026-11-10",
      expiresOn: "2026-11-13",
    });
  });
  it("lô mới hết hạn khi nhập → lỗi; lô có sẵn thì không chặn", () => {
    expect(resolveLineDates({ manufacturedOn: null, expiresOn: "2026-11-10" }, "2026-11-11", null, { newLot: true })).toEqual({
      ok: false,
      message: "Hàng đã hết hạn khi nhập, không nhập vào kho",
    });
    expect(resolveLineDates({ manufacturedOn: null, expiresOn: "2026-11-10" }, "2026-11-11", null, { newLot: false }).ok).toBe(true);
    expect(resolveLineDates({ manufacturedOn: "2026-11-12", expiresOn: null }, "2026-11-11", null, { newLot: true }).ok).toBe(false);
    expect(resolveLineDates({ manufacturedOn: "2026-11-01", expiresOn: "2026-11-01" }, "2026-11-11", null, { newLot: true }).ok).toBe(false);
  });
});

describe("sắp hết hạn, tồn lâu (R-KHO-21, R-KHO-22, AC-KHO-25, AC-KHO-26)", () => {
  const today = "2027-11-20";
  it("sắp hết hạn", () => {
    expect(expiryFlag("2028-02-15", today, 90)).toEqual({ kind: "expiring", days: 87 });
    expect(expiryFlag("2028-02-20", today, 90)).toBeNull();
    expect(expiryFlag("2027-11-19", today, 90)?.kind).toBe("expired");
    expect(expiryFlag(null, today, 90)).toBeNull();
  });
  it("tồn lâu", () => {
    expect(slowMovingDays("2027-06-01", "2027-08-01", today, 90)).toBe(111);
    expect(slowMovingDays("2027-10-01", null, today, 90)).toBeNull();
  });
});

describe("giá nhập (R-KHO-14)", () => {
  it("đơn giá và thành tiền", () => {
    expect(unitPriceOf(4_000_000, 2_000_000, 1_000_000)).toBe(2_000_000);
    expect(lineCostOf(1_500, 300, 1)).toBe(450_000);
    expect(priceDeviates(1_250, 1_000)).toBe(true);
    expect(priceDeviates(1_200, 1_000)).toBe(false);
    expect(priceDeviates(1_000, null)).toBe(false);
  });
});

describe("classifyBalance (R-KHO-9)", () => {
  const today = "2027-11-20";
  it("ví dụ TD-001: khả dụng 500, cách ly 1.000, hết hạn 100, không đạt 250", () => {
    const rows = [
      { warehouseKind: "raw" as const, qcStatus: "released" as const, expiresOn: "2028-06-01", qty: 500 },
      { warehouseKind: "raw" as const, qcStatus: "pending" as const, expiresOn: "2028-06-01", qty: 1000 },
      { warehouseKind: "raw" as const, qcStatus: "released" as const, expiresOn: "2027-11-01", qty: 100 },
      { warehouseKind: "rejected" as const, qcStatus: "rejected" as const, expiresOn: "2028-06-01", qty: 200 },
      { warehouseKind: "rejected" as const, qcStatus: "released" as const, expiresOn: "2028-06-01", qty: 50 },
    ];
    const sum = { available: 0, quarantine: 0, rejected: 0, expired: 0 };
    for (const r of rows) sum[classifyBalance({ ...r, productLotStatus: null }, today)] += r.qty;
    expect(sum).toEqual({ available: 500, quarantine: 1000, rejected: 250, expired: 100 });
  });
  it("lô thành phẩm recalled → không đạt; quarantine → cách ly", () => {
    expect(classifyBalance({ warehouseKind: "finished", qcStatus: null, productLotStatus: "recalled", expiresOn: "2029-01-01" }, today)).toBe("rejected");
    expect(classifyBalance({ warehouseKind: "finished", qcStatus: null, productLotStatus: "quarantine", expiresOn: "2029-01-01" }, today)).toBe("quarantine");
  });
});

describe("canChangeQcStatus (R-KHO-36)", () => {
  it("theo sơ đồ", () => {
    expect(canChangeQcStatus("pending", "released")).toBe(true);
    expect(canChangeQcStatus("released", "on_hold")).toBe(true);
    expect(canChangeQcStatus("on_hold", "released")).toBe(true);
    expect(canChangeQcStatus("rejected", "released")).toBe(false);
    expect(canChangeQcStatus("released", "pending")).toBe(false);
  });
});
