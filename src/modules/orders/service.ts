import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, inArray, like, notInArray, or, sql, sum } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { consents, customers, dealers, lots, orderEvents, orderItems, orders, products, returnRequestLines, returnRequests, salesChannels, touchpoints, vouchers } from "@/db/schema";
import { openReceivable } from "@/modules/finance/ledger";
import { issueOrderStock, receiveOrderReturn, reverseOrderStock, syncSellableStock } from "@/modules/inventory/ledger";
import { vnToday } from "@/modules/numbering";
import { assertCreditLimit } from "@/modules/sales/credit";
import { addDays } from "@/modules/sales/rules";
import { writeAudit } from "@/lib/audit";
import { generateReferralCode } from "@/lib/referral";
import type { Utm } from "@/lib/utm";
import type { StoreSettings } from "@/modules/settings/schema";
import { lotNotPublicWarning } from "@/modules/quality/rules";
import { UserError } from "@/lib/errors";
import { applyOrderPaymentStatus } from "./payment";
import {
  canTransition,
  formatOrderCode,
  isOrderPacked,
  nextLifecycleStage,
  orderCodePrefix,
  priceCart,
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
    if (await reserveProductStock(tx, priced.lines)) throw new StockConflict();

    const customerId = await upsertCustomerForOrder(tx, input);
    await bumpLifecycleStage(tx, customerId);

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

// Giữ hàng trên products.stock (R-BH-8): trừ có điều kiện từng dòng. Dùng chung cho đơn web và đơn tay.
// Trả id sản phẩm đầu tiên không đủ hàng (người gọi hủy giao dịch), hoặc null nếu đã giữ đủ.
export async function reserveProductStock(tx: Tx, lines: { productId: string; quantity: number }[]): Promise<string | null> {
  for (const line of lines) {
    const updated = await tx
      .update(products)
      .set({ stock: sql`${products.stock} - ${line.quantity}` })
      .where(and(eq(products.id, line.productId), gte(products.stock, line.quantity)))
      .returning({ id: products.id });
    if (updated.length === 0) return line.productId;
  }
  return null;
}

// Giai đoạn khách sau khi có thêm một đơn (gọi trước khi chèn đơn mới)
export async function bumpLifecycleStage(tx: Tx, customerId: string): Promise<void> {
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
}

async function upsertCustomerForOrder(tx: Tx, input: PlaceOrderInput): Promise<string> {
  return upsertCustomerByPhone(tx, { phoneE164: input.phoneE164, name: input.recipientName, utm: input.utm, landingVariant: input.landingVariant }, "checkout");
}

// Gom khách theo số điện thoại (đơn web và đơn tay)
export async function upsertCustomerByPhone(
  tx: Tx,
  input: { phoneE164: string; name: string; utm: Utm | null; landingVariant: string | null },
  source: "checkout" | "admin",
  actorId: string | null = null,
): Promise<string> {
  const existing = await tx.query.customers.findFirst({ where: eq(customers.phoneE164, input.phoneE164) });
  if (existing) {
    await tx
      .update(customers)
      .set({ name: existing.name ?? input.name, lastTouchUtm: input.utm ?? existing.lastTouchUtm, updatedAt: new Date() })
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
      name: input.name,
      firstTouchUtm: input.utm,
      lastTouchUtm: input.utm,
      landingVariant: input.landingVariant,
      referralCode: generateReferralCode(),
      referredByCustomerId: referredById,
    })
    .returning({ id: customers.id });
  await writeAudit(tx, { actorId, action: "customer.created", entity: "customers", entityId: row!.id, after: { source } });
  return row!.id;
}

