// Quy tắc đơn hàng (SYS-23). Hàm thuần để test được.

export type OrderStatus = "pending" | "confirmed" | "packing" | "shipping" | "delivered" | "cancelled" | "returned";
export type ProductStatus = "draft" | "coming_soon" | "active" | "archived";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  packing: "Đang đóng gói",
  shipping: "Đang giao",
  delivered: "Đã giao",
  cancelled: "Đã hủy",
  returned: "Hoàn trả",
};

// Đơn chỉ đi tới, không lùi. Hủy được trước khi giao cho đơn vị vận chuyển.
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packing", "cancelled"],
  packing: ["shipping", "cancelled"],
  shipping: ["delivered", "returned"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

// Hàng đã trừ kho lúc đặt, nên hủy hoặc hoàn trả thì cộng lại.
export function restoresStock(to: OrderStatus): boolean {
  return to === "cancelled" || to === "returned";
}

export type ShippingRule = { flatFee: number; freeThreshold: number };

export function shippingFee(subtotal: number, rule: ShippingRule): number {
  if (subtotal <= 0) return 0;
  if (rule.freeThreshold > 0 && subtotal >= rule.freeThreshold) return 0;
  return Math.max(0, rule.flatFee);
}

export type CartLine = { productId: string; quantity: number };
export type SellableProduct = { id: string; name: string; price: number; stock: number; status: ProductStatus };

export type PricedLine = { productId: string; productName: string; unitPrice: number; quantity: number; lineTotal: number };

export type CartProblem =
  | { code: "unavailable"; productId: string; name?: string }
  | { code: "out_of_stock"; productId: string; name: string }
  | { code: "insufficient_stock"; productId: string; name: string; available: number }
  | { code: "invalid_quantity"; productId: string; name: string; max: number }
  | { code: "empty" };

export type PricedCart =
  | { ok: true; lines: PricedLine[]; subtotal: number; shippingFee: number; total: number }
  | { ok: false; problems: CartProblem[] };

// Tính lại giá từ dữ liệu sản phẩm trên máy chủ. Không bao giờ tin giá gửi từ trình duyệt.
export function priceCart(
  lines: CartLine[],
  products: SellableProduct[],
  opts: { maxQtyPerItem: number; shipping: ShippingRule },
): PricedCart {
  if (lines.length === 0) return { ok: false, problems: [{ code: "empty" }] };

  const byId = new Map(products.map((p) => [p.id, p]));
  const problems: CartProblem[] = [];
  const priced: PricedLine[] = [];

  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product || product.status !== "active") {
      problems.push({ code: "unavailable", productId: line.productId, name: product?.name });
      continue;
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > opts.maxQtyPerItem) {
      problems.push({ code: "invalid_quantity", productId: product.id, name: product.name, max: opts.maxQtyPerItem });
      continue;
    }
    if (product.stock <= 0) {
      problems.push({ code: "out_of_stock", productId: product.id, name: product.name });
      continue;
    }
    if (product.stock < line.quantity) {
      problems.push({ code: "insufficient_stock", productId: product.id, name: product.name, available: product.stock });
      continue;
    }
    priced.push({
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      quantity: line.quantity,
      lineTotal: product.price * line.quantity,
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  const subtotal = priced.reduce((sum, l) => sum + l.lineTotal, 0);
  const fee = shippingFee(subtotal, opts.shipping);
  return { ok: true, lines: priced, subtotal, shippingFee: fee, total: subtotal + fee };
}

export function describeCartProblem(p: CartProblem): string {
  switch (p.code) {
    case "empty":
      return "Giỏ hàng đang trống.";
    case "unavailable":
      return `${p.name ?? "Một sản phẩm"} hiện không bán.`;
    case "out_of_stock":
      return `${p.name} đã hết hàng.`;
    case "insufficient_stock":
      return `${p.name} chỉ còn ${p.available} chai.`;
    case "invalid_quantity":
      return `${p.name}: mỗi đơn đặt tối đa ${p.max} chai.`;
  }
}

// Giờ Việt Nam (UTC+7), không có giờ mùa hè.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function vnYearMonth(date: Date): string {
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  const yy = String(vn.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

// Mã đơn KÊNH-YYMM-NNNN theo quy ước trong Briefing triển khai.
export function formatOrderCode(channel: string, date: Date, seq: number): string {
  return `${channel.toUpperCase()}-${vnYearMonth(date)}-${String(seq).padStart(4, "0")}`;
}

export function orderCodePrefix(channel: string, date: Date): string {
  return `${channel.toUpperCase()}-${vnYearMonth(date)}-`;
}

export type LifecycleStage = "lead" | "tester" | "first_buyer" | "repeat_buyer" | "ambassador" | "churned";

// Giai đoạn khách sau khi đặt thêm một đơn. priorOrders: số đơn trước đó chưa hủy.
export function nextLifecycleStage(current: LifecycleStage, priorOrders: number): LifecycleStage {
  if (current === "ambassador") return current;
  return priorOrders >= 1 ? "repeat_buyer" : "first_buyer";
}
