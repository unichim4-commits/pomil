import "server-only";
// Đơn tay mọi kênh trừ WEB (R-BH-1…R-BH-10, R-BH-31, R-BH-33) và đơn đổi hàng (R-BH-24).
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import { consents, dealers, orderEvents, orderItems, orders, productBundleItems, productBundles, products, salesChannels, settings, touchpoints, vouchers } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { normalizeVnPhone } from "@/lib/phone";
import { adjustDebtAmount, findDebtBySource } from "@/modules/finance/ledger";
import { vnToday } from "@/modules/numbering";
import { bumpLifecycleStage, isUniqueViolation, nextOrderCode, reserveProductStock, upsertCustomerByPhone } from "@/modules/orders/service";
import { ERP_SETTINGS_KEY, parseErpSettings } from "@/modules/settings/erp-schema";
import { assertCan, type Actor } from "./access";
import { loadPricingLists } from "./catalog";
import { assertCreditLimit } from "./credit";
import {
  bundleDiscount,
  computeDiscounts,
  dealerOrderProblem,
  duplicateExternalRefMessage,
  manualDiscountNeedsPricing,
  manualOrderProblem,
  normalizeVoucherCode,
  platformFeeChangeProblem,
  resolveUnitPrice,
  suggestedPlatformFee,
  voucherProblem,
  type ChannelKind,
  type DiscountBreakdown,
  type PaymentMethod,
} from "./rules";

export type ManualOrderInput = {
  channelCode: string;
  dealerId: string | null;
  recipientName: string;
  phone: string | null;
  email: string | null;
  province: string;
  ward: string;
  addressLine: string;
  customerNote: string | null;
  internalNote: string | null;
  lines: { productId: string; qty: number; unitPrice?: number | null }[];
  bundles: { bundleId: string; qty: number }[];
  voucherCode: string | null;
  manualDiscount: number;
  shippingFee: number;
  // null → gợi ý theo phí kênh (R-BH-1)
  platformFee: number | null;
  externalRef: string | null;
  paymentMethod: PaymentMethod;
  consentConfirmed: boolean;
  confirmNow: boolean;
  priceOverrideReason: string | null;
};

export type PricedLine = { productId: string; productName: string; unitPrice: number; quantity: number; lineTotal: number; listPrice: number; overridden: boolean };

export type PricedManualOrder = {
  channel: typeof salesChannels.$inferSelect;
  dealer: typeof dealers.$inferSelect | null;
  phoneE164: string | null;
  lines: PricedLine[];
  subtotal: number;
  breakdown: DiscountBreakdown;
  voucher: typeof vouchers.$inferSelect | null;
  platformFee: number;
  priceListId: string | null;
};

const MAX_LINE_QTY = 9999;

async function readErpSettings(tx: Tx) {
  const [row] = await tx.select().from(settings).where(eq(settings.key, ERP_SETTINGS_KEY));
  return parseErpSettings(row?.value);
}

