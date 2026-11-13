import { describe, expect, it } from "vitest";
import {
  addTag,
  bpOf,
  bundleDiscount,
  canChangeDealerStatus,
  canReturnTransition,
  careNoteProblem,
  channelCodeProblem,
  computeDiscounts,
  contractEndingSoon,
  contributionMargin,
  creditLimitProblem,
  customerMetrics,
  dealerCommission,
  dealerOrderProblem,
  defaultRefund,
  dispositionProblem,
  duplicateExternalRefMessage,
  formatPercent,
  isFullReturn,
  manualDiscountNeedsPricing,
  manualOrderProblem,
  maxRefund,
  normalizeTag,
  normalizeVoucherCode,
  parseMoney,
  parsePercentToBp,
  periodKey,
  platformFeeChangeProblem,
  type PriceListForPricing,
  resolveUnitPrice,
  returnLinesProblem,
  returnRate,
  returnWindowProblem,
  salesSummary,
  splitRefund,
  successRate,
  suggestedPlatformFee,
  voucherDiscount,
  voucherProblem,
  type VoucherLike,
  weekStart,
} from "@/modules/sales/rules";

const PST = "p-pst";

describe("tiền theo bp", () => {
  it("làm tròn nửa lên", () => {
    expect(bpOf(229_000, 2150)).toBe(49_235);
    expect(bpOf(1, 5000)).toBe(1); // 0,5 → 1
    expect(bpOf(0, 2150)).toBe(0);
  });
  it("đọc % và tiền kiểu Việt", () => {
    expect(parsePercentToBp("21,5")).toBe(2150);
    expect(parsePercentToBp("10%")).toBe(1000);
    expect(parsePercentToBp("abc")).toBeNull();
    expect(parsePercentToBp("101")).toBeNull();
    expect(parseMoney("1.500.000")).toBe(1_500_000);
    expect(parseMoney("")).toBe(0);
    expect(parseMoney("-5")).toBeNull();
  });
});

describe("R-BH-1 kênh và phí nền tảng", () => {
  it("mã kênh 2–5 chữ hoa", () => {
    expect(channelCodeProblem("SHP")).toBeNull();
    expect(channelCodeProblem("S")).not.toBeNull();
    expect(channelCodeProblem("shp")).not.toBeNull();
    expect(channelCodeProblem("ABCDEF")).not.toBeNull();
  });
  it("phí gợi ý SHP 2.150 bp trên 229.000 = 49.235", () => {
    expect(suggestedPlatformFee(229_000, 0, 2150)).toBe(49_235);
    expect(suggestedPlatformFee(100_000, 200_000, 2150)).toBe(0);
  });
});

