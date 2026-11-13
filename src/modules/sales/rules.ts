// Quy tắc thuần của phân hệ Bán hàng (04-ban-hang.md R-BH-1…R-BH-33). Service gọi lại, không lặp logic.
import { formatVnd } from "@/lib/format";

export type ChannelKind = "own_web" | "marketplace" | "social" | "dealer" | "direct";
export type PaymentMethod = "cod" | "bank_transfer" | "cash" | "platform" | "credit";
export type PriceListKind = "retail" | "wholesale" | "dealer" | "promo";
export type ReturnReason = "defect" | "wrong_item" | "damaged" | "changed_mind" | "other";
export type ReturnStatus = "requested" | "approved" | "received" | "completed" | "rejected" | "cancelled";
export type ReturnResolution = "refund" | "exchange" | "none";
export type ReturnCondition = "intact" | "damaged" | "defective";
export type ReturnDisposition = "restock" | "quarantine";
export type DealerStatus = "active" | "paused" | "ended";

export const CHANNEL_KIND_LABEL: Record<ChannelKind, string> = {
  own_web: "Website",
  marketplace: "Sàn thương mại điện tử",
  social: "Mạng xã hội",
  dealer: "Đại lý",
  direct: "Bán trực tiếp",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cod: "Thu tiền khi giao (COD)",
  bank_transfer: "Chuyển khoản",
  cash: "Tiền mặt",
  platform: "Sàn thu hộ",
  credit: "Công nợ đại lý",
};

export const PRICE_LIST_KIND_LABEL: Record<PriceListKind, string> = {
  retail: "Bán lẻ",
  wholesale: "Bán sỉ",
  dealer: "Đại lý",
  promo: "Khuyến mãi",
};

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  defect: "Lỗi sản phẩm",
  wrong_item: "Giao nhầm hàng",
  damaged: "Hư hỏng khi vận chuyển",
  changed_mind: "Khách đổi ý",
  other: "Khác",
};

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: "Mới tiếp nhận",
  approved: "Đã duyệt",
  received: "Đã nhận hàng",
  completed: "Hoàn tất",
  rejected: "Từ chối",
  cancelled: "Đã hủy",
};

export const RETURN_RESOLUTION_LABEL: Record<ReturnResolution, string> = {
  refund: "Hoàn tiền",
  exchange: "Đổi hàng",
  none: "Không hoàn, không đổi",
};

export const RETURN_CONDITION_LABEL: Record<ReturnCondition, string> = {
  intact: "Còn nguyên",
  damaged: "Hư hỏng",
  defective: "Lỗi sản phẩm",
};

export const RETURN_DISPOSITION_LABEL: Record<ReturnDisposition, string> = {
  restock: "Nhập lại kho bán được",
  quarantine: "Đưa vào kho cách ly",
};

export const DEALER_STATUS_LABEL: Record<DealerStatus, string> = { active: "Đang hợp tác", paused: "Tạm dừng", ended: "Đã kết thúc" };

// ---------------------------------------------------------------------------------------------
// Tiền theo bp (R-CHUNG-4): round(a × bp / 10.000), làm tròn nửa lên, tính bằng BigInt

export function bpOf(amount: number, bp: number): number {
  if (amount <= 0 || bp <= 0) return 0;
  const num = BigInt(Math.round(amount)) * BigInt(Math.round(bp));
  return Number((num * 2n + 10_000n) / 20_000n);
}