// Tính giá đơn tay trên máy chủ (không ghi gì). Lỗi nghiệp vụ → UserError.
export async function priceManualOrderInTx(tx: Tx, input: ManualOrderInput, actor: Actor, now = new Date()): Promise<PricedManualOrder> {
  const [channel] = await tx.select().from(salesChannels).where(eq(salesChannels.code, input.channelCode));
  const phoneRaw = input.phone?.trim() || null;
  const phoneE164 = phoneRaw ? normalizeVnPhone(phoneRaw) : null;
  if (phoneRaw && !phoneE164) throw new UserError("Số điện thoại không hợp lệ");
  const externalRef = input.externalRef?.trim() || null;
  const hasAddress = !!(input.addressLine.trim() && input.province.trim());
  const problem = manualOrderProblem({
    channel: channel ? { code: channel.code, kind: channel.kind as ChannelKind, isActive: channel.isActive } : null,
    paymentMethod: input.paymentMethod,
    phoneE164,
    hasAddress,
    externalRef,
    dealerId: input.dealerId,
    consentConfirmed: input.consentConfirmed,
  });
  if (problem) throw new UserError(problem);
  if (!input.recipientName.trim() && channel!.kind !== "direct") throw new UserError("Nhập tên người nhận");

  let dealer: typeof dealers.$inferSelect | null = null;
  if (channel!.kind === "dealer" && input.dealerId) {
    dealer = (await tx.select().from(dealers).where(eq(dealers.id, input.dealerId)))[0] ?? null;
    if (!dealer) throw new UserError("Không tìm thấy đại lý");
    const dp = dealerOrderProblem({ status: dealer.status, contractEnd: dealer.contractEnd, name: dealer.name }, vnToday(now));
    if (dp) throw new UserError(dp);
  }

  // Gộp số lượng theo sản phẩm (dòng lẻ + thành phần combo) để tính giá theo bậc số lượng
  const bundleIds = input.bundles.filter((b) => b.qty > 0).map((b) => b.bundleId);
  const bundleRows = bundleIds.length ? await tx.select().from(productBundles).where(inArray(productBundles.id, bundleIds)) : [];
  const bundleItems = bundleIds.length ? await tx.select().from(productBundleItems).where(inArray(productBundleItems.bundleId, bundleIds)) : [];
  const qtyBy = new Map<string, number>();
  const add = (pid: string, q: number) => qtyBy.set(pid, (qtyBy.get(pid) ?? 0) + q);
  for (const l of input.lines) {
    if (!l.productId) continue;
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_LINE_QTY) throw new UserError("Số lượng mỗi dòng là số nguyên từ 1");
    add(l.productId, l.qty);
  }
  for (const b of input.bundles) {
    if (b.qty <= 0) continue;
    if (!Number.isInteger(b.qty)) throw new UserError("Số combo phải là số nguyên");
    const row = bundleRows.find((x) => x.id === b.bundleId);
    if (!row || !row.isActive) throw new UserError("Combo không còn bán");
    if (row.channelCode && row.channelCode !== channel!.code) throw new UserError(`Combo ${row.name} không dùng cho kênh này`);
    for (const it of bundleItems.filter((x) => x.bundleId === b.bundleId)) add(it.productId, it.qty * b.qty);
  }
  if (qtyBy.size === 0) throw new UserError("Đơn chưa có sản phẩm");

  const productIds = [...qtyBy.keys()];
  const productRows = await tx.select().from(products).where(inArray(products.id, productIds));
  const lists = await loadPricingLists(tx, { channelCode: channel!.code, dealerPriceListId: dealer?.priceListId ?? null, productIds });
  const today = vnToday(now);
  let priceListId: string | null = null;
  const lines: PricedLine[] = [];
  const overrides: string[] = [];
  for (const pid of productIds) {
    const p = productRows.find((x) => x.id === pid);
    if (!p || p.status !== "active") throw new UserError(`${p?.name ?? "Một sản phẩm"} hiện không bán`);
    const qty = qtyBy.get(pid)!;
    const resolved = resolveUnitPrice({ productId: pid, qty, retailPrice: p.price, channelCode: channel!.code, today, ...lists });
    if (resolved.priceListId && !priceListId) priceListId = resolved.priceListId;
    const given = input.lines.find((l) => l.productId === pid && l.unitPrice !== undefined && l.unitPrice !== null)?.unitPrice;
    let unitPrice = resolved.unitPrice;
    let overridden = false;
    if (given !== undefined && given !== null && given !== resolved.unitPrice) {
      if (!Number.isSafeInteger(given) || given < 0) throw new UserError("Đơn giá phải là số không âm");
      assertCan(actor, "sales.pricing", "Sửa đơn giá trên đơn cần quyền giá (chủ cửa hàng)");
      if (!input.priceOverrideReason?.trim()) throw new UserError("Ghi lý do sửa đơn giá");
      unitPrice = given;
      overridden = true;
      overrides.push(p.name);
    }
    lines.push({ productId: pid, productName: p.name, unitPrice, quantity: qty, lineTotal: unitPrice * qty, listPrice: resolved.unitPrice, overridden });
  }
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

  let comboDiscount = 0;
  for (const b of input.bundles) {
    if (b.qty <= 0) continue;
    const row = bundleRows.find((x) => x.id === b.bundleId)!;
    const comps = bundleItems.filter((x) => x.bundleId === b.bundleId).reduce((s, it) => s + (lines.find((l) => l.productId === it.productId)?.unitPrice ?? 0) * it.qty * b.qty, 0);
    comboDiscount += bundleDiscount(comps, row.price * b.qty);
  }

  const shippingFee = Math.max(0, Math.round(input.shippingFee));
  const manual = Math.max(0, Math.round(input.manualDiscount));
  if (!Number.isSafeInteger(manual)) throw new UserError("Chiết khấu không hợp lệ");
  const base = { subtotal, comboDiscount, dealerBp: dealer?.discountBp ?? 0, manualDiscount: manual, shippingFee };

  let voucher: typeof vouchers.$inferSelect | null = null;
  const vcode = input.voucherCode ? normalizeVoucherCode(input.voucherCode) : "";
  if (vcode) {
    voucher = (await tx.select().from(vouchers).where(eq(vouchers.code, vcode)))[0] ?? null;
    if (!voucher) throw new UserError("Không tìm thấy mã giảm giá");
    const pre = computeDiscounts({ ...base, voucher: null });
    const vp = voucherProblem(voucher, { channelCode: channel!.code, base: pre.voucherBase, now });
    if (vp) throw new UserError(vp);
  }
  const erp = await readErpSettings(tx);
  if (manualDiscountNeedsPricing(manual, subtotal, erp.manualDiscountMaxBp)) {
    assertCan(actor, "sales.pricing", `Chiết khấu tay trên ${erp.manualDiscountMaxBp / 100}% tạm tính cần quyền giá (chủ cửa hàng)`);
  }
  const breakdown = computeDiscounts({ ...base, voucher });

  let platformFee = 0;
  if (channel!.kind === "marketplace") {
    platformFee = input.platformFee ?? suggestedPlatformFee(subtotal, breakdown.discountTotal, channel!.feeRateBp);
    if (!Number.isSafeInteger(platformFee) || platformFee < 0) throw new UserError("Phí nền tảng phải là số không âm");
  }
  void overrides;
  return { channel: channel!, dealer, phoneE164, lines, subtotal, breakdown, voucher, platformFee, priceListId };
}