describe("R-BH-2 giá trên đơn tay", () => {
  const dealerList: PriceListForPricing = {
    id: "dl",
    kind: "dealer",
    channelCode: null,
    validFrom: null,
    validTo: null,
    priority: 0,
    isActive: true,
    items: [
      { productId: PST, unitPrice: 175_000, minQty: 1 },
      { productId: PST, unitPrice: 165_000, minQty: 50 },
    ],
  };
  const promo: PriceListForPricing = { id: "km", kind: "promo", channelCode: null, validFrom: "2027-11-01", validTo: "2027-11-30", priority: 1, isActive: true, items: [{ productId: PST, unitPrice: 199_000, minQty: 1 }] };
  const base = { productId: PST, retailPrice: 229_000, channelCode: "FB", channelList: null };

  it("ví dụ đặc tả: 175.000 / 165.000 / 199.000 / 229.000", () => {
    expect(resolveUnitPrice({ ...base, qty: 20, today: "2027-11-20", dealerList, promoLists: [promo] }).unitPrice).toBe(175_000);
    expect(resolveUnitPrice({ ...base, qty: 60, today: "2027-11-20", dealerList, promoLists: [promo] }).unitPrice).toBe(165_000);
    const fb = resolveUnitPrice({ ...base, qty: 1, today: "2027-11-20", dealerList: null, promoLists: [promo] });
    expect(fb).toEqual({ unitPrice: 199_000, priceListId: "km" });
    expect(resolveUnitPrice({ ...base, qty: 1, today: "2027-12-01", dealerList: null, promoLists: [promo] })).toEqual({ unitPrice: 229_000, priceListId: null });
  });
  it("khuyến mãi khác kênh hoặc tắt không dùng; ưu tiên priority cao", () => {
    const shopee = { ...promo, id: "km2", channelCode: "SHP" };
    expect(resolveUnitPrice({ ...base, qty: 1, today: "2027-11-20", dealerList: null, promoLists: [shopee] }).unitPrice).toBe(229_000);
    const off = { ...promo, isActive: false };
    expect(resolveUnitPrice({ ...base, qty: 1, today: "2027-11-20", dealerList: null, promoLists: [off] }).unitPrice).toBe(229_000);
    const hi = { ...promo, id: "hi", priority: 5, items: [{ productId: PST, unitPrice: 189_000, minQty: 1 }] };
    expect(resolveUnitPrice({ ...base, qty: 1, today: "2027-11-20", dealerList: null, promoLists: [promo, hi] }).unitPrice).toBe(189_000);
  });
  it("bảng kênh dùng khi không có khuyến mãi", () => {
    const ch: PriceListForPricing = { ...dealerList, id: "ch", kind: "retail", items: [{ productId: PST, unitPrice: 219_000, minQty: 1 }] };
    expect(resolveUnitPrice({ ...base, channelList: ch, qty: 1, today: "2027-11-20", dealerList: null, promoLists: [] }).unitPrice).toBe(219_000);
  });
});

describe("R-BH-4 combo", () => {
  it("Bộ 2 Tonic 399.000 → chiết khấu 59.000", () => {
    expect(bundleDiscount(458_000, 399_000)).toBe(59_000);
    expect(bundleDiscount(300_000, 399_000)).toBe(0);
  });
});

describe("R-BH-5 voucher", () => {
  const now = new Date("2027-11-20T03:00:00Z");
  const thu10: VoucherLike = { code: "THU10", kind: "percent", value: 1000, minOrder: 0, maxDiscount: 30_000, channelCode: null, validFrom: null, validTo: null, usageLimit: null, usedCount: 0, isActive: true };
  it("THU10 trên 399.000 → 39.900 → trần 30.000", () => {
    expect(voucherDiscount(thu10, 399_000)).toBe(30_000);
    expect(voucherDiscount({ ...thu10, maxDiscount: null }, 399_000)).toBe(39_900);
    expect(voucherDiscount({ kind: "amount", value: 50_000, maxDiscount: null }, 20_000)).toBe(20_000);
  });
  it("câu lỗi đúng đặc tả", () => {
    expect(voucherProblem({ ...thu10, validTo: new Date("2027-11-01") }, { channelCode: "FB", base: 1, now })).toBe("Mã giảm giá đã hết hạn");
    expect(voucherProblem({ ...thu10, usageLimit: 1, usedCount: 1 }, { channelCode: "FB", base: 1, now })).toBe("Mã đã dùng hết lượt");
    expect(voucherProblem({ ...thu10, minOrder: 500_000 }, { channelCode: "FB", base: 399_000, now })).toMatch(/chưa đủ/);
    expect(voucherProblem({ ...thu10, channelCode: "SHP" }, { channelCode: "FB", base: 1, now })).toMatch(/kênh/);
    expect(voucherProblem(thu10, { channelCode: "FB", base: 399_000, now })).toBeNull();
    expect(normalizeVoucherCode("  thu10 ")).toBe("THU10");
  });
});

