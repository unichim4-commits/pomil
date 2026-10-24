import "server-only";
import { and, count, desc, eq, ilike, isNull, like, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { consents, customers, orders, touchpoints } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

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

export async function listCustomers(filter: { q?: string; stage?: Stage; page?: number }) {
  const db = await getDb();
  const q = filter.q?.trim();
  const digits = q?.replace(/\D/g, "").replace(/^0/, "");
  const where = and(
    isNull(customers.anonymizedAt),
    filter.stage ? eq(customers.lifecycleStage, filter.stage) : undefined,
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
