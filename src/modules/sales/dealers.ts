import "server-only";
// Đại lý (R-BH-9, R-BH-10, R-BH-30): hồ sơ, hợp đồng, hạn mức, chiết khấu, hoa hồng, công nợ (đọc từ Tài chính).
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dealers, orders, priceLists, receivables, returnRequests } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { normalizeVnPhone } from "@/lib/phone";
import { nextDocCode, vnToday } from "@/modules/numbering";
import { assertCan, type Actor } from "./access";
import { dealerOutstanding } from "./credit";
import { canChangeDealerStatus, contractEndingSoon, dealerCommission, DEALER_STATUS_LABEL, vnDayStart, type DealerStatus } from "./rules";

export type DealerInput = {
  name: string;
  tier: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxCode: string | null;
  contractNo: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  priceListId: string | null;
  discountBp: number;
  commissionBp: number;
  creditLimit: number;
  paymentTermsDays: number;
  customerId: string | null;
  note: string | null;
};

// Trường cần sales.pricing khi đổi (hạn mức, chiết khấu, hoa hồng, bảng giá)
const PRICING_FIELDS = ["priceListId", "discountBp", "commissionBp", "creditLimit", "paymentTermsDays"] as const;

function clean(input: DealerInput) {
  if (!input.name.trim()) throw new UserError("Nhập tên đại lý");
  const phone = input.phone?.trim() ? normalizeVnPhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw new UserError("Số điện thoại không hợp lệ");
  for (const [v, label] of [
    [input.discountBp, "Chiết khấu"],
    [input.commissionBp, "Hoa hồng"],
  ] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 10_000) throw new UserError(`${label} từ 0% tới 100%`);
  }
  if (!Number.isSafeInteger(input.creditLimit) || input.creditLimit < 0) throw new UserError("Hạn mức công nợ phải là số không âm");
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 365) throw new UserError("Hạn trả từ 0 tới 365 ngày");
  if (input.contractStart && input.contractEnd && input.contractEnd < input.contractStart) throw new UserError("Ngày kết thúc hợp đồng phải sau ngày bắt đầu");
  return {
    name: input.name.trim(),
    tier: input.tier.trim(),
    contactName: input.contactName?.trim() || null,
    phoneE164: phone,
    email: input.email?.trim() || null,
    address: input.address?.trim() || null,
    taxCode: input.taxCode?.trim() || null,
    contractNo: input.contractNo?.trim() || null,
    contractStart: input.contractStart || null,
    contractEnd: input.contractEnd || null,
    priceListId: input.priceListId || null,
    discountBp: input.discountBp,
    commissionBp: input.commissionBp,
    creditLimit: input.creditLimit,
    paymentTermsDays: input.paymentTermsDays,
    customerId: input.customerId || null,
    note: input.note?.trim() || null,
  };
}

export async function createDealer(input: DealerInput, actor: Actor): Promise<{ id: string; code: string }> {
  assertCan(actor, "sales.write");
  const data = clean(input);
  if (data.priceListId || data.discountBp || data.commissionBp || data.creditLimit || data.paymentTermsDays) {
    assertCan(actor, "sales.pricing", "Bảng giá, chiết khấu, hoa hồng, hạn mức và hạn trả của đại lý cần quyền giá (chủ cửa hàng)");
  }
  const db = await getDb();
  return db.transaction(async (tx) => {
    const code = await nextDocCode(tx, "DL");
    const [row] = await tx.insert(dealers).values({ code, ...data }).returning({ id: dealers.id });
    await writeAudit(tx, { actorId: actor.id, action: "dealer.created", entity: "dealers", entityId: row!.id, after: { code, ...data } });
    return { id: row!.id, code };
  });
}

export async function updateDealer(id: string, input: DealerInput, actor: Actor): Promise<void> {
  assertCan(actor, "sales.write");
  const data = clean(input);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(dealers).where(eq(dealers.id, id)).for("update");
    if (!before) throw new UserError("Không tìm thấy đại lý");
    if (PRICING_FIELDS.some((f) => before[f] !== data[f])) {
      assertCan(actor, "sales.pricing", "Bảng giá, chiết khấu, hoa hồng, hạn mức và hạn trả của đại lý cần quyền giá (chủ cửa hàng)");
    }
    await tx.update(dealers).set({ ...data, updatedAt: new Date() }).where(eq(dealers.id, id));
    await writeAudit(tx, { actorId: actor.id, action: "dealer.updated", entity: "dealers", entityId: id, before: { ...before }, after: data });
  });
}