// Xem trước giá (nút "Tính thử" của form)
export async function quoteManualOrder(input: ManualOrderInput, actor: Actor): Promise<{ ok: true; priced: PricedManualOrder } | { ok: false; message: string }> {
  const db = await getDb();
  try {
    const priced = await db.transaction((tx) => priceManualOrderInTx(tx, input, actor));
    return { ok: true, priced };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, message: error.message };
    throw error;
  }
}

async function stockMessage(tx: Tx, productId: string): Promise<string> {
  const [p] = await tx.select({ name: products.name, stock: products.stock }).from(products).where(eq(products.id, productId));
  if (!p) return "Sản phẩm không còn";
  return p.stock <= 0 ? `${p.name} đã hết hàng` : `${p.name} chỉ còn ${p.stock} chai`;
}

export type CreateManualOrderResult = { ok: true; orderId: string; code: string; total: number } | { ok: false; message: string };

// R-BH-7: tạo đơn tay. Giữ hàng, voucher, hạn mức đều trong một giao dịch.
export async function createManualOrder(input: ManualOrderInput, actor: Actor): Promise<CreateManualOrderResult> {
  assertCan(actor, "sales.write");
  const db = await getDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction((tx) => createManualOrderInTx(tx, input, actor));
    } catch (error) {
      if (error instanceof UserError) return { ok: false, message: error.message };
      if (isUniqueViolation(error)) {
        if (String((error as { message?: string; cause?: { message?: string } }).message ?? "").includes("external_ref") || String((error as { cause?: { message?: string } }).cause?.message ?? "").includes("external_ref")) {
          const dup = await findExternalRef(input.channelCode, input.externalRef?.trim() ?? "");
          return { ok: false, message: duplicateExternalRefMessage(input.externalRef?.trim() ?? "", dup ?? "") };
        }
        if (attempt < 2) continue;
      }
      throw error;
    }
  }
  return { ok: false, message: "Không tạo được đơn, thử lại" };
}