describe("R-BH-6 chiết khấu đơn", () => {
  it("subtotal 458.000, combo 59.000, THU10, phí giao 25.000 → 89.000 / 394.000", () => {
    const d = computeDiscounts({ subtotal: 458_000, comboDiscount: 59_000, dealerBp: 0, voucher: { kind: "percent", value: 1000, maxDiscount: 30_000 }, manualDiscount: 0, shippingFee: 25_000 });
    expect(d.discountTotal).toBe(89_000);
    expect(d.total).toBe(394_000);
    expect(d.voucherBase).toBe(399_000);
  });
  it("mỗi bước tính trên phần còn lại, tổng chiết khấu ≤ subtotal", () => {
    const d = computeDiscounts({ subtotal: 100_000, comboDiscount: 0, dealerBp: 1000, voucher: { kind: "amount", value: 50_000, maxDiscount: null }, manualDiscount: 500_000, shippingFee: 0 });
    expect(d.dealer).toBe(10_000);
    expect(d.voucher).toBe(50_000);
    expect(d.manual).toBe(40_000);
    expect(d.discountTotal).toBe(100_000);
    expect(d.total).toBe(0);
  });
  it("chiết khấu tay > 10% cần quyền giá (50.000 / 458.000 = 10,9%)", () => {
    expect(manualDiscountNeedsPricing(50_000, 458_000, 1000)).toBe(true);
    expect(manualDiscountNeedsPricing(45_000, 458_000, 1000)).toBe(false);
    expect(manualDiscountNeedsPricing(45_800, 458_000, 1000)).toBe(false);
  });
});

describe("R-BH-7 đơn tay theo loại kênh", () => {
  const base = { phoneE164: null, hasAddress: false, externalRef: null, dealerId: null, consentConfirmed: false };
  it("WEB và kênh tắt bị chặn", () => {
    expect(manualOrderProblem({ ...base, channel: { code: "WEB", kind: "own_web", isActive: true }, paymentMethod: "cod" })).toMatch(/website/);
    expect(manualOrderProblem({ ...base, channel: { code: "FB", kind: "social", isActive: false }, paymentMethod: "cod" })).toBe("Kênh đang tắt");
  });
  it("sàn chỉ thanh toán qua sàn và cần mã sàn", () => {
    expect(manualOrderProblem({ ...base, channel: { code: "SHP", kind: "marketplace", isActive: true }, paymentMethod: "cod" })).toBe("Đơn sàn dùng thanh toán qua sàn");
    expect(manualOrderProblem({ ...base, channel: { code: "SHP", kind: "marketplace", isActive: true }, paymentMethod: "platform" })).toMatch(/mã đơn trên sàn/);
    expect(manualOrderProblem({ ...base, externalRef: "2711ABC", channel: { code: "SHP", kind: "marketplace", isActive: true }, paymentMethod: "platform" })).toBeNull();
  });
  it("mạng xã hội cần số, địa chỉ và ô đồng ý", () => {
    const fb = { code: "FB", kind: "social" as const, isActive: true };
    expect(manualOrderProblem({ ...base, channel: fb, paymentMethod: "cod" })).toMatch(/số điện thoại/);
    expect(manualOrderProblem({ ...base, phoneE164: "+84901234567", hasAddress: true, channel: fb, paymentMethod: "cod" })).toMatch(/đồng ý/);
    expect(manualOrderProblem({ ...base, phoneE164: "+84901234567", hasAddress: true, consentConfirmed: true, channel: fb, paymentMethod: "cod" })).toBeNull();
  });
  it("tại chỗ không bắt buộc số và địa chỉ; đại lý cần chọn đại lý", () => {
    expect(manualOrderProblem({ ...base, channel: { code: "TT", kind: "direct", isActive: true }, paymentMethod: "cash" })).toBeNull();
    expect(manualOrderProblem({ ...base, channel: { code: "DL", kind: "dealer", isActive: true }, paymentMethod: "credit" })).toBe("Chọn đại lý");
  });
});