export async function setDealerStatus(id: string, to: DealerStatus, actor: Actor): Promise<void> {
  assertCan(actor, "sales.write");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(dealers).where(eq(dealers.id, id)).for("update");
    if (!before) throw new UserError("Không tìm thấy đại lý");
    if (!canChangeDealerStatus(before.status, to)) throw new UserError(`Không chuyển được từ “${DEALER_STATUS_LABEL[before.status]}” sang “${DEALER_STATUS_LABEL[to]}”`);
    const changed = await tx
      .update(dealers)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(dealers.id, id), eq(dealers.status, before.status)))
      .returning({ id: dealers.id });
    if (changed.length === 0) throw new UserError("Đại lý vừa được người khác cập nhật, tải lại trang.");
    await writeAudit(tx, { actorId: actor.id, action: "dealer.status", entity: "dealers", entityId: id, before: { status: before.status }, after: { status: to } });
  });
}

export async function listDealers() {
  const db = await getDb();
  const rows = await db.select().from(dealers).orderBy(asc(dealers.status), asc(dealers.code));
  const debts = await db
    .select({ dealerId: receivables.dealerId, v: sql<string>`coalesce(sum(${receivables.amount} - ${receivables.paidAmount}), 0)` })
    .from(receivables)
    .where(inArray(receivables.status, ["open", "partial"]))
    .groupBy(receivables.dealerId);
  const debtBy = new Map(debts.map((d) => [d.dealerId, Number(d.v)]));
  const today = vnToday();
  return rows.map((d) => ({ ...d, outstanding: debtBy.get(d.id) ?? 0, endingSoon: contractEndingSoon(d.contractEnd, today), expired: !!d.contractEnd && d.contractEnd < today }));
}

// Doanh số giao trong kỳ (theo delivered_at), tiền hoàn đổi trả của các đơn đó, hoa hồng (R-BH-30)
export async function dealerPeriodSales(dealerId: string, from: string, toExclusive: string, commissionBp: number) {
  const db = await getDb();
  const [s] = await db
    .select({ n: sql<number>`count(*)::int`, net: sql<string>`coalesce(sum(${orders.subtotal} - ${orders.discountTotal}), 0)` })
    .from(orders)
    .where(and(eq(orders.dealerId, dealerId), inArray(orders.status, ["delivered", "returned"]), gte(orders.deliveredAt, vnDayStart(from)), lt(orders.deliveredAt, vnDayStart(toExclusive))));
  const [rf] = await db
    .select({ v: sql<string>`coalesce(sum(${returnRequests.refundAmount}), 0)` })
    .from(returnRequests)
    .innerJoin(orders, eq(orders.id, returnRequests.orderId))
    .where(and(eq(orders.dealerId, dealerId), eq(returnRequests.status, "completed"), gte(orders.deliveredAt, vnDayStart(from)), lt(orders.deliveredAt, vnDayStart(toExclusive))));
  const net = Number(s?.net ?? 0);
  const refunded = Number(rf?.v ?? 0);
  return { orders: Number(s?.n ?? 0), net, refunded, commission: dealerCommission(net, refunded, commissionBp) };
}

export async function getDealer(id: string) {
  const db = await getDb();
  const [dealer] = await db.select().from(dealers).where(eq(dealers.id, id));
  if (!dealer) return null;
  const [dealerOrders, debts, outstanding, lists] = await Promise.all([
    db.select().from(orders).where(eq(orders.dealerId, id)).orderBy(desc(orders.createdAt)).limit(50),
    db.select().from(receivables).where(eq(receivables.dealerId, id)).orderBy(desc(receivables.issuedOn)).limit(50),
    dealerOutstanding(db, id),
    db.select({ id: priceLists.id, code: priceLists.code, name: priceLists.name }).from(priceLists).where(eq(priceLists.isActive, true)),
  ]);
  return { dealer, orders: dealerOrders, receivables: debts, outstanding, priceLists: lists };
}

export async function dealersEndingSoon() {
  const db = await getDb();
  const today = vnToday();
  const rows = await db.select({ id: dealers.id, name: dealers.name, contractEnd: dealers.contractEnd }).from(dealers).where(eq(dealers.status, "active"));
  return rows.filter((d) => contractEndingSoon(d.contractEnd, today));
}
