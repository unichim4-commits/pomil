"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addToCartAction, type AddToCartState } from "@/app/(public)/gio-hang/actions";

export function AddToCart({ productId, max, compact = false }: { productId: string; max: number; compact?: boolean }) {
  const [state, action, pending] = useActionState<AddToCartState, FormData>(addToCartAction, { status: "idle" });
  const [qty, setQty] = useState(1);

  if (compact) {
    return (
      <form action={action}>
        <input type="hidden" name="productId" value={productId} />
        <button type="submit" disabled={pending} className="btn btn-outline w-full">
          {pending ? "Đang thêm…" : state.status === "added" ? "Đã thêm ✓" : "Thêm vào giỏ"}
        </button>
        {state.status === "error" && <p className="mt-2 text-sm text-danger">{state.message}</p>}
      </form>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="productId" value={productId} />
      <div className="flex gap-3">
        <div className="flex items-stretch border border-graphite">
          <button type="button" aria-label="Bớt một" className="w-11 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))}>
            −
          </button>
          <input
            name="quantity"
            value={qty}
            onChange={(e) => setQty(Math.min(max, Math.max(1, Number(e.target.value) || 1)))}
            inputMode="numeric"
            aria-label="Số lượng"
            className="w-12 bg-transparent text-center"
          />
          <button type="button" aria-label="Thêm một" className="w-11 text-lg" onClick={() => setQty((q) => Math.min(max, q + 1))}>
            +
          </button>
        </div>
        <button type="submit" disabled={pending} className="btn btn-primary flex-1">
          {pending ? "Đang thêm…" : "Thêm vào giỏ"}
        </button>
      </div>
      <button type="submit" name="buyNow" value="1" disabled={pending} className="btn btn-outline w-full">
        Mua ngay
      </button>
      <div aria-live="polite" className="min-h-6 text-sm">
        {state.status === "added" && (
          <p className="text-ok">
            Đã thêm vào giỏ.{" "}
            <Link href="/gio-hang" className="underline underline-offset-4">
              Xem giỏ hàng
            </Link>
          </p>
        )}
        {state.status === "error" && <p className="text-danger">{state.message}</p>}
      </div>
    </form>
  );
}