async function findExternalRef(channel: string, ref: string): Promise<string | null> {
  if (!ref) return null;
  const db = await getDb();
  const [o] = await db.select({ code: orders.code }).from(orders).where(and(eq(orders.channel, channel), eq(orders.externalRef, ref)));
  return o?.code ?? null;
}

async function createManualOrderInTx(tx: Tx, input: ManualOrderInput, actor: Actor): Promise<CreateManualOrderResult> {
  const now = new Date();
  const priced = await priceManualOrderInTx(tx, input, actor, now);
  const { channel, dealer, breakdown } = priced;
  const externalRef = input.externalRef?.trim() || null;

  // R-BH-31: đơn sàn không trùng
  if (externalRef) {
    const [dup] = await tx.select({ code: orders.code }).from(orders).where(and(eq(orders.channel, channel.code), eq(orders.externalRef, externalRef)));
    if (dup) throw new UserError(duplicateExternalRefMessage(externalRef, dup.code));
  }
  // R-BH-9: hạn mức công nợ
  if (input.paymentMethod === "credit" && dealer) await assertCreditLimit(tx, dealer.id, breakdown.total);

  // R-BH-5: tăng lượt dùng có điều kiện
  if (priced.voucher) {
    const used = await tx
      .update(vouchers)
      .set({ usedCount: sql`${vouchers.usedCount} + 1` })
      .where(and(eq(vouchers.id, priced.voucher.id), sql`(${vouchers.usageLimit} is null or ${vouchers.usedCount} < ${vouchers.usageLimit})`))
      .returning({ id: vouchers.id });
    if (used.length === 0) throw new UserError("Mã đã dùng hết lượt");
  }

  // R-BH-8: giữ hàng như đơn web
  const short = await reserveProductStock(
    tx,
    priced.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
  );
  if (short) throw new UserError(await stockMessage(tx, short));

  // Khách: đại lý → liên hệ chính của đại lý; có số điện thoại → gom theo số
  let customerId: string | null = dealer?.customerId ?? null;
  if (!customerId && priced.phoneE164) {
    customerId = await upsertCustomerByPhone(tx, { phoneE164: priced.phoneE164, name: input.recipientName.trim(), utm: null, landingVariant: null }, "admin", actor.id);
  }
  if (customerId) await bumpLifecycleStage(tx, customerId);

  const code = await nextOrderCode(tx, channel.code, now);
  const status = input.confirmNow ? "confirmed" : "pending";
  const [order] = await tx
    .insert(orders)
    .values({
      code,
      channel: channel.code,
      customerId,
      status,
      paymentMethod: input.paymentMethod,
      recipientName: input.recipientName.trim() || dealer?.name || "Khách mua tại chỗ",
      phoneE164: priced.phoneE164 ?? "",
      email: input.email?.trim() || null,
      province: input.province.trim(),
      ward: input.ward.trim(),
      addressLine: input.addressLine.trim(),
      customerNote: input.customerNote?.trim() || null,
      internalNote: input.internalNote?.trim() || null,
      subtotal: priced.subtotal,
      discountTotal: breakdown.discountTotal,
      shippingFee: Math.max(0, Math.round(input.shippingFee)),
      total: breakdown.total,
      voucherCode: priced.voucher?.code ?? null,
      platformFee: priced.platformFee,
      dealerId: dealer?.id ?? null,
      priceListId: priced.priceListId,
      externalRef,
      createdBy: actor.id,
      utm: null,
      accountId: null,
      accessToken: randomBytes(18).toString("base64url"),
    })
    .returning({ id: orders.id });
  const orderId = order!.id;
  await tx.insert(orderItems).values(priced.lines.map((l) => ({ orderId, productId: l.productId, productName: l.productName, unitPrice: l.unitPrice, quantity: l.quantity, lineTotal: l.lineTotal })));

  const parts = [
    breakdown.combo ? `combo −${breakdown.combo}` : "",
    breakdown.dealer ? `chiết khấu đại lý −${breakdown.dealer}` : "",
    breakdown.voucher ? `mã ${priced.voucher?.code} −${breakdown.voucher}` : "",
    breakdown.manual ? `chiết khấu tay −${breakdown.manual}` : "",
  ].filter(Boolean);
  await tx.insert(orderEvents).values({ orderId, type: "created", toStatus: "pending", note: `Đơn tay kênh ${channel.name}${parts.length ? ` (${parts.join(", ")})` : ""}`, actorId: actor.id });
  const overridden = priced.lines.filter((l) => l.overridden);
  if (overridden.length) {
    await tx.insert(orderEvents).values({
      orderId,
      type: "price_override",
      note: `Sửa đơn giá: ${overridden.map((l) => `${l.productName} ${l.listPrice} → ${l.unitPrice}`).join("; ")}. Lý do: ${input.priceOverrideReason?.trim()}`,
      actorId: actor.id,
    });
  }
  if (status === "confirmed") await tx.insert(orderEvents).values({ orderId, type: "status", fromStatus: "pending", toStatus: "confirmed", note: "Xác nhận ngay khi tạo", actorId: actor.id });

  // R-BH-7: ô đồng ý dữ liệu (kênh social/direct có số điện thoại)
  if (customerId && priced.phoneE164 && (channel.kind === "social" || channel.kind === "direct") && input.consentConfirmed) {
    await tx.insert(consents).values({
      customerId,
      purpose: "data_processing",
      channel: "any",
      granted: true,
      policyVersion: process.env.CONSENT_POLICY_VERSION ?? "unversioned",
      source: "admin",
      evidence: { text: "Khách đã đồng ý cho Pomil dùng thông tin để giao hàng", orderCode: code, actorId: actor.id },
    });
  }
  if (customerId) await tx.insert(touchpoints).values({ customerId, type: "order_placed", payload: { orderCode: code, total: breakdown.total, channel: channel.code } });
  await writeAudit(tx, {
    actorId: actor.id,
    action: "order.created",
    entity: "orders",
    entityId: orderId,
    after: { code, channel: channel.code, total: breakdown.total, discountTotal: breakdown.discountTotal, status, manual: true },
  });
  return { ok: true, orderId, code, total: breakdown.total };
}

