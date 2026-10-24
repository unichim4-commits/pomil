"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getProductsByIds } from "@/modules/catalog/service";
import { addToCart, setQuantity } from "@/modules/cart/rules";
import { readCart, writeCart } from "@/modules/cart/service";
import { getSettings } from "@/modules/settings/service";

export type AddToCartState = { status: "idle" } | { status: "added"; at: number } | { status: "error"; message: string };

const addSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(50).default(1),
  buyNow: z.string().optional(),
});

export async function addToCartAction(_prev: AddToCartState, formData: FormData): Promise<AddToCartState> {
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Không thêm được sản phẩm" };

  const [product] = await getProductsByIds([parsed.data.productId]);
  const settings = await getSettings();
  if (!product || product.status !== "active" || !settings.salesOpen) return { status: "error", message: "Sản phẩm này hiện chưa bán" };
  if (product.stock <= 0) return { status: "error", message: "Sản phẩm đã hết hàng" };

  const max = Math.min(settings.maxQtyPerItem, product.stock);
  await writeCart(addToCart(await readCart(), product.id, parsed.data.quantity, max));
  if (parsed.data.buyNow) redirect("/gio-hang");
  return { status: "added", at: Date.now() };
}

const updateSchema = z.object({ productId: z.string().uuid(), quantity: z.coerce.number().int().min(0).max(50) });

export async function updateCartAction(formData: FormData): Promise<void> {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const settings = await getSettings();
  await writeCart(setQuantity(await readCart(), parsed.data.productId, parsed.data.quantity, settings.maxQtyPerItem));
}
