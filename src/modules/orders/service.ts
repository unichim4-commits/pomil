import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gte, ilike, inArray, like, notInArray, or, sql, sum } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import { consents, customers, lots, orderEvents, orderItems, orders, products, touchpoints } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { generateReferralCode } from "@/lib/referral";
import type { Utm } from "@/lib/utm";
import type { StoreSettings } from "@/modules/settings/schema";
import { lotNotPublicWarning } from "@/modules/quality/rules";
import {
  canTransition,
  formatOrderCode,
  nextLifecycleStage,
  orderCodePrefix,
  priceCart,
  restoresStock,
  type CartLine,
  type CartProblem,
  type OrderStatus,
} from "./rules";

export type PlaceOrderInput = {
  lines: CartLine[];
  recipientName: string;
  phoneE164: string;
  email: string | null;
  province: string;
  ward: string;
  addressLine: string;
  customerNote: string | null;
  paymentMethod: "cod" | "bank_transfer";
  marketingConsent: boolean;
  consentTexts: { dataProcessing: string; marketing: string };
  utm: Utm | null;
  landingVariant: string | null;
  // Khách đang đăng nhập: gắn đơn vào tài khoản để hiện trong trang Tài khoản
  accountId?: string | null;
};

export type PlaceOrderResult =
  | { ok: true; orderId: string; code: string; accessToken: string; total: number; lines: { productName: string; quantity: number }[] }
  | { ok: false; problems: CartProblem[] };

class StockConflict extends Error {}

export async function placeOrder(input: PlaceOrderInput, store: StoreSettings): Promise<PlaceOrderResult> {
  // Hai đơn cùng lúc có thể lấy trùng số thứ tự trong tháng: thử lại vài lần.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await placeOrderOnce(input, store);
    } catch (error) {
      if (error instanceof StockConflict) {
        // Tồn kho đổi giữa lúc tính giá và lúc trừ kho: tính lại để báo đúng số còn lại
        continue;
      }
      if (isUniqueViolation(error) && attempt < 2) continue;
      throw error;
    }
  }
  return placeOrderOnce(input, store);
}

async function placeOrderOnce(input: PlaceOrderInput, store: StoreSettings): Promise<PlaceOrderResult> {
  const db = await getDb();
  const policyVersion = process.env.CONSENT_POLICY_VERSION ?? "unversioned";

  return db.transaction(async (tx) => {
    const ids = input.lines.map((l) => l.productId);
    const rows = ids.length ? await tx.select().from(products).where(inArray(products.id, ids)) : [];
    const priced = priceCart(input.lines, rows, {
      maxQtyPerItem: store.maxQtyPerItem,
      shipping: { flatFee: store.shippingFlatFee, freeThreshold: store.shippingFreeThreshold },
    });
    if (!priced.ok) return priced;

    // Trừ kho có điều kiện: chỉ trừ khi còn đủ, tránh bán quá số chai thật
    for (const line of priced.lines) {
      const updated = await tx
        .update(products)
        .set({ stock: sql`${products.stock} - ${line.quantity}` })
        .where(and(eq(products.id, line.productId), gte(products.stock, line.quantity)))
        .returning({ id: products.id });
      if (updated.length === 0) throw new StockConflict();
    }

    const customerId = await upsertCustomerForOrder(tx, input);

    const [prior] = await tx
      .select({ n: count() })
      .from(orders)
      .where(and(eq(orders.customerId, customerId), notInArray(orders.status, ["cancelled"])));
    const customer = await tx.query.customers.findFirst({ where: eq(customers.id, customerId) });
    if (customer) {
      await tx
        .update(customers)
        .set({ lifecycleStage: nextLifecycleStage(customer.lifecycleStage, prior?.n ?? 0), updatedAt: new Date() })
        .where(eq(customers.id, customerId));
    }

    const now = new Date();
    const code = await nextOrderCode(tx, "WEB", now);
    const accessToken = randomBytes(18).toString("base64url");

    const [order] = await tx
      .insert(orders)
      .values({
        code,
        channel: "WEB",
        customerId,
        paymentMethod: input.paymentMethod,
        recipientName: input.recipientName,
        phoneE164: input.phoneE164,
        email: input.email,
        province: input.province,
        ward: input.ward,
        addressLine: input.addressLine,
        customerNote: input.customerNote,
        subtotal: priced.subtotal,
        shippingFee: priced.shippingFee,
        total: priced.total,
        utm: input.utm,
        accessToken,
        accountId: input.accountId ?? null,
      })
      .returning({ id: orders.id });
    const orderId = order!.id;

    await tx.insert(orderItems).values(priced.lines.map((l) => ({ orderId, ...l })));
    await tx.insert(orderEvents).values({ orderId, type: "created", toStatus: "pending", note: `Khách đặt trên website, ${input.paymentMethod === "cod" ? "thanh toán khi nhận" : "chuyển khoản"}` });

    // Đồng ý xử lý dữ liệu là bắt buộc để giao hàng; đồng ý nhận tin là tùy chọn và ô không tích sẵn.
    await tx.insert(consents).values([
      { customerId, purpose: "data_processing", channel: "any", granted: true, policyVersion, source: "checkout", evidence: { text: input.consentTexts.dataProcessing, orderCode: code } },
      { customerId, purpose: "marketing_message", channel: "any", granted: input.marketingConsent, policyVersion, source: "checkout", evidence: { text: input.consentTexts.marketing, orderCode: code } },
    ]);
    await tx.insert(touchpoints).values({ customerId, type: "order_placed", payload: { orderCode: code, total: priced.total, utm: input.utm } });
    await writeAudit(tx, { actorId: null, action: "order.created", entity: "orders", entityId: orderId, after: { code, total: priced.total } });

    return { ok: true as const, orderId, code, accessToken, total: priced.total, lines: priced.lines.map((l) => ({ productName: l.productName, quantity: l.quantity })) };
  });
}