describe("R-BH-9 hạn mức công nợ", () => {
  it("ví dụ AC-BH-11", () => {
    expect(creditLimitProblem({ creditLimit: 5_000_000, outstanding: 3_500_000, newTotal: 1_750_000 })).toMatch(/^Vượt hạn mức công nợ: còn 1\.500\.000/);
    expect(creditLimitProblem({ creditLimit: 5_000_000, outstanding: 3_500_000, newTotal: 1_500_000 })).toBeNull();
    expect(creditLimitProblem({ creditLimit: 0, outstanding: 0, newTotal: 1 })).toBe("Đại lý chưa được mua chịu");
  });
});

describe("R-BH-10 hiệu lực đại lý", () => {
  it("hết hạn hợp đồng, tạm dừng, sắp hết hạn", () => {
    expect(dealerOrderProblem({ status: "active", contractEnd: "2027-10-31", name: "A" }, "2027-11-20")).toBe("Hợp đồng đại lý đã hết hạn ngày 31/10/2027");
    expect(dealerOrderProblem({ status: "paused", contractEnd: null, name: "A" }, "2027-11-20")).toMatch(/tạm dừng/);
    expect(dealerOrderProblem({ status: "active", contractEnd: "2027-11-20", name: "A" }, "2027-11-20")).toBeNull();
    expect(contractEndingSoon("2027-12-20", "2027-11-20")).toBe(true);
    expect(contractEndingSoon("2027-12-21", "2027-11-20")).toBe(false);
    expect(contractEndingSoon("2027-11-19", "2027-11-20")).toBe(false);
  });
  it("trạng thái đại lý", () => {
    expect(canChangeDealerStatus("active", "paused")).toBe(true);
    expect(canChangeDealerStatus("paused", "active")).toBe(true);
    expect(canChangeDealerStatus("active", "ended")).toBe(true);
    expect(canChangeDealerStatus("ended", "active")).toBe(false);
  });
});

describe("R-BH-11 trạng thái đổi trả", () => {
  it("đi đúng chiều", () => {
    expect(canReturnTransition("requested", "approved")).toBe(true);
    expect(canReturnTransition("approved", "received")).toBe(true);
    expect(canReturnTransition("received", "completed")).toBe(true);
    expect(canReturnTransition("requested", "completed")).toBe(false);
    expect(canReturnTransition("completed", "cancelled")).toBe(false);
  });
});

describe("R-BH-19 tạo đổi trả", () => {
  it("hạn đổi trả", () => {
    const delivered = new Date("2027-11-10T05:00:00Z");
    expect(returnWindowProblem(delivered, 0, "2028-05-01")).toBeNull();
    expect(returnWindowProblem(delivered, 7, "2027-11-17")).toBeNull();
    expect(returnWindowProblem(delivered, 7, "2027-11-18")).toBe("Quá hạn đổi trả");
    expect(returnWindowProblem(null, 7, "2027-11-18")).toBe("Đơn chưa giao");
  });
  it("không trả quá số đã giao trừ số đã trả", () => {
    expect(returnLinesProblem([{ orderItemId: "a", qty: 3, name: "Tonic", deliveredQty: 2, alreadyReturned: 0 }])).toMatch(/vượt số đã giao: còn trả được 2/);
    expect(returnLinesProblem([{ orderItemId: "a", qty: 2, name: "Tonic", deliveredQty: 2, alreadyReturned: 1 }])).toMatch(/còn trả được 1/);
    expect(returnLinesProblem([{ orderItemId: "a", qty: 1, name: "Tonic", deliveredQty: 2, alreadyReturned: 1 }])).toBeNull();
    expect(returnLinesProblem([])).not.toBeNull();
  });
});

describe("R-BH-20 kiểm hàng trả", () => {
  it("hàng hỏng/lỗi phải cách ly", () => {
    expect(dispositionProblem("defective", "restock")).toMatch(/cách ly/);
    expect(dispositionProblem("damaged", "quarantine")).toBeNull();
    expect(dispositionProblem("intact", "restock")).toBeNull();
    expect(dispositionProblem(null, "restock")).not.toBeNull();
  });
});

