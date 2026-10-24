import "server-only";
import { getProductsByIds, type Product } from "@/modules/catalog/service";
import { priceCart, shippingFee, type CartProblem } from "@/modules/orders/rules";
import type { StoreSettings } from "@/modules/settings/schema";
import { readCart } from "./service";

export type CartView = {
  rows: { product: Product; quantity: number; lineTotal: number }[];
  missing: number;
  subtotal: number;
  shippingFee: number;
  total: number;
  problems: CartProblem[];
};

// Dữ liệu để hiển thị giỏ hàng và trang thanh toán, tính bằng cùng quy tắc với lúc đặt đơn.
export async function loadCartView(settings: StoreSettings): Promise<CartView> {
  const lines = await readCart();
  const products = await getProductsByIds(lines.map((l) => l.productId));
  const byId = new Map(products.map((p) => [p.id, p]));
  const rows = lines.flatMap((l) => {
    const product = byId.get(l.productId);
    return product ? [{ product, quantity: l.quantity, lineTotal: product.price * l.quantity }] : [];
  });
  const subtotal = rows.reduce((s, r) => s + r.lineTotal, 0);
  const shipping = { flatFee: settings.shippingFlatFee, freeThreshold: settings.shippingFreeThreshold };
  const priced = priceCart(lines, products, { maxQtyPerItem: settings.maxQtyPerItem, shipping });
  const problems = priced.ok ? [] : priced.problems.filter((p) => p.code !== "empty");
  const fee = shippingFee(subtotal, shipping);
  return { rows, missing: lines.length - rows.length, subtotal, shippingFee: fee, total: subtotal + fee, problems };
}