async function upsertCustomerForOrder(tx: Tx, input: PlaceOrderInput): Promise<string> {
  const existing = await tx.query.customers.findFirst({ where: eq(customers.phoneE164, input.phoneE164) });
  if (existing) {
    await tx
      .update(customers)
      .set({ name: existing.name ?? input.recipientName, lastTouchUtm: input.utm ?? existing.lastTouchUtm, updatedAt: new Date() })
      .where(eq(customers.id, existing.id));
    return existing.id;
  }

  let referredById: string | null = null;
  if (input.utm?.ref) {
    const referrer = await tx.query.customers.findFirst({ where: eq(customers.referralCode, input.utm.ref) });
    referredById = referrer?.id ?? null;
  }
  const [row] = await tx
    .insert(customers)
    .values({
      phoneE164: input.phoneE164,
      name: input.recipientName,
      firstTouchUtm: input.utm,
      lastTouchUtm: input.utm,
      landingVariant: input.landingVariant,
      referralCode: generateReferralCode(),
      referredByCustomerId: referredById,
    })
    .returning({ id: customers.id });
  await writeAudit(tx, { actorId: null, action: "customer.created", entity: "customers", entityId: row!.id, after: { source: "checkout" } });
  return row!.id;
}

async function nextOrderCode(tx: Tx, channel: string, now: Date): Promise<string> {
  const prefix = orderCodePrefix(channel, now);
  const [last] = await tx
    .select({ code: orders.code })
    .from(orders)
    .where(like(orders.code, `${prefix}%`))
    .orderBy(desc(orders.code))
    .limit(1);
  const seq = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
  return formatOrderCode(channel, now, seq);
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// ---------- Khách xem đơn ----------

export async function getOrderForCustomer(code: string, token: string) {
  const db = await getDb();
  const order = await db.query.orders.findFirst({ where: and(eq(orders.code, code), eq(orders.accessToken, token)) });
  if (!order) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  return { order, items };
}

// Tra cứu bằng mã đơn và số điện thoại đặt hàng
export async function lookupOrder(code: string, phoneE164: string): Promise<{ code: string; token: string } | null> {
  const db = await getDb();
  const order = await db.query.orders.findFirst({ where: and(eq(orders.code, code.trim().toUpperCase()), eq(orders.phoneE164, phoneE164)) });
  return order ? { code: order.code, token: order.accessToken } : null;
}

// ---------- Quản trị ----------

export const ORDER_PAGE_SIZE = 25;

export async function listOrders(filter: { status?: OrderStatus; q?: string; page?: number }) {
  const db = await getDb();
  const q = filter.q?.trim();
  const digits = q?.replace(/\D/g, "");
  const where = and(
    filter.status ? eq(orders.status, filter.status) : undefined,
    q
      ? or(
          ilike(orders.code, `%${q}%`),
          ilike(orders.recipientName, `%${q}%`),
          digits && digits.length >= 3 ? like(orders.phoneE164, `%${digits.replace(/^0/, "")}%`) : undefined,
        )
      : undefined,
  );
  const page = Math.max(1, filter.page ?? 1);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(ORDER_PAGE_SIZE)
      .offset((page - 1) * ORDER_PAGE_SIZE),
    db.select({ n: count() }).from(orders).where(where),
  ]);
  return { rows, total: total?.n ?? 0, page };
}