// R-BH-24: đơn đổi hàng cùng kênh, khách, địa chỉ; miễn tiền hàng; giữ hàng như mọi đơn
export async function createExchangeOrderInTx(
  tx: Tx,
  input: { originalOrderId: string; lines: { productId: string; qty: number }[]; shippingFee: number; returnCode: string },
  actorId: string,
): Promise<{ orderId: string; code: string }> {
  const [orig] = await tx.select().from(orders).where(eq(orders.id, input.originalOrderId));
  if (!orig) throw new UserError("Không tìm thấy đơn gốc");
  const lines = input.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) throw new UserError("Chọn hàng đổi");
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const productRows = await tx.select().from(products).where(inArray(products.id, productIds));
  let dealerListId: string | null = null;
  if (orig.dealerId) {
    const [d] = await tx.select({ priceListId: dealers.priceListId }).from(dealers).where(eq(dealers.id, orig.dealerId));
    dealerListId = d?.priceListId ?? null;
  }
  const lists = await loadPricingLists(tx, { channelCode: orig.channel, dealerPriceListId: dealerListId, productIds });
  const today = vnToday();
  const priced = productIds.map((pid) => {
    const p = productRows.find((x) => x.id === pid);
    if (!p || p.status !== "active") throw new UserError(`${p?.name ?? "Một sản phẩm"} hiện không bán`);
    const qty = lines.filter((l) => l.productId === pid).reduce((s, l) => s + l.qty, 0);
    const { unitPrice } = resolveUnitPrice({ productId: pid, qty, retailPrice: p.price, channelCode: orig.channel, today, ...lists });
    return { productId: pid, productName: p.name, unitPrice, quantity: qty, lineTotal: unitPrice * qty };
  });
  const short = await reserveProductStock(tx, priced);
  if (short) throw new UserError(await stockMessage(tx, short));
  const subtotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const shippingFee = Math.max(0, Math.round(input.shippingFee));
  const code = await nextOrderCode(tx, orig.channel, new Date());
  const [order] = await tx
    .insert(orders)
    .values({
      code,
      channel: orig.channel,
      customerId: orig.customerId,
      status: "confirmed",
      paymentMethod: orig.paymentMethod,
      recipientName: orig.recipientName,
      phoneE164: orig.phoneE164,
      email: orig.email,
      province: orig.province,
      ward: orig.ward,
      addressLine: orig.addressLine,
      customerNote: null,
      internalNote: `Đổi hàng cho ${orig.code} (${input.returnCode})`,
      subtotal,
      discountTotal: subtotal,
      shippingFee,
      total: shippingFee,
      dealerId: orig.dealerId,
      createdBy: actorId,
      accessToken: randomBytes(18).toString("base64url"),
    })
    .returning({ id: orders.id });
  await tx.insert(orderItems).values(priced.map((l) => ({ orderId: order!.id, ...l })));
  await tx.insert(orderEvents).values({ orderId: order!.id, type: "created", toStatus: "confirmed", note: `Đơn đổi hàng của ${orig.code}, đổi trả ${input.returnCode}`, actorId });
  await writeAudit(tx, { actorId, action: "order.created", entity: "orders", entityId: order!.id, after: { code, exchangeFor: orig.code, returnCode: input.returnCode } });
  return { orderId: order!.id, code };
}

