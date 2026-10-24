import type { Metadata } from "next";
import Link from "next/link";
import { ProductVisual } from "@/components/product-visual";
import { formatVnd } from "@/lib/format";
import { loadCartView } from "@/modules/cart/view";
import { describeCartProblem } from "@/modules/orders/rules";
import { getSettings } from "@/modules/settings/service";
import { updateCartAction } from "./actions";

export const metadata: Metadata = { title: "Giỏ hàng", robots: { index: false } };

export default async function CartPage() {
  const settings = await getSettings();
  const cart = await loadCartView(settings);
  const toFree = settings.shippingFreeThreshold > 0 ? settings.shippingFreeThreshold - cart.subtotal : 0;

  if (cart.rows.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <h1 className="display text-4xl">Giỏ hàng đang trống</h1>
        <p className="mt-4 text-ink-soft">Bắt đầu với sản phẩm chủ lực của Pomil.</p>
        <Link href="/san-pham" className="btn btn-primary mt-8">
          Xem sản phẩm
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <h1 className="display text-5xl">Giỏ hàng</h1>
      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_22rem]">
        <ul className="divide-y divide-line border-y border-line">
          {cart.rows.map(({ product, quantity, lineTotal }) => (
            <li key={product.id} className="flex gap-5 py-6">
              <Link href={`/san-pham/${product.slug}`} className="w-24 shrink-0 sm:w-28">
                <ProductVisual product={product} className="aspect-[4/5]" />
              </Link>
              <div className="flex flex-1 flex-col">
                <div className="flex justify-between gap-4">
                  <div>
                    <Link href={`/san-pham/${product.slug}`} className="font-medium hover:underline">
                      {product.name}
                    </Link>
                    <p className="text-sm text-ink-soft">
                      {product.size} · {formatVnd(product.price)}
                    </p>
                  </div>
                  <p className="font-medium">{formatVnd(lineTotal)}</p>
                </div>
                <div className="mt-auto flex items-center gap-4 pt-4">
                  <form action={updateCartAction} className="flex items-center border border-line">
                    <input type="hidden" name="productId" value={product.id} />
                    <button name="quantity" value={quantity - 1} className="h-9 w-9" aria-label="Bớt một">
                      −
                    </button>
                    <span className="w-8 text-center text-sm" aria-label="Số lượng">
                      {quantity}
                    </span>
                    <button name="quantity" value={quantity + 1} className="h-9 w-9" aria-label="Thêm một" disabled={quantity >= Math.min(settings.maxQtyPerItem, product.stock)}>
                      +
                    </button>
                  </form>
                  <form action={updateCartAction}>
                    <input type="hidden" name="productId" value={product.id} />
                    <button name="quantity" value={0} className="text-sm text-ink-soft underline underline-offset-4 hover:text-graphite">
                      Xóa
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="h-fit border border-line bg-paper p-6">
          <h2 className="eyebrow">Tóm tắt</h2>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Tạm tính</dt>
              <dd>{formatVnd(cart.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Phí giao</dt>
              <dd>{cart.shippingFee === 0 ? "Miễn phí" : formatVnd(cart.shippingFee)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-medium">
              <dt>Tổng</dt>
              <dd>{formatVnd(cart.total)}</dd>
            </div>
          </dl>
          {toFree > 0 && <p className="mt-4 bg-pith p-3 text-sm">Thêm {formatVnd(toFree)} để được miễn phí giao.</p>}
          {cart.problems.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm text-danger" role="alert">
              {cart.problems.map((p, i) => (
                <li key={i}>{describeCartProblem(p)}</li>
              ))}
            </ul>
          )}
          {cart.problems.length === 0 && settings.salesOpen ? (
            <Link href="/thanh-toan" className="btn btn-primary mt-6 w-full">
              Thanh toán
            </Link>
          ) : (
            <p className="mt-6 text-sm text-ink-soft">{settings.salesOpen ? "Sửa các mục trên để tiếp tục." : "Cửa hàng đang tạm ngừng nhận đơn."}</p>
          )}
          <Link href="/san-pham" className="mt-4 block text-center text-sm text-ink-soft underline underline-offset-4">
            Tiếp tục mua
          </Link>
        </aside>
      </div>
    </div>
  );
}