export async function countOrdersByStatus(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select({ status: orders.status, n: count() }).from(orders).groupBy(orders.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function getOrderDetail(id: string) {
  const db = await getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  if (!order) return null;
  const [items, events] = await Promise.all([
    db
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        productName: orderItems.productName,
        unitPrice: orderItems.unitPrice,
        quantity: orderItems.quantity,
        lineTotal: orderItems.lineTotal,
        lotId: orderItems.lotId,
        lotNo: lots.lotNo,
        lotIsPublic: lots.isPublic,
        lotReleaseStatus: lots.releaseStatus,
      })
      .from(orderItems)
      .leftJoin(lots, eq(orderItems.lotId, lots.id))
      .where(eq(orderItems.orderId, id)),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, id)).orderBy(desc(orderEvents.at)),
  ]);
  const productIds = [...new Set(items.map((i) => i.productId))];
  const availableLots = productIds.length
    ? await db
        .select({ id: lots.id, lotNo: lots.lotNo, productId: lots.productId, isPublic: lots.isPublic })
        .from(lots)
        .where(and(inArray(lots.productId, productIds), eq(lots.releaseStatus, "released")))
        .orderBy(desc(lots.manufacturedOn))
    : [];
  return { order, items, events, availableLots };
}

export const STALE_ORDER = "Đơn vừa được người khác cập nhật, tải lại trang.";

export async function changeOrderStatus(id: string, to: OrderStatus, actorId: string, note: string | null): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const order = await tx.query.orders.findFirst({ where: eq(orders.id, id) });
    if (!order) return { ok: false, message: "Không tìm thấy đơn" };
    if (!canTransition(order.status, to)) return { ok: false, message: "Không chuyển được sang trạng thái này" };

    const now = new Date();
    const patch: Partial<typeof orders.$inferInsert> = { status: to, updatedAt: now };
    if (to === "shipping") patch.shippedAt = now;
    if (to === "delivered") {
      patch.deliveredAt = now;
      // Đơn thu tiền khi nhận: giao xong là đã thu
      if (order.paymentMethod === "cod" && order.paymentStatus === "unpaid") {
        patch.paymentStatus = "paid";
        patch.paidAt = now;
      }
    }
    if (to === "cancelled") patch.cancelReason = note;
    // Cập nhật có điều kiện: chỉ khi đơn vẫn ở trạng thái vừa đọc. Hai người bấm cùng lúc thì
    // người sau không cập nhật được dòng nào, và không cộng kho lần hai.
    const changed = await tx
      .update(orders)
      .set(patch)
      .where(and(eq(orders.id, id), eq(orders.status, order.status)))
      .returning({ id: orders.id });
    if (changed.length === 0) return { ok: false, message: STALE_ORDER };

    if (restoresStock(to)) {
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id));
      for (const item of items) {
        await tx
          .update(products)
          .set({ stock: sql`${products.stock} + ${item.quantity}` })
          .where(eq(products.id, item.productId));
      }
    }

    await tx.insert(orderEvents).values({ orderId: id, type: "status", fromStatus: order.status, toStatus: to, note, actorId });
    await writeAudit(tx, { actorId, action: "order.status", entity: "orders", entityId: id, before: { status: order.status }, after: { status: to, note } });
    return { ok: true };
  });
}