describe("R-BH-21/22 tiền hoàn", () => {
  it("2 × 229.000, chiết khấu 59.000, trả 1 chai → 199.500", () => {
    expect(defaultRefund({ lines: [{ qty: 1, unitPrice: 229_000 }], subtotal: 458_000, discountTotal: 59_000 })).toBe(199_500);
    expect(defaultRefund({ lines: [{ qty: 1, unitPrice: 229_000 }], subtotal: 229_000, discountTotal: 0 })).toBe(229_000);
    expect(maxRefund(399_000, 199_500)).toBe(199_500);
  });
  it("giảm công nợ trước rồi mới chi", () => {
    expect(splitRefund(175_000, { amount: 3_500_000, paidAmount: 0 })).toEqual({ reduceDebt: 175_000, cashOut: 0 });
    expect(splitRefund(175_000, { amount: 3_500_000, paidAmount: 3_400_000 })).toEqual({ reduceDebt: 100_000, cashOut: 75_000 });
    expect(splitRefund(199_500, null)).toEqual({ reduceDebt: 0, cashOut: 199_500 });
  });
  it("trả đủ đơn", () => {
    const items = [{ orderItemId: "a", quantity: 2 }];
    expect(isFullReturn(items, new Map([["a", 2]]))).toBe(true);
    expect(isFullReturn(items, new Map([["a", 1]]))).toBe(false);
  });
});

describe("R-BH-26 tỷ lệ hoàn", () => {
  it("(1 + 1) / 7 = 28,6%", () => {
    const r = returnRate({ returnedOrders: 1, deliveredWithReturn: 1, delivered: 6 });
    expect(formatPercent(r)).toBe("28,6%");
    expect(returnRate({ returnedOrders: 0, deliveredWithReturn: 0, delivered: 0 })).toBeNull();
  });
});

describe("R-BH-27 chỉ số khách", () => {
  it("ví dụ đặc tả: 1.195.000, AOV 398.333, 51 ngày; bỏ đơn hủy", () => {
    const item = (q: number) => [{ productId: PST, productName: "Tonic", quantity: q }];
    const m = customerMetrics([
      { status: "delivered", total: 483_000, createdAt: new Date("2027-11-20T03:00:00Z"), refunded: 0, items: item(2) },
      { status: "delivered", total: 254_000, createdAt: new Date("2028-01-10T03:00:00Z"), refunded: 0, items: item(1) },
      { status: "delivered", total: 458_000, createdAt: new Date("2028-03-01T03:00:00Z"), refunded: 0, items: [{ productId: "p-psh", productName: "Gội", quantity: 2 }] },
      { status: "cancelled", total: 999_000, createdAt: new Date("2028-04-01T03:00:00Z"), refunded: 0, items: item(10) },
    ]);
    expect(m.orderCount).toBe(3);
    expect(m.spent).toBe(1_195_000);
    expect(m.aov).toBe(398_333);
    expect(m.frequencyDays).toBe(51);
    expect(m.topProducts[0]).toMatchObject({ productId: PST, qty: 3 });
    expect(m.lastOrderAt?.toISOString()).toBe("2028-03-01T03:00:00.000Z");
  });
  it("trừ tiền hoàn, không tính đơn hoàn về vào tổng chi", () => {
    const m = customerMetrics([
      { status: "delivered", total: 458_000, createdAt: new Date(), refunded: 199_500, items: [] },
      { status: "returned", total: 229_000, createdAt: new Date(), refunded: 0, items: [] },
    ]);
    expect(m.spent).toBe(258_500);
    expect(m.orderCount).toBe(2);
  });
});