// R-BH-33: sửa phí nền tảng; đơn đã có khoản phải thu chưa trả đủ → điều chỉnh công nợ
export async function updatePlatformFee(orderId: string, newFee: number, reason: string, actor: Actor): Promise<{ ok: true } | { ok: false; message: string }> {
  assertCan(actor, "sales.write");
  const db = await getDb();
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order) throw new UserError("Không tìm thấy đơn");
      if (order.paymentMethod !== "platform") throw new UserError("Chỉ đơn sàn có phí nền tảng");
      const debt = await findDebtBySource(tx, { kind: "receivable", orderId });
      const live = debt && debt.status !== "cancelled" ? debt : null;
      const problem = platformFeeChangeProblem({ total: order.total, newFee, debt: live });
      if (problem) throw new UserError(problem);
      if (newFee === order.platformFee) return;
      await tx.update(orders).set({ platformFee: newFee, updatedAt: new Date() }).where(eq(orders.id, orderId));
      if (live) await adjustDebtAmount(tx, { kind: "receivable", debtId: live.id, newAmount: order.total - newFee, reason: reason.trim() || `Sửa phí nền tảng đơn ${order.code}` }, actor.id);
      await tx.insert(orderEvents).values({ orderId, type: "note", note: `Phí nền tảng ${order.platformFee} → ${newFee}${reason.trim() ? `: ${reason.trim()}` : ""}`, actorId: actor.id });
      await writeAudit(tx, { actorId: actor.id, action: "order.platform_fee", entity: "orders", entityId: orderId, before: { platformFee: order.platformFee }, after: { platformFee: newFee } });
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, message: error.message };
    throw error;
  }
}

// Dữ liệu cho form đơn tay
export async function manualOrderFormData() {
  const db = await getDb();
  const [channels, productRows, dealerRows, bundleRows] = await Promise.all([
    db.select().from(salesChannels).where(eq(salesChannels.isActive, true)),
    db.select({ id: products.id, name: products.name, code: products.code, price: products.price, stock: products.stock }).from(products).where(eq(products.status, "active")),
    db.select({ id: dealers.id, code: dealers.code, name: dealers.name, status: dealers.status }).from(dealers).where(eq(dealers.status, "active")),
    db.select({ id: productBundles.id, name: productBundles.name, price: productBundles.price, channelCode: productBundles.channelCode }).from(productBundles).where(eq(productBundles.isActive, true)),
  ]);
  return {
    channels: channels.filter((c) => c.kind !== "own_web").sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code)),
    products: productRows.sort((a, b) => a.name.localeCompare(b.name)),
    dealers: dealerRows,
    bundles: bundleRows,
  };
}