export async function setPaymentStatus(id: string, status: "unpaid" | "paid" | "refunded", actorId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const order = await tx.query.orders.findFirst({ where: eq(orders.id, id) });
    if (!order) return { ok: false, message: "Không tìm thấy đơn" };
    if (order.paymentStatus === status) return { ok: true };
    const changed = await tx
      .update(orders)
      .set({ paymentStatus: status, paidAt: status === "paid" ? new Date() : order.paidAt, updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.paymentStatus, order.paymentStatus)))
      .returning({ id: orders.id });
    if (changed.length === 0) return { ok: false, message: STALE_ORDER };
    const label = { unpaid: "chưa thanh toán", paid: "đã thanh toán", refunded: "đã hoàn tiền" } as const;
    await tx.insert(orderEvents).values({ orderId: id, type: "payment", note: `Thanh toán: ${label[order.paymentStatus]} → ${label[status]}`, actorId });
    await writeAudit(tx, { actorId, action: "order.payment", entity: "orders", entityId: id, before: { paymentStatus: order.paymentStatus }, after: { paymentStatus: status } });
    return { ok: true };
  });
}

export async function updateOrderShipping(id: string, data: { carrier: string | null; trackingNo: string | null; internalNote: string | null }, actorId: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(orders.id, id));
    await tx.insert(orderEvents).values({ orderId: id, type: "note", note: [data.carrier, data.trackingNo].filter(Boolean).join(" · ") || "Cập nhật ghi chú", actorId });
  });
}

// Gán lô cho từng dòng hàng khi đóng gói: chỉ lô đã duyệt xuất kho của đúng sản phẩm.
// Gán lô cho dòng hàng. Lô đã duyệt nhưng chưa công khai vẫn gán được, kèm cảnh báo (warning).
export async function assignLot(itemId: string, lotId: string | null, actorId: string): Promise<{ ok: boolean; message?: string; warning?: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(orderItems).where(eq(orderItems.id, itemId));
    if (!item) return { ok: false, message: "Không tìm thấy dòng hàng" };
    let warning: string | undefined;
    if (lotId) {
      const lot = await tx.query.lots.findFirst({ where: eq(lots.id, lotId) });
      if (!lot || lot.productId !== item.productId) return { ok: false, message: "Lô không thuộc sản phẩm này" };
      if (lot.releaseStatus !== "released") return { ok: false, message: "Lô chưa được duyệt xuất kho" };
      warning = lotNotPublicWarning(lot) ?? undefined;
    }
    await tx.update(orderItems).set({ lotId }).where(eq(orderItems.id, itemId));
    await writeAudit(tx, { actorId, action: "order.assign_lot", entity: "order_items", entityId: itemId, before: { lotId: item.lotId }, after: { lotId } });
    return warning ? { ok: true, warning } : { ok: true };
  });
}

// ---------- Số liệu tổng quan ----------

const REVENUE_EXCLUDED: OrderStatus[] = ["cancelled", "returned"];

export async function dashboardStats() {
  const db = await getDb();
  const now = Date.now();
  const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const since14 = new Date(now - 13 * 24 * 60 * 60 * 1000);
  // Đầu ngày theo giờ Việt Nam
  const vnNow = new Date(now + 7 * 3600 * 1000);
  const startOfToday = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate()) - 7 * 3600 * 1000);

  const revenueWhere = (since: Date) => and(gte(orders.createdAt, since), notInArray(orders.status, REVENUE_EXCLUDED));
  const [[today], [last30], daily, repeat] = await Promise.all([
    db.select({ revenue: sum(orders.total), n: count() }).from(orders).where(revenueWhere(startOfToday)),
    db.select({ revenue: sum(orders.total), n: count() }).from(orders).where(revenueWhere(since30)),
    db
      .select({
        day: sql<string>`to_char((${orders.createdAt} at time zone 'UTC') + interval '7 hours', 'YYYY-MM-DD')`,
        revenue: sum(orders.total),
        n: count(),
      })
      .from(orders)
      .where(revenueWhere(since14))
      .groupBy(sql`1`),
    db.select({ n: count() }).from(customers).where(eq(customers.lifecycleStage, "repeat_buyer")),
  ]);

  return {
    today: { revenue: Number(today?.revenue ?? 0), orders: today?.n ?? 0 },
    last30: { revenue: Number(last30?.revenue ?? 0), orders: last30?.n ?? 0 },
    daily: daily.map((d) => ({ day: d.day, revenue: Number(d.revenue ?? 0), orders: d.n })),
    repeatBuyers: repeat[0]?.n ?? 0,
  };
}

export async function recentOrders(limit = 8) {
  const db = await getDb();
  return db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);
}