describe("R-BH-28 nhãn và ghi chú", () => {
  it("chuẩn hóa, giới hạn 10 nhãn, 30 ký tự", () => {
    expect(normalizeTag("  Khách   Salon  ")).toBe("khách salon");
    const ten = Array.from({ length: 10 }, (_, i) => `n${i}`);
    expect(addTag(ten, "mới")).toEqual({ ok: false, message: "Mỗi khách tối đa 10 nhãn" });
    expect(addTag(ten, "N1")).toEqual({ ok: true, tags: ten });
    expect(addTag([], "x".repeat(31)).ok).toBe(false);
    expect(addTag([], "  Khách Salon  ")).toEqual({ ok: true, tags: ["khách salon"] });
  });
  it("ghi chú ≤ 1.000 ký tự", () => {
    expect(careNoteProblem("  ")).not.toBeNull();
    expect(careNoteProblem("x".repeat(1001))).not.toBeNull();
    expect(careNoteProblem("Gọi lại sau 2 tuần")).toBeNull();
  });
});

describe("R-BH-29 báo cáo", () => {
  it("10 đơn: 6 giao, 1 hoàn về, 2 hủy, 1 đang giao → 66,7%; doanh số bỏ hủy và hoàn", () => {
    const at = new Date("2027-11-20T03:00:00Z");
    const mk = (status: string) => ({ status, subtotal: 229_000, discountTotal: 29_000, createdAt: at });
    const orders = [...Array(6).fill("delivered"), "returned", "cancelled", "cancelled", "shipping"].map(mk);
    expect(formatPercent(successRate(orders))).toBe("66,7%");
    const s = salesSummary(orders);
    expect(s.orders).toBe(7);
    expect(s.revenue).toBe(7 * 200_000);
    expect(s.aov).toBe(200_000);
  });
  it("tuần bắt đầu thứ Hai, theo giờ VN", () => {
    expect(weekStart("2027-11-21")).toBe("2027-11-15"); // CN → thứ Hai trước
    expect(weekStart("2027-11-15")).toBe("2027-11-15");
    expect(periodKey(new Date("2027-11-21T18:00:00Z"), "day")).toBe("2027-11-22"); // 01:00 giờ VN
    expect(periodKey(new Date("2027-11-21T18:00:00Z"), "week")).toBe("2027-11-22");
    expect(periodKey(new Date("2027-11-21T18:00:00Z"), "month")).toBe("2027-11");
  });
  it("lợi nhuận góp", () => {
    expect(contributionMargin({ revenue: 1_000_000, platformFee: 100_000, cogs: 300_000, refunded: 50_000 })).toBe(550_000);
  });
});

describe("R-BH-30 hoa hồng đại lý", () => {
  it("20.000.000 × 500 bp = 1.000.000", () => {
    expect(dealerCommission(20_000_000, 0, 500)).toBe(1_000_000);
    expect(dealerCommission(20_000_000, 2_000_000, 500)).toBe(900_000);
  });
});

describe("R-BH-31 đơn sàn trùng", () => {
  it("câu báo", () => {
    expect(duplicateExternalRefMessage("2711ABC", "SHP-2711-0003")).toBe("Đơn sàn 2711ABC đã có (SHP-2711-0003)");
  });
});

describe("R-BH-33 sửa phí nền tảng", () => {
  it("chặn khi sàn đã trả đủ hoặc mới thấp hơn đã trả", () => {
    expect(platformFeeChangeProblem({ total: 229_000, newFee: 50_000, debt: { amount: 179_765, paidAmount: 0, status: "open" } })).toBeNull();
    expect(platformFeeChangeProblem({ total: 229_000, newFee: 50_000, debt: { amount: 179_765, paidAmount: 179_765, status: "paid" } })).toMatch(/đã trả đủ/);
    expect(platformFeeChangeProblem({ total: 229_000, newFee: 100_000, debt: { amount: 179_765, paidAmount: 150_000, status: "partial" } })).toMatch(/thấp hơn/);
    expect(platformFeeChangeProblem({ total: 229_000, newFee: -1, debt: null })).not.toBeNull();
    expect(platformFeeChangeProblem({ total: 229_000, newFee: 229_000, debt: null })).not.toBeNull();
  });
});
