// Giỏ hàng lưu trong cookie dạng [{p, q}] để trang máy chủ đọc được và chạy cả khi tắt JavaScript.
import type { CartLine } from "@/modules/orders/rules";

export const CART_COOKIE = "pomil_cart";
export const CART_MAX_LINES = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCart(raw: string | undefined): CartLine[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(data)) return [];
    const lines: CartLine[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const { p, q } = item as { p?: unknown; q?: unknown };
      if (typeof p !== "string" || !UUID_RE.test(p)) continue;
      if (typeof q !== "number" || !Number.isInteger(q) || q < 1) continue;
      if (lines.some((l) => l.productId === p)) continue;
      lines.push({ productId: p, quantity: Math.min(q, 99) });
    }
    return lines.slice(0, CART_MAX_LINES);
  } catch {
    return [];
  }
}

export function serializeCart(lines: CartLine[]): string {
  return encodeURIComponent(JSON.stringify(lines.map((l) => ({ p: l.productId, q: l.quantity }))));
}

export function addToCart(lines: CartLine[], productId: string, quantity: number, max: number): CartLine[] {
  const existing = lines.find((l) => l.productId === productId);
  if (existing) return setQuantity(lines, productId, existing.quantity + quantity, max);
  if (lines.length >= CART_MAX_LINES) return lines;
  return [...lines, { productId, quantity: clamp(quantity, 1, max) }];
}

// Số lượng 0 hoặc nhỏ hơn thì bỏ dòng.
export function setQuantity(lines: CartLine[], productId: string, quantity: number, max: number): CartLine[] {
  if (quantity < 1) return lines.filter((l) => l.productId !== productId);
  return lines.map((l) => (l.productId === productId ? { ...l, quantity: clamp(quantity, 1, max) } : l));
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(n), min), max);
}