export async function nextOrderCode(tx: Tx, channel: string, now: Date): Promise<string> {
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

export function isUniqueViolation(error: unknown): boolean {
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

export async function listOrders(filter: {
  status?: OrderStatus;
  q?: string;
  page?: number;
  channel?: string;
  dealerId?: string;
  paymentStatus?: "unpaid" | "paid" | "refunded";
}) {
  const db = await getDb();
  const q = filter.q?.trim();
  const digits = q?.replace(/\D/g, "");
  const where = and(
    filter.status ? eq(orders.status, filter.status) : undefined,
    filter.channel ? eq(orders.channel, filter.channel) : undefined,
    filter.dealerId ? eq(orders.dealerId, filter.dealerId) : undefined,
    filter.paymentStatus ? eq(orders.paymentStatus, filter.paymentStatus) : undefined,
    q
      ? or(
          ilike(orders.code, `%${q}%`),
          ilike(orders.recipientName, `%${q}%`),
          ilike(orders.externalRef, `%${q}%`),
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
        splitFromId: orderItems.splitFromId,
        lotNo: lots.lotNo,
        lotIsPublic: lots.isPublic,
        lotReleaseStatus: lots.releaseStatus,
        trackInventory: products.trackInventory,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .leftJoin(lots, eq(orderItems.lotId, lots.id))
      .where(eq(orderItems.orderId, id))
      .orderBy(asc(orderItems.productName), asc(orderItems.id)),
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
export const TRACKED_ASSIGN_LOT = "Sản phẩm này quản lý theo kho: bấm Xuất kho để hệ thống chọn lô theo hạn dùng";

// Lỗi trong giao dịch đổi trạng thái: ném để hủy mọi thứ đã ghi (kho, tiền, công nợ), người gọi đổi thành { ok: false }
class TransitionAbort extends Error {}
function abort(message: string): never {
  throw new TransitionAbort(message);
}

export type ReturnLineChoice = { orderItemId: string; disposition: "restock" | "quarantine" };
export type TransitionOptions = {
  // Hoàn về (→ returned): cách xử lý từng dòng; thiếu dòng nào thì coi là restock (R-BH-16)
  returnLines?: ReturnLineChoice[];
  // Giao tại chỗ: đã thu tiền ngay (cash, bank_transfer) → phiếu thu
  paidNow?: boolean;
};

type Result = { ok: true } | { ok: false; message: string };

async function runTransition(fn: (tx: Tx) => Promise<void>): Promise<Result> {
  const db = await getDb();
  try {
    await db.transaction(fn);
    return { ok: true };
  } catch (error) {
    if (error instanceof TransitionAbort || error instanceof UserError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function changeOrderStatus(id: string, to: OrderStatus, actorId: string, note: string | null, opts: TransitionOptions = {}): Promise<Result> {
  return runTransition((tx) => transitionOrderInTx(tx, id, to, actorId, note, opts));
}

type ItemWithTrack = typeof orderItems.$inferSelect & { track: boolean };

async function loadItems(tx: Tx, orderId: string): Promise<ItemWithTrack[]> {
  const rows = await tx
    .select({ item: orderItems, track: products.trackInventory })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId));
  return rows.map((r) => ({ ...r.item, track: r.track }));
}

// Một bước chuyển trạng thái trong giao dịch của người gọi (R-BH-14…R-BH-17). Lỗi → ném, cả giao dịch hủy.
export async function transitionOrderInTx(tx: Tx, id: string, to: OrderStatus, actorId: string, note: string | null, opts: TransitionOptions = {}): Promise<void> {
  const order = await tx.query.orders.findFirst({ where: eq(orders.id, id) });
  if (!order) abort("Không tìm thấy đơn");
  if (!canTransition(order.status, to)) abort("Không chuyển được sang trạng thái này");
  const items = await loadItems(tx, id);
  const tracked = items.filter((i) => i.track);

  // R-BH-9: kiểm hạn mức lúc xác nhận đơn credit
  if (to === "confirmed" && order.paymentMethod === "credit" && order.dealerId) await assertCreditLimit(tx, order.dealerId, order.total, order.id);

  // R-BH-14: chuyển đang giao mà chưa xuất kho → xuất FEFO trước (cùng giao dịch)
  if (to === "shipping" && tracked.length > 0 && !order.stockIssuedAt) {
    const issued = await issueOrderStock(tx, id, {}, actorId);
    if (!issued.ok) abort(issued.message);
  }

  const now = new Date();
  const patch: Partial<typeof orders.$inferInsert> = { status: to, updatedAt: now };
  if (to === "shipping") patch.shippedAt = now;
  if (to === "delivered") patch.deliveredAt = now;
  if (to === "cancelled") patch.cancelReason = note;
  if (to === "returned") patch.returnType = order.status === "shipping" ? "delivery_failed" : "customer_return";
  // Cập nhật có điều kiện: chỉ khi đơn vẫn ở trạng thái vừa đọc. Hai người bấm cùng lúc thì
  // người sau không cập nhật được dòng nào, và không cộng kho lần hai.
  const changed = await tx
    .update(orders)
    .set(patch)
    .where(and(eq(orders.id, id), eq(orders.status, order.status)))
    .returning({ id: orders.id });
  if (changed.length === 0) abort(STALE_ORDER);

  if (to === "cancelled") await restockOnCancel(tx, order, items, actorId);
  if (to === "returned") await restockOnReturn(tx, order, items, opts.returnLines ?? [], actorId);

  await tx.insert(orderEvents).values({ orderId: id, type: "status", fromStatus: order.status, toStatus: to, note, actorId });
  await writeAudit(tx, { actorId, action: "order.status", entity: "orders", entityId: id, before: { status: order.status }, after: { status: to, note } });

  if (to === "delivered") await settleOnDelivery(tx, order, actorId, opts.paidNow ?? false);
}

// R-BH-15: hủy trước khi giao
async function restockOnCancel(tx: Tx, order: typeof orders.$inferSelect, items: ItemWithTrack[], actorId: string) {
  for (const item of items.filter((i) => !i.track)) {
    await tx
      .update(products)
      .set({ stock: sql`${products.stock} + ${item.quantity}` })
      .where(eq(products.id, item.productId));
  }
  const trackedProducts = [...new Set(items.filter((i) => i.track).map((i) => i.productId))].sort();
  if (trackedProducts.length) {
    // reverseOrderStock tự đồng bộ số bán được; chưa xuất thì chỉ đồng bộ (đơn hủy không còn "đã giữ")
    if (order.stockIssuedAt) await reverseOrderStock(tx, order.id, actorId);
    else for (const pid of trackedProducts) await syncSellableStock(tx, pid);
  }
  if (order.voucherCode) {
    await tx
      .update(vouchers)
      .set({ usedCount: sql`${vouchers.usedCount} - 1` })
      .where(and(eq(vouchers.code, order.voucherCode), sql`${vouchers.usedCount} > 0`));
  }
}

// R-BH-16: hoàn về; dòng chưa bật quản lý kho cộng stock kiểu cũ khi restock
async function restockOnReturn(tx: Tx, order: typeof orders.$inferSelect, items: ItemWithTrack[], choices: ReturnLineChoice[], actorId: string) {
  const choiceOf = (itemId: string) => choices.find((c) => c.orderItemId === itemId)?.disposition ?? "restock";
  // Trừ phần đã nhận qua đổi trả (đã nhập kho) để không nhập hai lần
  const already = await returnedViaRequests(tx, order.id);
  const lines: { orderItemId: string; qty: number; disposition: "restock" | "quarantine" }[] = [];
  for (const item of items) {
    const qty = item.quantity - (already.get(item.id) ?? 0);
    if (qty <= 0) continue;
    const disposition = choiceOf(item.id);
    if (!item.track) {
      if (disposition === "restock") {
        await tx
          .update(products)
          .set({ stock: sql`${products.stock} + ${qty}` })
          .where(eq(products.id, item.productId));
      }
      continue;
    }
    lines.push({ orderItemId: item.id, qty, disposition });
  }
  if (lines.length && order.stockIssuedAt) {
    await receiveOrderReturn(tx, { orderId: order.id, source: { type: "order", id: order.id, code: order.code }, lines }, actorId);
  } else {
    for (const pid of [...new Set(items.filter((i) => i.track).map((i) => i.productId))].sort()) await syncSellableStock(tx, pid);
  }
}

// Số đã nhận về kho qua đổi trả (mặc định received/completed) theo dòng đơn
export async function returnedViaRequests(
  db: Db | Tx,
  orderId: string,
  statuses: ("requested" | "approved" | "received" | "completed")[] = ["received", "completed"],
): Promise<Map<string, number>> {
  const rows = await db
    .select({ orderItemId: returnRequestLines.orderItemId, qty: sql<number>`coalesce(sum(${returnRequestLines.qty}), 0)::int` })
    .from(returnRequestLines)
    .innerJoin(returnRequests, eq(returnRequests.id, returnRequestLines.returnId))
    .where(and(eq(returnRequests.orderId, orderId), inArray(returnRequests.status, statuses)))
    .groupBy(returnRequestLines.orderItemId);
  return new Map(rows.map((r) => [r.orderItemId, Number(r.qty)]));
}

// R-BH-17: giao thành công → thu tiền hoặc ghi công nợ
async function settleOnDelivery(tx: Tx, order: typeof orders.$inferSelect, actorId: string, paidNow: boolean) {
  const today = vnToday();
  if (order.paymentMethod === "cod" && order.paymentStatus === "unpaid") {
    const r = await applyOrderPaymentStatus(tx, order.id, "paid", actorId, { source: "cod_delivery" });
    if (!r.ok) abort(r.message);
  } else if (order.paymentMethod === "credit") {
    if (!order.dealerId) abort("Đơn công nợ chưa gắn đại lý");
    const [dealer] = await tx.select().from(dealers).where(eq(dealers.id, order.dealerId));
    if (!dealer) abort("Không tìm thấy đại lý");
    if (order.total > 0) {
      await openReceivable(
        tx,
        { party: "dealer", dealerId: dealer.id, customerId: order.customerId, orderId: order.id, amount: order.total, issuedOn: today, dueOn: addDays(today, dealer.paymentTermsDays), note: `Đơn ${order.code}` },
        actorId,
      );
    }
  } else if (order.paymentMethod === "platform") {
    const [channel] = await tx.select().from(salesChannels).where(eq(salesChannels.code, order.channel));
    const amount = order.total - order.platformFee;
    if (amount > 0) {
      await openReceivable(
        tx,
        { party: "channel", channelCode: order.channel, customerId: order.customerId, orderId: order.id, amount, issuedOn: today, dueOn: addDays(today, channel?.payoutDays ?? 0), note: `Đơn ${order.code}` },
        actorId,
      );
    }
  } else if (paidNow && order.paymentStatus === "unpaid") {
    const r = await applyOrderPaymentStatus(tx, order.id, "paid", actorId, { source: "staff" });
    if (!r.ok) abort(r.message);
  }
}

export type PackInput = { checkedItemIds: string[]; picks?: { orderItemId: string; stockLotId: string; qty: number }[] };

// R-BH-13: xuất kho và đóng gói một đơn. checkedItemIds: các dòng đã tích kiểm (phải đủ mọi dòng).
export async function packOrder(id: string, input: PackInput, actorId: string): Promise<Result> {
  return runTransition((tx) => packOrderInTx(tx, id, input, actorId));
}

export async function packOrderInTx(tx: Tx, id: string, input: PackInput, actorId: string): Promise<void> {
  // Khóa dòng đơn: hai lần bấm cùng lúc chạy lần lượt, lần sau thấy đơn đã gói (AC-TICHHOP-17)
  const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  if (!order) abort("Không tìm thấy đơn");
  if (order.status !== "confirmed" && order.status !== "packing") abort("Chỉ đóng gói đơn đã xác nhận hoặc đang đóng gói");
  const [packedEvent] = await tx
    .select({ id: orderEvents.id })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, id), eq(orderEvents.type, "packed")))
    .limit(1);
  if (isOrderPacked({ status: order.status, stockIssuedAt: order.stockIssuedAt, hasPackedEvent: !!packedEvent })) abort(STALE_ORDER);
  const items = await loadItems(tx, id);
  const checked = new Set(input.checkedItemIds);
  if (items.some((i) => !checked.has(i.id))) abort("Tích “Đã kiểm đúng sản phẩm và số lượng” cho mọi dòng trước khi xuất kho");
  const tracked = items.filter((i) => i.track);
  let issuedNote = "";
  if (tracked.length > 0 && !order.stockIssuedAt) {
    const issued = await issueOrderStock(tx, id, { picks: input.picks?.length ? input.picks : undefined }, actorId);
    if (!issued.ok) abort(issued.message);
    issuedNote = ` · xuất ${issued.lines.reduce((s, l) => s + l.qty, 0)} chai`;
  }
  if (order.status === "confirmed") {
    const changed = await tx
      .update(orders)
      .set({ status: "packing", updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.status, "confirmed")))
      .returning({ id: orders.id });
    if (changed.length === 0) abort(STALE_ORDER);
    await writeAudit(tx, { actorId, action: "order.status", entity: "orders", entityId: id, before: { status: "confirmed" }, after: { status: "packing" } });
  }
  await tx.insert(orderEvents).values({ orderId: id, type: "packed", fromStatus: order.status, toStatus: "packing", note: `Đã kiểm và đóng gói${issuedNote}`, actorId });
}

// R-BH-14: kênh direct "Giao tại chỗ": xuất kho → packing → shipping → delivered trong một giao dịch
export async function deliverOnSpot(id: string, actorId: string, opts: { paidNow: boolean }): Promise<Result> {
  return runTransition(async (tx) => {
    const order = await tx.query.orders.findFirst({ where: eq(orders.id, id) });
    if (!order) abort("Không tìm thấy đơn");
    const [channel] = await tx.select().from(salesChannels).where(eq(salesChannels.code, order.channel));
    if (channel?.kind !== "direct") abort("Chỉ đơn bán trực tiếp mới giao tại chỗ");
    if (order.status === "pending") await transitionOrderInTx(tx, id, "confirmed", actorId, "Giao tại chỗ");
    const fresh = (await tx.query.orders.findFirst({ where: eq(orders.id, id) }))!;
    if (fresh.status === "confirmed") {
      const items = await loadItems(tx, id);
      await packOrderInTx(tx, id, { checkedItemIds: items.map((i) => i.id) }, actorId);
    } else if (fresh.status !== "packing") abort("Đơn đã qua bước giao, không giao tại chỗ được");
    await transitionOrderInTx(tx, id, "shipping", actorId, "Giao tại chỗ");
    await transitionOrderInTx(tx, id, "delivered", actorId, "Giao tại chỗ", { paidNow: opts.paidNow });
  });
}

// R-BH-16: giao thất bại, đơn vẫn shipping
export async function recordDeliveryFailed(id: string, reason: string, actorId: string): Promise<Result> {
  if (!reason.trim()) return { ok: false, message: "Ghi lý do giao thất bại" };
  return runTransition(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
    if (!order) abort("Không tìm thấy đơn");
    if (order.status !== "shipping") abort("Chỉ ghi giao thất bại cho đơn đang giao");
    await tx.insert(orderEvents).values({ orderId: id, type: "delivery_failed", note: `Giao thất bại: ${reason.trim()}`, actorId });
    await writeAudit(tx, { actorId, action: "order.delivery_failed", entity: "orders", entityId: id, after: { reason: reason.trim() } });
  });
}

export async function setPaymentStatus(
  id: string,
  status: "unpaid" | "paid" | "refunded",
  actorId: string,
  reason?: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Ghi trạng thái và phiếu thu chi qua applyOrderPaymentStatus (R-BH-18). Lỗi nghiệp vụ (UserError) làm hủy cả giao dịch.
  const db = await getDb();
  try {
    return await db.transaction(async (tx) => {
      const order = await tx.query.orders.findFirst({ where: eq(orders.id, id) });
      if (!order) return { ok: false, message: "Không tìm thấy đơn" };
      if (order.paymentStatus === status) return { ok: true };
      const result = await applyOrderPaymentStatus(tx, id, status, actorId, { source: "staff", expectedFrom: order.paymentStatus });
      if (result.ok && reason?.trim()) await tx.insert(orderEvents).values({ orderId: id, type: "note", note: `Lý do đổi thanh toán: ${reason.trim()}`, actorId });
      return result.ok ? { ok: true } : result;
    });
  } catch (error) {
    if (error instanceof UserError) return { ok: false, message: error.message };
    throw error;
  }
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

// Gán lô cho dòng hàng. Lô đã duyệt nhưng chưa công khai vẫn gán được, kèm cảnh báo (warning).
// Sản phẩm đã bật quản lý kho: lô do xuất kho FEFO đặt, không gán tay (R-BH-13).
export async function assignLot(itemId: string, lotId: string | null, actorId: string): Promise<{ ok: boolean; message?: string; warning?: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(orderItems).where(eq(orderItems.id, itemId));
    if (!item) return { ok: false, message: "Không tìm thấy dòng hàng" };
    const [product] = await tx.select({ track: products.trackInventory }).from(products).where(eq(products.id, item.productId));
    if (product?.track) return { ok: false, message: TRACKED_ASSIGN_LOT };
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
