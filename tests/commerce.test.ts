import { describe, expect, it } from "vitest";
import { addToCart, cartCount, parseCart, serializeCart, setQuantity } from "@/modules/cart/rules";
import {
  awaitsPacking,
  canTransition,
  formatOrderCode,
  isOrderPacked,
  nextLifecycleStage,
  priceCart,
  restoresStock,
  shippingFee,
  type SellableProduct,
} from "@/modules/orders/rules";
import { parseSettings } from "@/modules/settings/schema";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const tonic: SellableProduct = { id: P1, name: "Pomelo Scalp Tonic", price: 229_000, stock: 10, status: "active" };
const mini: SellableProduct = { id: P2, name: "Scalp Tonic mini", price: 69_000, stock: 0, status: "active" };
const opts = { maxQtyPerItem: 5, shipping: { flatFee: 25_000, freeThreshold: 450_000 } };

describe("shipping fee", () => {
  it("charges flat fee under threshold", () => expect(shippingFee(229_000, opts.shipping)).toBe(25_000));
  it("free at threshold", () => expect(shippingFee(458_000, opts.shipping)).toBe(0));
  it("threshold 0 means never free", () => expect(shippingFee(9_999_999, { flatFee: 20_000, freeThreshold: 0 })).toBe(20_000));
  it("empty cart has no fee", () => expect(shippingFee(0, opts.shipping)).toBe(0));
});

describe("priceCart", () => {
  it("prices from server data and adds shipping", () => {
    const r = priceCart([{ productId: P1, quantity: 1 }], [tonic], opts);
    expect(r).toEqual({
      ok: true,
      lines: [{ productId: P1, productName: "Pomelo Scalp Tonic", unitPrice: 229_000, quantity: 1, lineTotal: 229_000 }],
      subtotal: 229_000,
      shippingFee: 25_000,
      total: 254_000,
    });
  });

  it("two bottles reach free shipping", () => {
    const r = priceCart([{ productId: P1, quantity: 2 }], [tonic], opts);
    expect(r.ok && r.shippingFee).toBe(0);
  });

  it("rejects empty cart", () => {
    expect(priceCart([], [tonic], opts)).toEqual({ ok: false, problems: [{ code: "empty" }] });
  });

  it("rejects out-of-stock, unknown, inactive and too many", () => {
    const r = priceCart(
      [
        { productId: P2, quantity: 1 },
        { productId: "33333333-3333-4333-8333-333333333333", quantity: 1 },
      ],
      [tonic, mini],
      opts,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.code)).toEqual(["out_of_stock", "unavailable"]);

    const soon = priceCart([{ productId: P1, quantity: 1 }], [{ ...tonic, status: "coming_soon" }], opts);
    expect(!soon.ok && soon.problems[0]?.code).toBe("unavailable");

    const many = priceCart([{ productId: P1, quantity: 6 }], [tonic], opts);
    expect(!many.ok && many.problems[0]?.code).toBe("invalid_quantity");

    const short = priceCart([{ productId: P1, quantity: 3 }], [{ ...tonic, stock: 2 }], opts);
    expect(!short.ok && short.problems[0]).toEqual({ code: "insufficient_stock", productId: P1, name: tonic.name, available: 2 });
  });
});

describe("order status", () => {
  it("moves forward only", () => {
    expect(canTransition("pending", "confirmed")).toBe(true);
    expect(canTransition("shipping", "delivered")).toBe(true);
    expect(canTransition("delivered", "pending")).toBe(false);
    expect(canTransition("shipping", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "confirmed")).toBe(false);
  });
  it("restores stock on cancel and return only", () => {
    expect(restoresStock("cancelled")).toBe(true);
    expect(restoresStock("returned")).toBe(true);
    expect(restoresStock("delivered")).toBe(false);
  });
});

describe("đóng gói (R-BH-13, BUG-6)", () => {
  it("đã gói khi Đang đóng gói và có sự kiện packed hoặc đã xuất kho; không cần xuất kho", () => {
    expect(isOrderPacked({ status: "packing", stockIssuedAt: null, hasPackedEvent: true })).toBe(true);
    expect(isOrderPacked({ status: "packing", stockIssuedAt: new Date(), hasPackedEvent: false })).toBe(true);
    expect(isOrderPacked({ status: "packing", stockIssuedAt: null, hasPackedEvent: false })).toBe(false);
    expect(isOrderPacked({ status: "confirmed", stockIssuedAt: new Date(), hasPackedEvent: false })).toBe(false);
  });
  it("chờ đóng gói: đã xác nhận hoặc Đang đóng gói chưa gói thật", () => {
    expect(awaitsPacking({ status: "confirmed", stockIssuedAt: null, hasPackedEvent: false })).toBe(true);
    expect(awaitsPacking({ status: "packing", stockIssuedAt: null, hasPackedEvent: false })).toBe(true);
    expect(awaitsPacking({ status: "packing", stockIssuedAt: null, hasPackedEvent: true })).toBe(false);
    expect(awaitsPacking({ status: "shipping", stockIssuedAt: null, hasPackedEvent: true })).toBe(false);
    expect(awaitsPacking({ status: "pending", stockIssuedAt: null, hasPackedEvent: false })).toBe(false);
  });
});

describe("order code", () => {
  it("uses Vietnam month, not UTC", () => {
    // 31/10 18:00 UTC là 01/11 01:00 giờ Việt Nam
    expect(formatOrderCode("web", new Date("2027-10-31T18:00:00Z"), 7)).toBe("WEB-2711-0007");
    expect(formatOrderCode("WEB", new Date("2027-11-15T03:00:00Z"), 1234)).toBe("WEB-2711-1234");
  });
});

describe("lifecycle", () => {
  it("first order makes first buyer, second makes repeat buyer", () => {
    expect(nextLifecycleStage("lead", 0)).toBe("first_buyer");
    expect(nextLifecycleStage("first_buyer", 1)).toBe("repeat_buyer");
    expect(nextLifecycleStage("ambassador", 3)).toBe("ambassador");
    expect(nextLifecycleStage("churned", 2)).toBe("repeat_buyer");
  });
});

describe("cart cookie", () => {
  it("round-trips and ignores junk", () => {
    const lines = addToCart(addToCart([], P1, 1, 5), P2, 2, 5);
    expect(parseCart(serializeCart(lines))).toEqual(lines);
    expect(parseCart("not json")).toEqual([]);
    expect(parseCart(encodeURIComponent(JSON.stringify([{ p: "x", q: 1 }, { p: P1, q: -1 }, { p: P1, q: 2 }])))).toEqual([
      { productId: P1, quantity: 2 },
    ]);
  });
  it("adds to existing line, caps at max, removes at zero", () => {
    let lines = addToCart([], P1, 2, 5);
    lines = addToCart(lines, P1, 9, 5);
    expect(lines).toEqual([{ productId: P1, quantity: 5 }]);
    expect(cartCount(lines)).toBe(5);
    expect(setQuantity(lines, P1, 0, 5)).toEqual([]);
  });
});

describe("settings", () => {
  it("fills defaults", () => {
    const s = parseSettings(undefined);
    expect(s.storeName).toBe("Pomil");
    // D-1 (T-3): DB mới mặc định TẮT nhận đơn
    expect(s.salesOpen).toBe(false);
    expect(s.shippingFlatFee).toBe(25_000);
  });
});
