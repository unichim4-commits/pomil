import "server-only";
import { and, count, desc, eq, ilike, inArray, isNull, like, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { complaints, consents, customers, orderItems, orders, returnRequests, touchpoints } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { assertCan, type Actor } from "@/modules/sales/access";
import { addTag, careNoteProblem, customerMetrics, normalizeTag } from "@/modules/sales/rules";

export const CUSTOMER_PAGE_SIZE = 30;
type Stage = (typeof customers.$inferSelect)["lifecycleStage"];

export const STAGE_LABEL: Record<Stage, string> = {
  lead: "Đăng ký chờ",
  tester: "Dùng thử",
  first_buyer: "Mua lần đầu",
  repeat_buyer: "Mua lại",
  ambassador: "Đại sứ",
  churned: "Rời đi",
};

export async function listCustomers(filter: { q?: string; stage?: Stage; page?: number; tag?: string }) {
  const db = await getDb();
  const q = filter.q?.trim();
  const digits = q?.replace(/\D/g, "").replace(/^0/, "");
  const where = and(
    isNull(customers.anonymizedAt),
    filter.stage ? eq(customers.lifecycleStage, filter.stage) : undefined,
    filter.tag ? sql`${customers.tags} @> ${JSON.stringify([normalizeTag(filter.tag)])}::jsonb` : undefined,
    q ? or(ilike(customers.name, `%${q}%`), digits && digits.length >= 3 ? like(customers.phoneE164, `%${digits}%`) : undefined, eq(customers.referralCode, q.toUpperCase())) : undefined,
  );
  const page = Math.max(1, filter.page ?? 1);
  const orderStats = db
    .select({
      customerId: orders.customerId,
      n: count().as("n"),
      spent: sql<number>`coalesce(sum(case when ${orders.status} not in ('cancelled','returned') then ${orders.total} else 0 end),0)`.as("spent"),
    })
    .from(orders)
    .groupBy(orders.customerId)
    .as("os");

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        phoneE164: customers.phoneE164,
        stage: customers.lifecycleStage,
        tags: customers.tags,
        createdAt: customers.createdAt,
        orders: sql<number>`coalesce(${orderStats.n}, 0)`,
        spent: sql<number>`coalesce(${orderStats.spent}, 0)`,
      })
      .from(customers)
      .leftJoin(orderStats, eq(orderStats.customerId, customers.id))
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(CUSTOMER_PAGE_SIZE)
      .offset((page - 1) * CUSTOMER_PAGE_SIZE),
    db.select({ n: count() }).from(customers).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, orders: Number(r.orders), spent: Number(r.spent) })), total: total?.n ?? 0, page };
}

export async function countByStage(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select({ stage: customers.lifecycleStage, n: count() }).from(customers).where(isNull(customers.anonymizedAt)).groupBy(customers.lifecycleStage);
  return Object.fromEntries(rows.map((r) => [r.stage, r.n]));
}

export async function getCustomerDetail(id: string) {
  const db = await getDb();
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  if (!customer) return null;
  const [customerOrders, customerConsents, timeline] = await Promise.all([
    db.select().from(orders).where(eq(orders.customerId, id)).orderBy(desc(orders.createdAt)),
    db.select().from(consents).where(eq(consents.customerId, id)).orderBy(desc(consents.capturedAt)),
    db.select().from(touchpoints).where(eq(touchpoints.customerId, id)).orderBy(desc(touchpoints.occurredAt)).limit(50),
  ]);
  return { customer, orders: customerOrders, consents: customerConsents, timeline };
}

// R-BH-27: chỉ số khách, phản ánh, đổi trả, ghi chú chăm sóc
export async function getCustomerCrm(id: string) {
  const db = await getDb();
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  if (!customer) return null;
  const os = await db.select().from(orders).where(eq(orders.customerId, id));
  const ids = os.map((o) => o.id);
  const [items, refunds, returns, notes, complaintRows] = await Promise.all([
    ids.length ? db.select({ orderId: orderItems.orderId, productId: orderItems.productId, productName: orderItems.productName, quantity: orderItems.quantity }).from(orderItems).where(inArray(orderItems.orderId, ids)) : Promise.resolve([]),
    ids.length
      ? db
          .select({ orderId: returnRequests.orderId, v: sql<string>`sum(${returnRequests.refundAmount})` })
          .from(returnRequests)
          .where(and(inArray(returnRequests.orderId, ids), eq(returnRequests.status, "completed")))
          .groupBy(returnRequests.orderId)
      : Promise.resolve([]),
    ids.length ? db.select({ r: returnRequests, orderCode: orders.code }).from(returnRequests).innerJoin(orders, eq(orders.id, returnRequests.orderId)).where(inArray(returnRequests.orderId, ids)).orderBy(desc(returnRequests.requestedAt)) : Promise.resolve([]),
    db.select().from(touchpoints).where(and(eq(touchpoints.customerId, id), eq(touchpoints.type, "care_note"))).orderBy(desc(touchpoints.occurredAt)),
    db
      .select()
      .from(complaints)
      .where(customer.phoneE164 ? or(eq(complaints.customerId, id), eq(complaints.contactPhone, customer.phoneE164)) : eq(complaints.customerId, id))
      .orderBy(desc(complaints.openedAt)),
  ]);
  const metrics = customerMetrics(
    os.map((o) => ({
      status: o.status,
      total: o.total,
      createdAt: o.createdAt,
      refunded: Number(refunds.find((r) => r.orderId === o.id)?.v ?? 0),
      items: items.filter((i) => i.orderId === o.id),
    })),
  );
  return { metrics, returns, notes, complaints: complaintRows };
}