// "21,5" (%) → 2150 bp; "10" → 1000. Lỗi → null.
export function parsePercentToBp(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace("%", "").replace(",", ".");
  if (s === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 0 && bp <= 10_000 ? bp : null;
}

// Số tiền kiểu Việt: "1.500.000" → 1500000; "" → 0; lỗi → null
export function parseMoney(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim().replace(/[\s.đ]/g, "").replace(/,/g, "");
  if (s === "") return 0;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n <= 2_000_000_000 ? n : null;
}

export function formatBp(bp: number): string {
  return `${(bp / 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;
}

// ---------------------------------------------------------------------------------------------
// R-BH-1 · Kênh và phí nền tảng

export function channelCodeProblem(code: string): string | null {
  if (!/^[A-Z]{2,5}$/.test(code)) return "Mã kênh gồm 2–5 chữ in hoa, không dấu";
  return null;
}

export function suggestedPlatformFee(subtotal: number, discountTotal: number, feeRateBp: number): number {
  return bpOf(Math.max(0, subtotal - discountTotal), feeRateBp);
}

// ---------------------------------------------------------------------------------------------
// R-BH-2 · Giá trên đơn tay

export type PriceListForPricing = {
  id: string;
  kind: PriceListKind;
  channelCode: string | null;
  validFrom: string | null;
  validTo: string | null;
  priority: number;
  isActive: boolean;
  items: { productId: string; unitPrice: number; minQty: number }[];
};

export function promoActive(list: Pick<PriceListForPricing, "kind" | "isActive" | "validFrom" | "validTo" | "channelCode">, channelCode: string, today: string): boolean {
  if (list.kind !== "promo" || !list.isActive) return false;
  if (list.validFrom && list.validFrom > today) return false;
  if (list.validTo && list.validTo < today) return false;
  return list.channelCode === null || list.channelCode === channelCode;
}

// Trong một bảng: dòng có min_qty lớn nhất mà ≤ số lượng
export function priceInList(list: Pick<PriceListForPricing, "items">, productId: string, qty: number): number | null {
  let best: { minQty: number; unitPrice: number } | null = null;
  for (const it of list.items) {
    if (it.productId !== productId || it.minQty > qty) continue;
    if (!best || it.minQty > best.minQty) best = it;
  }
  return best ? best.unitPrice : null;
}

export function resolveUnitPrice(input: {
  productId: string;
  qty: number;
  retailPrice: number;
  channelCode: string;
  today: string;
  dealerList: PriceListForPricing | null;
  channelList: PriceListForPricing | null;
  promoLists: PriceListForPricing[];
}): { unitPrice: number; priceListId: string | null } {
  const ordered: PriceListForPricing[] = [];
  if (input.dealerList && input.dealerList.isActive) ordered.push(input.dealerList);
  const promos = input.promoLists.filter((l) => promoActive(l, input.channelCode, input.today)).sort((a, b) => b.priority - a.priority);
  ordered.push(...promos);
  if (input.channelList && input.channelList.isActive) ordered.push(input.channelList);
  for (const list of ordered) {
    const p = priceInList(list, input.productId, input.qty);
    if (p !== null) return { unitPrice: p, priceListId: list.id };
  }
  return { unitPrice: input.retailPrice, priceListId: null };
}

// ---------------------------------------------------------------------------------------------
// R-BH-4 · Combo

export function bundleDiscount(componentsTotal: number, bundlePrice: number): number {
  return Math.max(0, componentsTotal - bundlePrice);
}

// ---------------------------------------------------------------------------------------------
// R-BH-5 · Voucher

export type VoucherLike = {
  code: string;
  kind: "percent" | "amount";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  channelCode: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
};

export function normalizeVoucherCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function voucherProblem(v: VoucherLike, ctx: { channelCode: string; base: number; now: Date }): string | null {
  if (!v.isActive) return "Mã giảm giá đang tắt";
  if (v.validFrom && v.validFrom.getTime() > ctx.now.getTime()) return "Mã giảm giá chưa tới ngày dùng";
  if (v.validTo && v.validTo.getTime() < ctx.now.getTime()) return "Mã giảm giá đã hết hạn";
  if (v.usageLimit !== null && v.usedCount >= v.usageLimit) return "Mã đã dùng hết lượt";
  if (v.channelCode && v.channelCode !== ctx.channelCode) return "Mã giảm giá không dùng cho kênh này";
  if (ctx.base < v.minOrder) return `Đơn chưa đủ ${formatVnd(v.minOrder)} để dùng mã này`;
  return null;
}

export function voucherDiscount(v: Pick<VoucherLike, "kind" | "value" | "maxDiscount">, base: number): number {
  if (base <= 0) return 0;
  if (v.kind === "amount") return Math.min(v.value, base);
  const d = bpOf(base, v.value);
  return Math.min(base, v.maxDiscount !== null ? Math.min(d, v.maxDiscount) : d);
}

// ---------------------------------------------------------------------------------------------
// R-BH-6 · Chiết khấu đơn: combo → đại lý → voucher → tay, mỗi bước trên phần còn lại

export type DiscountBreakdown = {
  combo: number;
  dealer: number;
  voucher: number;
  manual: number;
  discountTotal: number;
  total: number;
  // Cơ sở tính voucher (sau combo và chiết khấu đại lý)
  voucherBase: number;
};

export function computeDiscounts(input: {
  subtotal: number;
  comboDiscount: number;
  dealerBp: number;
  voucher: Pick<VoucherLike, "kind" | "value" | "maxDiscount"> | null;
  manualDiscount: number;
  shippingFee: number;
}): DiscountBreakdown {
  let rest = input.subtotal;
  const combo = Math.min(rest, Math.max(0, input.comboDiscount));
  rest -= combo;
  const dealer = Math.min(rest, bpOf(rest, input.dealerBp));
  rest -= dealer;
  const voucherBase = rest;
  const voucher = input.voucher ? voucherDiscount(input.voucher, rest) : 0;
  rest -= voucher;
  const manual = Math.min(rest, Math.max(0, input.manualDiscount));
  rest -= manual;
  const discountTotal = combo + dealer + voucher + manual;
  return { combo, dealer, voucher, manual, discountTotal, total: input.subtotal - discountTotal + Math.max(0, input.shippingFee), voucherBase };
}

// Chiết khấu tay > manualDiscountMaxBp của subtotal cần sales.pricing
export function manualDiscountNeedsPricing(manualDiscount: number, subtotal: number, maxBp: number): boolean {
  if (manualDiscount <= 0) return false;
  // manual / subtotal > maxBp / 10000  ⇔  manual × 10000 > subtotal × maxBp
  return BigInt(manualDiscount) * 10_000n > BigInt(subtotal) * BigInt(maxBp);
}

// ---------------------------------------------------------------------------------------------
// R-BH-7 · Đơn tay theo loại kênh

export const CHANNEL_PAYMENTS: Record<ChannelKind, readonly PaymentMethod[]> = {
  own_web: ["cod", "bank_transfer"],
  marketplace: ["platform"],
  social: ["cod", "bank_transfer"],
  dealer: ["credit", "bank_transfer", "cash"],
  direct: ["cash", "bank_transfer"],
};

export function manualOrderProblem(input: {
  channel: { code: string; kind: ChannelKind; isActive: boolean } | null;
  paymentMethod: PaymentMethod;
  phoneE164: string | null;
  hasAddress: boolean;
  externalRef: string | null;
  dealerId: string | null;
  consentConfirmed: boolean;
}): string | null {
  const ch = input.channel;
  if (!ch) return "Không tìm thấy kênh bán";
  if (ch.kind === "own_web" || ch.code === "WEB") return "Kênh website chỉ nhận đơn khách tự đặt, không tạo đơn tay";
  if (!ch.isActive) return "Kênh đang tắt";
  if (!CHANNEL_PAYMENTS[ch.kind].includes(input.paymentMethod)) {
    if (ch.kind === "marketplace") return "Đơn sàn dùng thanh toán qua sàn";
    return `Kênh này không dùng thanh toán “${PAYMENT_METHOD_LABEL[input.paymentMethod]}”`;
  }
  if (ch.kind === "marketplace" && !input.externalRef) return "Nhập mã đơn trên sàn";
  if (ch.kind === "social" && (!input.phoneE164 || !input.hasAddress)) return "Đơn mạng xã hội cần số điện thoại và địa chỉ giao";
  if (ch.kind === "dealer" && !input.dealerId) return "Chọn đại lý";
  if ((ch.kind === "social" || ch.kind === "direct") && input.phoneE164 && !input.consentConfirmed) return "Tích ô “Khách đã đồng ý cho Pomil dùng thông tin để giao hàng”";
  return null;
}

// ---------------------------------------------------------------------------------------------
// R-BH-9 · Hạn mức công nợ đại lý

export function creditLimitProblem(input: { creditLimit: number; outstanding: number; newTotal: number }): string | null {
  if (input.creditLimit <= 0) return "Đại lý chưa được mua chịu";
  if (input.outstanding + input.newTotal > input.creditLimit) {
    return `Vượt hạn mức công nợ: còn ${formatVnd(Math.max(0, input.creditLimit - input.outstanding))}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// R-BH-10 · Hiệu lực đại lý

export function dealerOrderProblem(d: { status: DealerStatus; contractEnd: string | null; name: string }, today: string): string | null {
  if (d.contractEnd && d.contractEnd < today) return `Hợp đồng đại lý đã hết hạn ngày ${formatIsoDate(d.contractEnd)}`;
  if (d.status !== "active") return `Đại lý ${d.name} đang ${DEALER_STATUS_LABEL[d.status].toLowerCase()}, không tạo đơn được`;
  return null;
}

// Còn ≤ 30 ngày tới contract_end (và chưa hết hạn) → cảnh báo
export function contractEndingSoon(contractEnd: string | null, today: string, days = 30): boolean {
  if (!contractEnd || contractEnd < today) return false;
  return contractEnd <= addDays(today, days);
}

export function canChangeDealerStatus(from: DealerStatus, to: DealerStatus): boolean {
  if (from === to) return false;
  if (from === "ended") return false;
  if (to === "ended") return true;
  return (from === "active" && to === "paused") || (from === "paused" && to === "active");
}

// ---------------------------------------------------------------------------------------------
// R-BH-11 · Trạng thái đổi trả

export const RETURN_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  requested: ["approved", "rejected", "cancelled"],
  approved: ["received", "cancelled"],
  received: ["completed", "rejected"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canReturnTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------------------------
// R-BH-19 · Tạo đổi trả

export function returnWindowProblem(deliveredAt: Date | null, windowDays: number, today: string): string | null {
  if (!deliveredAt) return "Đơn chưa giao";
  if (windowDays <= 0) return null;
  const deliveredOn = isoDateVn(deliveredAt);
  return addDays(deliveredOn, windowDays) >= today ? null : "Quá hạn đổi trả";
}

// Số còn trả được của một dòng = đã giao − đã trả ở các đổi trả chưa hủy/từ chối
export function returnableQty(deliveredQty: number, alreadyReturned: number): number {
  return Math.max(0, deliveredQty - alreadyReturned);
}

export function returnLinesProblem(lines: { orderItemId: string; qty: number; name: string; deliveredQty: number; alreadyReturned: number }[]): string | null {
  if (lines.length === 0) return "Chọn ít nhất một dòng hàng trả";
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) return `Số trả của ${l.name} phải là số nguyên lớn hơn 0`;
    const max = returnableQty(l.deliveredQty, l.alreadyReturned);
    if (l.qty > max) return `Số trả của ${l.name} vượt số đã giao: còn trả được ${max}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// R-BH-20 · Kiểm hàng trả

export function dispositionProblem(condition: ReturnCondition | null, disposition: ReturnDisposition | null): string | null {
  if (!condition) return "Ghi tình trạng của từng dòng";
  if (!disposition) return "Chọn cách xử lý của từng dòng";
  if (condition !== "intact" && disposition !== "quarantine") return "Hàng hư hỏng hoặc lỗi phải đưa vào kho cách ly";
  return null;
}

// ---------------------------------------------------------------------------------------------
// R-BH-21 · Tiền hoàn mặc định

// Phần chiết khấu đơn phân bổ cho số chai trả = round(discountTotal × (qty × đơn giá) / subtotal), nửa lên
export function defaultRefund(input: { lines: { qty: number; unitPrice: number }[]; subtotal: number; discountTotal: number }): number {
  const gross = input.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  if (gross <= 0) return 0;
  if (input.subtotal <= 0 || input.discountTotal <= 0) return gross;
  const num = BigInt(input.discountTotal) * BigInt(gross);
  const share = Number((num * 2n + BigInt(input.subtotal)) / (2n * BigInt(input.subtotal)));
  return Math.max(0, gross - share);
}

export function maxRefund(collectable: number, refundedBefore: number): number {
  return Math.max(0, collectable - refundedBefore);
}

// R-BH-22: tách tiền hoàn giữa giảm công nợ và chi tiền
export function splitRefund(refund: number, debt: { amount: number; paidAmount: number } | null): { reduceDebt: number; cashOut: number } {
  if (!debt) return { reduceDebt: 0, cashOut: refund };
  const reducible = Math.max(0, debt.amount - debt.paidAmount);
  const reduceDebt = Math.min(refund, reducible);
  return { reduceDebt, cashOut: refund - reduceDebt };
}

// Trả đủ mọi chai đã giao của đơn?
export function isFullReturn(items: { orderItemId: string; quantity: number }[], returned: Map<string, number>): boolean {
  if (items.length === 0) return false;
  return items.every((i) => (returned.get(i.orderItemId) ?? 0) >= i.quantity);
}

// ---------------------------------------------------------------------------------------------
// R-BH-26 · Tỷ lệ hoàn

export function returnRate(input: { returnedOrders: number; deliveredWithReturn: number; delivered: number }): number | null {
  const denom = input.delivered + input.returnedOrders;
  if (denom === 0) return null;
  return (input.returnedOrders + input.deliveredWithReturn) / denom;
}

// ---------------------------------------------------------------------------------------------
// R-BH-27 · Chỉ số khách

export type CustomerOrderLike = {
  status: string;
  total: number;
  createdAt: Date;
  refunded: number;
  items: { productId: string; productName: string; quantity: number }[];
};

export function customerMetrics(orders: CustomerOrderLike[]) {
  const live = orders.filter((o) => o.status !== "cancelled");
  const counted = live.filter((o) => o.status !== "returned");
  const spent = counted.reduce((s, o) => s + o.total - o.refunded, 0);
  const aov = counted.length ? Math.round(spent / counted.length) : 0;
  const sorted = [...live].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let frequencyDays: number | null = null;
  if (sorted.length >= 2) {
    const first = isoDateVn(sorted[0]!.createdAt);
    const last = isoDateVn(sorted[sorted.length - 1]!.createdAt);
    frequencyDays = Math.round(daysBetween(first, last) / (sorted.length - 1));
  }
  const byProduct = new Map<string, { productId: string; name: string; qty: number }>();
  for (const o of live) {
    for (const it of o.items) {
      const cur = byProduct.get(it.productId) ?? { productId: it.productId, name: it.productName, qty: 0 };
      cur.qty += it.quantity;
      byProduct.set(it.productId, cur);
    }
  }
  const topProducts = [...byProduct.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)).slice(0, 3);
  return {
    orderCount: live.length,
    spent,
    aov,
    frequencyDays,
    topProducts,
    lastOrderAt: sorted.length ? sorted[sorted.length - 1]!.createdAt : null,
  };
}

// ---------------------------------------------------------------------------------------------
// R-BH-28 · Nhãn và ghi chú

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
export const MAX_CARE_NOTE = 1000;

export function normalizeTag(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function addTag(tags: string[], raw: string): { ok: true; tags: string[] } | { ok: false; message: string } {
  const tag = normalizeTag(raw);
  if (!tag) return { ok: false, message: "Nhập nhãn" };
  if (tag.length > MAX_TAG_LENGTH) return { ok: false, message: `Nhãn tối đa ${MAX_TAG_LENGTH} ký tự` };
  if (tags.includes(tag)) return { ok: true, tags };
  if (tags.length >= MAX_TAGS) return { ok: false, message: `Mỗi khách tối đa ${MAX_TAGS} nhãn` };
  return { ok: true, tags: [...tags, tag] };
}

export function careNoteProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return "Nhập nội dung ghi chú";
  if (t.length > MAX_CARE_NOTE) return `Ghi chú tối đa ${MAX_CARE_NOTE} ký tự`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// R-BH-29 · Báo cáo bán hàng

export type ReportOrder = {
  status: string;
  subtotal: number;
  discountTotal: number;
  createdAt: Date;
};

export const REVENUE_EXCLUDED_STATUSES = ["cancelled", "returned"] as const;

export function countsForRevenue(status: string): boolean {
  return status !== "cancelled" && status !== "returned";
}

export function netSales(o: Pick<ReportOrder, "subtotal" | "discountTotal">): number {
  return o.subtotal - o.discountTotal;
}

export function salesSummary(orders: ReportOrder[]) {
  const counted = orders.filter((o) => countsForRevenue(o.status));
  const revenue = counted.reduce((s, o) => s + netSales(o), 0);
  const delivered = orders.filter((o) => o.status === "delivered").length;
  const finished = orders.filter((o) => o.status === "delivered" || o.status === "returned" || o.status === "cancelled").length;
  return {
    revenue,
    orders: counted.length,
    aov: counted.length ? Math.round(revenue / counted.length) : 0,
    successRate: finished ? delivered / finished : null,
  };
}

export function successRate(orders: { status: string }[]): number | null {
  const delivered = orders.filter((o) => o.status === "delivered").length;
  const finished = orders.filter((o) => o.status === "delivered" || o.status === "returned" || o.status === "cancelled").length;
  return finished ? delivered / finished : null;
}

export type Granularity = "day" | "week" | "month";

// Khóa nhóm theo giờ VN: ngày "2027-11-20", tuần = ngày thứ Hai đầu tuần, tháng "2027-11"
export function periodKey(at: Date, g: Granularity): string {
  const day = isoDateVn(at);
  if (g === "day") return day;
  if (g === "month") return day.slice(0, 7);
  return weekStart(day);
}

export function weekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = CN
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(isoDate, -back);
}

export function formatPercent(rate: number | null): string {
  if (rate === null) return "—";
  return `${(Math.round(rate * 1000) / 10).toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// Lợi nhuận góp theo kênh (R-BH-29): doanh số giao − phí nền tảng − giá vốn − tiền đã hoàn
export function contributionMargin(input: { revenue: number; platformFee: number; cogs: number; refunded: number }): number {
  return input.revenue - input.platformFee - input.cogs - input.refunded;
}

// ---------------------------------------------------------------------------------------------
// R-BH-30 · Hoa hồng đại lý

export function dealerCommission(netDelivered: number, refunded: number, commissionBp: number): number {
  return bpOf(Math.max(0, netDelivered - refunded), commissionBp);
}

// ---------------------------------------------------------------------------------------------
// R-BH-31 · Đơn sàn không trùng

export function duplicateExternalRefMessage(externalRef: string, existingCode: string): string {
  return `Đơn sàn ${externalRef} đã có (${existingCode})`;
}

// ---------------------------------------------------------------------------------------------
// R-BH-33 · Sửa phí nền tảng

export function platformFeeChangeProblem(input: { total: number; newFee: number; debt: { amount: number; paidAmount: number; status: string } | null }): string | null {
  if (!Number.isSafeInteger(input.newFee) || input.newFee < 0) return "Phí nền tảng phải là số không âm";
  if (input.newFee >= input.total) return "Phí nền tảng phải nhỏ hơn tổng đơn";
  if (!input.debt) return null;
  if (input.debt.status === "paid" || input.debt.paidAmount >= input.debt.amount) return "Sàn đã trả đủ khoản này, không sửa phí được";
  if (input.total - input.newFee < input.debt.paidAmount) return `Số phải thu mới thấp hơn số sàn đã trả ${formatVnd(input.debt.paidAmount)}`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Ngày (giờ VN, R-CHUNG-6)

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function isoDateVn(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Đầu ngày VN của một ngày ISO, dạng Date (UTC)
export function vnDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+07:00`);
}

export function formatIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}
