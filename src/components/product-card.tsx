import Link from "next/link";
import { formatVnd } from "@/lib/format";
import type { Product } from "@/modules/catalog/service";
import { ProductVisual } from "./product-visual";

export function productAvailability(product: Pick<Product, "status" | "stock">, salesOpen: boolean): "buy" | "soon" | "sold_out" {
  if (product.status === "coming_soon" || !salesOpen) return "soon";
  return product.stock > 0 ? "buy" : "sold_out";
}

export function ProductCard({ product, salesOpen }: { product: Product; salesOpen: boolean }) {
  const availability = productAvailability(product, salesOpen);
  return (
    <Link href={`/san-pham/${product.slug}`} className="group block">
      <div className="relative">
        <ProductVisual product={product} className="aspect-[4/5] transition duration-500 group-hover:brightness-[0.97]" />
        {availability !== "buy" && (
          <span className="eyebrow absolute left-3 top-3 bg-bone px-2 py-1 text-[0.62rem]">{availability === "soon" ? "Sắp ra mắt" : "Tạm hết"}</span>
        )}
      </div>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium">{product.name}</h3>
          <p className="mt-1 text-sm text-ink-soft">
            {product.subtitle}
            {product.size && ` · ${product.size}`}
          </p>
        </div>
        <p className="shrink-0 text-sm font-medium">{formatVnd(product.price)}</p>
      </div>
    </Link>
  );
}