// R-BH-28: nhãn phân nhóm
export async function addCustomerTag(customerId: string, raw: string, actor: Actor): Promise<void> {
  assertCan(actor, "sales.write");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [c] = await tx.select({ tags: customers.tags }).from(customers).where(eq(customers.id, customerId)).for("update");
    if (!c) throw new UserError("Không tìm thấy khách");
    const r = addTag(c.tags ?? [], raw);
    if (!r.ok) throw new UserError(r.message);
    if (r.tags.length === (c.tags ?? []).length) return;
    await tx.update(customers).set({ tags: r.tags, updatedAt: new Date() }).where(eq(customers.id, customerId));
    await writeAudit(tx, { actorId: actor.id, action: "customer.tags", entity: "customers", entityId: customerId, before: { tags: c.tags }, after: { tags: r.tags } });
  });
}

export async function removeCustomerTag(customerId: string, tag: string, actor: Actor): Promise<void> {
  assertCan(actor, "sales.write");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [c] = await tx.select({ tags: customers.tags }).from(customers).where(eq(customers.id, customerId)).for("update");
    if (!c) throw new UserError("Không tìm thấy khách");
    const next = (c.tags ?? []).filter((t) => t !== normalizeTag(tag));
    await tx.update(customers).set({ tags: next, updatedAt: new Date() }).where(eq(customers.id, customerId));
    await writeAudit(tx, { actorId: actor.id, action: "customer.tags", entity: "customers", entityId: customerId, before: { tags: c.tags }, after: { tags: next } });
  });
}

// R-BH-28: ghi chú chăm sóc (touchpoints care_note)
export async function addCareNote(customerId: string, text: string, actor: Actor): Promise<void> {
  assertCan(actor, "sales.write");
  const problem = careNoteProblem(text);
  if (problem) throw new UserError(problem);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId));
    if (!c) throw new UserError("Không tìm thấy khách");
    await tx.insert(touchpoints).values({ customerId, type: "care_note", payload: { text: text.trim(), staffId: actor.id } });
    await writeAudit(tx, { actorId: actor.id, action: "customer.care_note", entity: "customers", entityId: customerId });
  });
}

export async function allCustomerTags(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ tag: sql<string>`jsonb_array_elements_text(${customers.tags})` }).from(customers);
  return [...new Set(rows.map((r) => r.tag))].sort();
}

// Rút đồng ý nhận tin theo yêu cầu của khách (qua điện thoại, Zalo). Ghi bản ghi mới, không xóa bằng chứng cũ.
export async function withdrawMarketingConsent(customerId: string, actorId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(consents)
      .set({ withdrawnAt: now })
      .where(and(eq(consents.customerId, customerId), eq(consents.purpose, "marketing_message"), isNull(consents.withdrawnAt)));
    await tx.insert(consents).values({
      customerId,
      purpose: "marketing_message",
      channel: "any",
      granted: false,
      policyVersion: process.env.CONSENT_POLICY_VERSION ?? "unversioned",
      source: "admin",
      evidence: { note: "Khách yêu cầu dừng nhận tin", actorId },
    });
    await writeAudit(tx, { actorId, action: "consent.withdrawn", entity: "customers", entityId: customerId, after: { purpose: "marketing_message" } });
  });
}

export async function updateCustomerStage(customerId: string, stage: Stage, actorId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const before = await tx.query.customers.findFirst({ where: eq(customers.id, customerId) });
    if (!before) return;
    await tx.update(customers).set({ lifecycleStage: stage, updatedAt: new Date() }).where(eq(customers.id, customerId));
    await writeAudit(tx, { actorId, action: "customer.stage", entity: "customers", entityId: customerId, before: { stage: before.lifecycleStage }, after: { stage } });
  });
}
