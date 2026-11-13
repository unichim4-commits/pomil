import "server-only";
import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import { products } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { ensureFinishedItem, renameFinishedItem } from "@/modules/inventory/ledger";
import { applyStockDelta, checkDevStage, checkGtin13, resolveDevStage, STOCK_MAX } from "./rules";

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

// Trường mở rộng (R-SX-1, R-SX-2): giai đoạn hợp trạng thái bán, mã vạch GTIN-13 đúng và không trùng.
async function checkExtendedFields(tx: Tx, v: { devStage: Product["devStage"]; status: string; barcode: string | null | undefined }, exceptId?: string) {
  const stage = checkDevStage(v.devStage, v.status);
  if (stage.error) throw new UserError(stage.error);
  if (v.barcode) {
    const problem = checkGtin13(v.barcode);
    if (problem) throw new UserError(problem);
    const [dup] = await tx
      .select({ code: products.code })
      .from(products)
      .where(and(eq(products.barcode, v.barcode), exceptId ? ne(products.id, exceptId) : undefined))
      .limit(1);
    if (dup) throw new UserError(`Mã vạch ${v.barcode} đã dùng cho sản phẩm ${dup.code}`);
  }
}

export async function createProduct(input: ProductInput, actorId: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    // Không gửi dev_stage: đang bán → commercial, ngược lại developing (R-SX-1)
    input = { ...input, devStage: resolveDevStage(input.devStage, null, input.status ?? "draft"), barcode: input.barcode?.trim() || null };
    await checkExtendedFields(tx, { devStage: input.devStage!, status: input.status ?? "draft", barcode: input.barcode });
    const [row] = await tx.insert(products).values(input).returning({ id: products.id });
    await writeAudit(tx, { actorId, action: "product.created", entity: "products", entityId: row!.id, after: { name: input.name, price: input.price } });
    // Mỗi sản phẩm một hàng thành phẩm (R-KHO-3)
    await ensureFinishedItem(tx, { id: row!.id, code: input.code, name: input.name });
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
    if (safe.barcode !== undefined) safe.barcode = safe.barcode?.trim() || null;
    await checkExtendedFields(
      tx,
      { devStage: safe.devStage ?? before.devStage, status: safe.status ?? before.status, barcode: safe.barcode !== undefined ? safe.barcode : before.barcode },
      id,
    );
    await tx
      .update(products)
      .set({ ...safe, updatedAt: new Date() })
      .where(eq(products.id, id));
    // Hàng thành phẩm đổi tên theo sản phẩm (R-KHO-3)
    if (safe.name !== undefined && safe.name !== before.name) await renameFinishedItem(tx, id, safe.name);
    // Chỉ ghi những trường hay cần đối chiếu: giá, trạng thái, tên
    const pick = (p: Partial<Product>) => ({ price: p.price, status: p.status, name: p.name });
    await writeAudit(tx, { actorId, action: "product.updated", entity: "products", entityId: id, before: pick(before), after: pick({ ...before, ...safe }) });
    // Đổi phiên bản sản phẩm hoặc giai đoạn: ghi riêng để tra cứu (R-SX-3)
    if ((safe.productVersion !== undefined && safe.productVersion !== before.productVersion) || (safe.devStage !== undefined && safe.devStage !== before.devStage)) {
      await writeAudit(tx, {
        actorId,
        action: "product.version_changed",
        entity: "products",
        entityId: id,
        before: { productVersion: before.productVersion, devStage: before.devStage },
        after: { productVersion: safe.productVersion ?? before.productVersion, devStage: safe.devStage ?? before.devStage },
      });
    }
  });
}

// Điều chỉnh tồn kho bằng cộng/trừ (stock = stock + delta), có điều kiện không âm và không vượt trần.
// Một câu UPDATE nên an toàn khi khách đang đặt đơn cùng lúc.
export async function adjustStock(id: string, delta: number, reason: string, actorId: string): Promise<{ ok: true; stock: number } | { ok: false; message: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    // Sản phẩm quản lý tồn theo kho: không điều chỉnh tay (R-KHO-25)
    const [tracked] = await tx.select({ track: products.trackInventory }).from(products).where(eq(products.id, id));
    if (tracked?.track) return { ok: false as const, message: "Sản phẩm này quản lý tồn theo kho: nhập, xuất hoặc kiểm kê ở mục Kho" };
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
