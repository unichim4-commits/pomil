import "server-only";
// Kênh bán, bảng giá, combo, voucher (R-BH-1…R-BH-5). Mọi thao tác ghi cần sales.pricing.
import { and, asc, desc, eq, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { auditLog, orders, priceListItems, priceLists, productBundleItems, productBundles, products, salesChannels, vouchers } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { vnToday } from "@/modules/numbering";
import { assertCan, type Actor } from "./access";
import { channelCodeProblem, normalizeVoucherCode, vnDayStart, type ChannelKind, type PriceListForPricing, type PriceListKind } from "./rules";

// ---------------------------------------------------------------------------------------------
// Kênh

export async function listChannels() {
  const db = await getDb();
  const monthStart = vnDayStart(`${vnToday().slice(0, 7)}-01`);
  const [channels, stats] = await Promise.all([
    db.select().from(salesChannels).orderBy(asc(salesChannels.sort), asc(salesChannels.code)),
    db
      .select({
        channel: orders.channel,
        n: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orders.subtotal} - ${orders.discountTotal}), 0)`,
      })
      .from(orders)
      .where(and(gte(orders.createdAt, monthStart), sql`${orders.status} not in ('cancelled','returned')`))
      .groupBy(orders.channel),
  ]);
  const byCode = new Map(stats.map((s) => [s.channel, { orders: Number(s.n), revenue: Number(s.revenue) }]));
  return channels.map((c) => ({ ...c, month: byCode.get(c.code) ?? { orders: 0, revenue: 0 } }));
}

export type ChannelInput = { name: string; kind: ChannelKind; feeRateBp: number; payoutDays: number; priceListId: string | null; isActive: boolean; sort: number; note: string | null };

function checkChannelInput(input: ChannelInput) {
  if (!input.name.trim()) throw new UserError("Nhập tên kênh");
  if (!Number.isInteger(input.feeRateBp) || input.feeRateBp < 0 || input.feeRateBp > 10_000) throw new UserError("Phí nền tảng từ 0% tới 100%");
  if (!Number.isInteger(input.payoutDays) || input.payoutDays < 0 || input.payoutDays > 365) throw new UserError("Số ngày tiền về từ 0 tới 365");
}

export async function createChannel(code: string, input: ChannelInput, actor: Actor): Promise<void> {
  assertCan(actor, "sales.pricing");
  const c = code.trim().toUpperCase();
  const problem = channelCodeProblem(c);
  if (problem) throw new UserError(problem);
  checkChannelInput(input);
  if (input.kind === "own_web") throw new UserError("Chỉ có một kênh website");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [exists] = await tx.select({ code: salesChannels.code }).from(salesChannels).where(eq(salesChannels.code, c));
    if (exists) throw new UserError(`Mã kênh ${c} đã có`);
    await tx.insert(salesChannels).values({ code: c, ...input, name: input.name.trim(), note: input.note?.trim() || null });
    await writeAudit(tx, { actorId: actor.id, action: "sales_channel.created", entity: "sales_channels", after: { code: c, ...input } });
  });
}

export async function updateChannel(code: string, input: Omit<ChannelInput, "kind">, actor: Actor): Promise<void> {
  assertCan(actor, "sales.pricing");
  checkChannelInput({ ...input, kind: "direct" });
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(salesChannels).where(eq(salesChannels.code, code)).for("update");
    if (!before) throw new UserError("Không tìm thấy kênh");
    if ((before.code === "WEB" || before.kind === "own_web") && !input.isActive) throw new UserError("Kênh website không tắt được");
    if (input.priceListId) {
      const [pl] = await tx.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.id, input.priceListId));
      if (!pl) throw new UserError("Không tìm thấy bảng giá");
    }
    const next = { name: input.name.trim(), feeRateBp: input.feeRateBp, payoutDays: input.payoutDays, priceListId: input.priceListId, isActive: input.isActive, sort: input.sort, note: input.note?.trim() || null };
    await tx.update(salesChannels).set(next).where(eq(salesChannels.code, code));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "sales_channel.updated",
      entity: "sales_channels",
      before: { code, name: before.name, feeRateBp: before.feeRateBp, payoutDays: before.payoutDays, priceListId: before.priceListId, isActive: before.isActive },
      after: { code, ...next },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Bảng giá

export async function listPriceLists() {
  const db = await getDb();
  const [lists, counts] = await Promise.all([
    db.select().from(priceLists).orderBy(desc(priceLists.isActive), asc(priceLists.code)),
    db.select({ id: priceListItems.priceListId, n: sql<number>`count(*)::int` }).from(priceListItems).groupBy(priceListItems.priceListId),
  ]);
  const n = new Map(counts.map((c) => [c.id, Number(c.n)]));
  return lists.map((l) => ({ ...l, itemCount: n.get(l.id) ?? 0 }));
}

export async function getPriceList(id: string) {
  const db = await getDb();
  const [list] = await db.select().from(priceLists).where(eq(priceLists.id, id));
  if (!list) return null;
  const items = await db
    .select({ id: priceListItems.id, productId: priceListItems.productId, productName: products.name, productCode: products.code, retail: products.price, unitPrice: priceListItems.unitPrice, minQty: priceListItems.minQty })
    .from(priceListItems)
    .innerJoin(products, eq(products.id, priceListItems.productId))
    .where(eq(priceListItems.priceListId, id))
    .orderBy(asc(products.name), asc(priceListItems.minQty));
  return { list, items };
}

export type PriceListInput = { code: string; name: string; kind: PriceListKind; channelCode: string | null; validFrom: string | null; validTo: string | null; priority: number; isActive: boolean; note: string | null };

async function checkPriceListInput(tx: Tx, input: PriceListInput) {
  if (!/^[A-Z0-9-]{2,30}$/.test(input.code)) throw new UserError("Mã bảng giá gồm chữ in hoa, số, gạch nối (2–30 ký tự)");
  if (!input.name.trim()) throw new UserError("Nhập tên bảng giá");
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) throw new UserError("Ngày kết thúc phải sau ngày bắt đầu");
  if (input.channelCode) {
    const [ch] = await tx.select({ code: salesChannels.code }).from(salesChannels).where(eq(salesChannels.code, input.channelCode));
    if (!ch) throw new UserError("Không tìm thấy kênh");
  }
}

export async function savePriceList(id: string | null, input: PriceListInput, actor: Actor): Promise<string> {
  assertCan(actor, "sales.pricing");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const data = { ...input, code: input.code.trim().toUpperCase(), name: input.name.trim(), note: input.note?.trim() || null };
    await checkPriceListInput(tx, data);
    const [dup] = await tx.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.code, data.code));
    if (dup && dup.id !== id) throw new UserError(`Mã bảng giá ${data.code} đã có`);
    if (!id) {
      const [row] = await tx.insert(priceLists).values(data).returning({ id: priceLists.id });
      await writeAudit(tx, { actorId: actor.id, action: "price_list.created", entity: "price_lists", entityId: row!.id, after: data });
      return row!.id;
    }
    const [before] = await tx.select().from(priceLists).where(eq(priceLists.id, id));
    if (!before) throw new UserError("Không tìm thấy bảng giá");
    await tx.update(priceLists).set({ ...data, updatedAt: new Date() }).where(eq(priceLists.id, id));
    await writeAudit(tx, { actorId: actor.id, action: "price_list.updated", entity: "price_lists", entityId: id, before: { ...before }, after: data });
    return id;
  });
}

// Thêm hoặc sửa một dòng giá (theo sản phẩm và số lượng tối thiểu). Audit price_list_item.* trước/sau (R-BH-3).
export async function upsertPriceListItem(priceListId: string, input: { productId: string; minQty: number; unitPrice: number }, actor: Actor): Promise<void> {
  assertCan(actor, "sales.pricing");
  if (!Number.isInteger(input.minQty) || input.minQty < 1) throw new UserError("Số lượng tối thiểu từ 1");
  if (!Number.isSafeInteger(input.unitPrice) || input.unitPrice < 0) throw new UserError("Đơn giá phải là số không âm");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [list] = await tx.select({ id: priceLists.id, code: priceLists.code }).from(priceLists).where(eq(priceLists.id, priceListId));
    if (!list) throw new UserError("Không tìm thấy bảng giá");
    const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, input.productId));
    if (!product) throw new UserError("Không tìm thấy sản phẩm");
    const [existing] = await tx
      .select()
      .from(priceListItems)
      .where(and(eq(priceListItems.priceListId, priceListId), eq(priceListItems.productId, input.productId), eq(priceListItems.minQty, input.minQty)));
    const snap = { priceListId, priceListCode: list.code, productId: input.productId, minQty: input.minQty };
    if (existing) {
      if (existing.unitPrice === input.unitPrice) return;
      await tx.update(priceListItems).set({ unitPrice: input.unitPrice }).where(eq(priceListItems.id, existing.id));
      await writeAudit(tx, { actorId: actor.id, action: "price_list_item.updated", entity: "price_list_items", entityId: existing.id, before: { ...snap, unitPrice: existing.unitPrice }, after: { ...snap, unitPrice: input.unitPrice } });
    } else {
      const [row] = await tx.insert(priceListItems).values({ priceListId, ...input }).returning({ id: priceListItems.id });
      await writeAudit(tx, { actorId: actor.id, action: "price_list_item.created", entity: "price_list_items", entityId: row!.id, after: { ...snap, unitPrice: input.unitPrice } });
    }
    await tx.update(priceLists).set({ updatedAt: new Date() }).where(eq(priceLists.id, priceListId));
  });
}

export async function deletePriceListItem(itemId: string, actor: Actor): Promise<string | null> {
  assertCan(actor, "sales.pricing");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(priceListItems).where(eq(priceListItems.id, itemId));
    if (!item) return null;
    const [list] = await tx.select({ code: priceLists.code }).from(priceLists).where(eq(priceLists.id, item.priceListId));
    await tx.delete(priceListItems).where(eq(priceListItems.id, itemId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "price_list_item.deleted",
      entity: "price_list_items",
      entityId: itemId,
      before: { priceListId: item.priceListId, priceListCode: list?.code, productId: item.productId, minQty: item.minQty, unitPrice: item.unitPrice },
    });
    return item.priceListId;
  });
}

// Lịch sử giá của sản phẩm từ audit_log (R-BH-3): đổi giá lẻ + dòng bảng giá
export async function getPriceHistory(productId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      or(
        and(eq(auditLog.action, "product.updated"), eq(auditLog.entityId, productId)),
        and(like(auditLog.action, "price_list_item.%"), or(sql`${auditLog.after}->>'productId' = ${productId}`, sql`${auditLog.before}->>'productId' = ${productId}`)),
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(200);
  return rows
    .map((r) => {
      const before = (r.before ?? {}) as Record<string, unknown>;
      const after = (r.after ?? {}) as Record<string, unknown>;
      if (r.action === "product.updated") {
        if (before.price === after.price) return null;
        return { id: r.id, at: r.at, actorId: r.actorId, where: "Giá lẻ", minQty: null as number | null, from: (before.price as number) ?? null, to: (after.price as number) ?? null };
      }
      const code = (after.priceListCode ?? before.priceListCode ?? "") as string;
      return {
        id: r.id,
        at: r.at,
        actorId: r.actorId,
        where: `Bảng giá ${code}`,
        minQty: ((after.minQty ?? before.minQty) as number) ?? null,
        from: r.action === "price_list_item.created" ? null : ((before.unitPrice as number) ?? null),
        to: r.action === "price_list_item.deleted" ? null : ((after.unitPrice as number) ?? null),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// Nạp bảng giá cần cho R-BH-2: bảng đại lý, bảng kênh, các bảng khuyến mãi
export async function loadPricingLists(db: Db | Tx, input: { channelCode: string; dealerPriceListId: string | null; productIds: string[] }) {
  const [channel] = await db.select({ priceListId: salesChannels.priceListId }).from(salesChannels).where(eq(salesChannels.code, input.channelCode));
  const lists = await db
    .select()
    .from(priceLists)
    .where(
      or(
        eq(priceLists.kind, "promo"),
        input.dealerPriceListId ? eq(priceLists.id, input.dealerPriceListId) : undefined,
        channel?.priceListId ? eq(priceLists.id, channel.priceListId) : undefined,
      ),
    );
  const ids = lists.map((l) => l.id);
  const items =
    ids.length && input.productIds.length
      ? await db
          .select({ priceListId: priceListItems.priceListId, productId: priceListItems.productId, unitPrice: priceListItems.unitPrice, minQty: priceListItems.minQty })
          .from(priceListItems)
          .where(and(inArray(priceListItems.priceListId, ids), inArray(priceListItems.productId, input.productIds)))
      : [];
  const toPricing = (l: typeof priceLists.$inferSelect): PriceListForPricing => ({
    id: l.id,
    kind: l.kind,
    channelCode: l.channelCode,
    validFrom: l.validFrom,
    validTo: l.validTo,
    priority: l.priority,
    isActive: l.isActive,
    items: items.filter((i) => i.priceListId === l.id),
  });
  const find = (id: string | null | undefined) => {
    const l = id ? lists.find((x) => x.id === id) : undefined;
    return l ? toPricing(l) : null;
  };
  return {
    dealerList: find(input.dealerPriceListId),
    channelList: find(channel?.priceListId),
    promoLists: lists.filter((l) => l.kind === "promo").map(toPricing),
  };
}

// ---------------------------------------------------------------------------------------------
// Combo

export async function listBundles() {
  const db = await getDb();
  const [bundles, items] = await Promise.all([
    db.select().from(productBundles).orderBy(desc(productBundles.isActive), asc(productBundles.code)),
    db
      .select({ bundleId: productBundleItems.bundleId, productId: productBundleItems.productId, qty: productBundleItems.qty, name: products.name, price: products.price })
      .from(productBundleItems)
      .innerJoin(products, eq(products.id, productBundleItems.productId)),
  ]);
  return bundles.map((b) => ({ ...b, items: items.filter((i) => i.bundleId === b.id) }));
}

export type BundleInput = { code: string; name: string; price: number; channelCode: string | null; isActive: boolean; note: string | null; items: { productId: string; qty: number }[] };

export async function saveBundle(id: string | null, input: BundleInput, actor: Actor): Promise<string> {
  assertCan(actor, "sales.pricing");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,30}$/.test(code)) throw new UserError("Mã combo gồm chữ in hoa, số, gạch nối (2–30 ký tự)");
  if (!input.name.trim()) throw new UserError("Nhập tên combo");
  if (!Number.isSafeInteger(input.price) || input.price < 0) throw new UserError("Giá combo phải là số không âm");
  const items = input.items.filter((i) => i.productId && i.qty > 0);
  if (items.length === 0) throw new UserError("Combo cần ít nhất một sản phẩm");
  if (new Set(items.map((i) => i.productId)).size !== items.length) throw new UserError("Mỗi sản phẩm chỉ ghi một dòng trong combo");
  if (items.some((i) => !Number.isInteger(i.qty))) throw new UserError("Số lượng phải là số nguyên");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: productBundles.id }).from(productBundles).where(eq(productBundles.code, code));
    if (dup && dup.id !== id) throw new UserError(`Mã combo ${code} đã có`);
    const data = { code, name: input.name.trim(), price: input.price, channelCode: input.channelCode, isActive: input.isActive, note: input.note?.trim() || null };
    let bundleId = id;
    if (!bundleId) {
      const [row] = await tx.insert(productBundles).values(data).returning({ id: productBundles.id });
      bundleId = row!.id;
    } else {
      await tx.update(productBundles).set({ ...data, updatedAt: new Date() }).where(eq(productBundles.id, bundleId));
      await tx.delete(productBundleItems).where(eq(productBundleItems.bundleId, bundleId));
    }
    await tx.insert(productBundleItems).values(items.map((i) => ({ bundleId: bundleId!, productId: i.productId, qty: i.qty })));
    await writeAudit(tx, { actorId: actor.id, action: id ? "bundle.updated" : "bundle.created", entity: "product_bundles", entityId: bundleId, after: { ...data, items } });
    return bundleId;
  });
}

// ---------------------------------------------------------------------------------------------
// Voucher

export async function listVouchers() {
  const db = await getDb();
  return db.select().from(vouchers).orderBy(desc(vouchers.isActive), asc(vouchers.code));
}

export type VoucherInput = {
  code: string;
  kind: "percent" | "amount";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  channelCode: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  usageLimit: number | null;
  isActive: boolean;
};

export async function saveVoucher(id: string | null, input: VoucherInput, actor: Actor): Promise<string> {
  assertCan(actor, "sales.pricing");
  const code = normalizeVoucherCode(input.code);
  if (!/^[A-Z0-9-]{3,30}$/.test(code)) throw new UserError("Mã giảm giá gồm chữ in hoa, số, gạch nối (3–30 ký tự)");
  if (!Number.isSafeInteger(input.value) || input.value <= 0) throw new UserError("Mức giảm phải lớn hơn 0");
  if (input.kind === "percent" && input.value > 10_000) throw new UserError("Giảm theo phần trăm tối đa 100%");
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) throw new UserError("Ngày kết thúc phải sau ngày bắt đầu");
  if (input.usageLimit !== null && (!Number.isInteger(input.usageLimit) || input.usageLimit < 1)) throw new UserError("Số lượt dùng từ 1");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: vouchers.id }).from(vouchers).where(eq(vouchers.code, code));
    if (dup && dup.id !== id) throw new UserError(`Mã ${code} đã có`);
    const data = { ...input, code };
    if (!id) {
      const [row] = await tx.insert(vouchers).values(data).returning({ id: vouchers.id });
      await writeAudit(tx, { actorId: actor.id, action: "voucher.created", entity: "vouchers", entityId: row!.id, after: { ...data } });
      return row!.id;
    }
    const [before] = await tx.select().from(vouchers).where(eq(vouchers.id, id));
    if (!before) throw new UserError("Không tìm thấy mã giảm giá");
    await tx.update(vouchers).set(data).where(eq(vouchers.id, id));
    await writeAudit(tx, { actorId: actor.id, action: "voucher.updated", entity: "vouchers", entityId: id, before: { ...before }, after: { ...data } });
    return id;
  });
}

// Voucher sắp hết lượt / hết hạn: cho cảnh báo
export async function countExpiringVouchers(db: Db, withinDays = 7): Promise<number> {
  const until = new Date(Date.now() + withinDays * 86_400_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vouchers)
    .where(and(eq(vouchers.isActive, true), lt(vouchers.validTo, until), gte(vouchers.validTo, new Date())));
  return Number(row?.n ?? 0);
}
