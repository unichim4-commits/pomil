import "server-only";
import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { products } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { applyStockDelta, STOCK_MAX } from "./rules";

export type Product = typeof products.$inferSelect;
export type ProductInput = Omit<typeof products.$inferInsert, "id" | "createdAt" | "updatedAt">;
// Sửa sản phẩm không bao giờ ghi tồn kho: tồn chỉ đổi qua đặt/hủy đơn và adjustStock.
export type ProductUpdate = Partial<Omit<ProductInput, "stock">>;

// Sản phẩm hiện trên web: đang bán và sắp ra mắt
export async function listPublicProducts(): Promise<Product[]> {
  const db = await getDb();
  return db
    .select()
    .from(products)
    .where(inArray(products.status, ["active", "coming_soon"]))
    .orderBy(asc(products.sortOrder), asc(products.name));
}

export async function getPublicProduct(slug: string): Promise<Product | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.slug, slug), inArray(products.status, ["active", "coming_soon"])));
  return row ?? null;
}

export async function getProductsByIds(ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  return db.select().from(products).where(inArray(products.id, ids));
}

export async function listAllProducts(): Promise<Product[]> {
  const db = await getDb();
  return db.select().from(products).orderBy(asc(products.sortOrder), asc(products.name));
}

export async function getProduct(id: string): Promise<Product | null> {
  const db = await getDb();
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row ?? null;
}

export async function findConflicts(input: { slug: string; code: string }, exceptId?: string) {
  const db = await getDb();
  const rows = await db
    .select({ slug: products.slug, code: products.code })
    .from(products)
    .where(
      and(
        sql`(${products.slug} = ${input.slug} or ${products.code} = ${input.code})`,
        exceptId ? ne(products.id, exceptId) : undefined,
      ),
    );
  return { slug: rows.some((r) => r.slug === input.slug), code: rows.some((r) => r.code === input.code) };
}

export async function createProduct(input: ProductInput, actorId: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(products).values(input).returning({ id: products.id });
    await writeAudit(tx, { actorId, action: "product.created", entity: "products", entityId: row!.id, after: { name: input.name, price: input.price } });
    return row!.id;
  });
}

export async function updateProduct(id: string, input: ProductUpdate, actorId: string): Promise<void> {
  const db = await getDb();
  // Bỏ stock nếu lỡ truyền vào (kiểu dữ liệu đã chặn, đây là chốt chặn thứ hai)
  const { stock: _ignored, ...safe } = input as ProductUpdate & { stock?: unknown };
  void _ignored;
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, id));
    if (!before) throw new UserError("Không tìm thấy sản phẩm");
    await tx
      .update(products)
      .set({ ...safe, updatedAt: new Date() })
      .where(eq(products.id, id));
    // Chỉ ghi những trường hay cần đối chiếu: giá, trạng thái, tên
    const pick = (p: Partial<Product>) => ({ price: p.price, status: p.status, name: p.name });
    await writeAudit(tx, { actorId, action: "product.updated", entity: "products", entityId: id, before: pick(before), after: pick({ ...before, ...safe }) });
  });
}

// Điều chỉnh tồn kho bằng cộng/trừ (stock = stock + delta), có điều kiện không âm và không vượt trần.
// Một câu UPDATE nên an toàn khi khách đang đặt đơn cùng lúc.
export async function adjustStock(id: string, delta: number, reason: string, actorId: string): Promise<{ ok: true; stock: number } | { ok: false; message: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(products)
      .set({ stock: sql`${products.stock} + ${delta}`, updatedAt: new Date() })
      .where(and(eq(products.id, id), gte(sql`${products.stock} + ${delta}`, 0), lte(sql`${products.stock} + ${delta}`, STOCK_MAX)))
      .returning({ stock: products.stock });
    if (!row) {
      const [current] = await tx.select({ stock: products.stock }).from(products).where(eq(products.id, id));
      if (!current) return { ok: false, message: "Không tìm thấy sản phẩm" };
      const verdict = applyStockDelta(current.stock, delta);
      return { ok: false, message: verdict.ok ? "Chưa điều chỉnh được, tải lại trang rồi thử lại." : verdict.message };
    }
    await writeAudit(tx, {
      actorId,
      action: "product.stock_adjusted",
      entity: "products",
      entityId: id,
      before: { stock: row.stock - delta },
      after: { stock: row.stock, delta, reason },
    });
    return { ok: true, stock: row.stock };
  });
}
