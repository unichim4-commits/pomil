import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getDb } from "@/db/client";
import { consents, customerAccounts, customers, customerSessions, orderItems, orders, touchpoints } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { generateReferralCode } from "@/lib/referral";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_DAYS } from "./rules";

export type CurrentCustomer = { accountId: string; customerId: string; name: string; phoneE164: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type RegisterResult = { ok: true; accountId: string } | { ok: false; reason: "exists" };

// Tạo tài khoản: tìm khách theo số điện thoại (có thể đã có từ đơn cũ hoặc danh sách chờ),
// tạo khách nếu chưa có, ghi đồng ý xử lý dữ liệu.
// Đơn cũ đặt khi chưa đăng nhập KHÔNG tự hiện trong tài khoản: chưa xác minh được số điện thoại
// là của người đăng ký, nên không để lộ địa chỉ trong đơn cũ cho người khác.
export async function registerAccount(input: { name: string; phoneE164: string; password: string; consentText: string }): Promise<RegisterResult> {
  const db = await getDb();
  const passwordHash = await hashPassword(input.password);
  const policyVersion = process.env.CONSENT_POLICY_VERSION ?? "unversioned";

  return db.transaction(async (tx) => {
    let customer = await tx.query.customers.findFirst({ where: eq(customers.phoneE164, input.phoneE164) });
    if (customer) {
      const existing = await tx.query.customerAccounts.findFirst({ where: eq(customerAccounts.customerId, customer.id) });
      if (existing) return { ok: false as const, reason: "exists" as const };
    } else {
      const [row] = await tx
        .insert(customers)
        .values({ phoneE164: input.phoneE164, name: input.name, referralCode: generateReferralCode() })
        .returning();
      customer = row!;
      await writeAudit(tx, { actorId: null, action: "customer.created", entity: "customers", entityId: customer.id, after: { source: "account_signup" } });
    }

    const [account] = await tx.insert(customerAccounts).values({ customerId: customer.id, passwordHash }).returning({ id: customerAccounts.id });
    await tx.insert(consents).values({
      customerId: customer.id,
      purpose: "data_processing",
      channel: "any",
      granted: true,
      policyVersion,
      source: "account_signup",
      evidence: { text: input.consentText },
    });
    await tx.insert(touchpoints).values({ customerId: customer.id, type: "account_created", payload: {} });
    await writeAudit(tx, { actorId: null, action: "customer_account.created", entity: "customer_accounts", entityId: account!.id, after: { customerId: customer.id } });
    return { ok: true as const, accountId: account!.id };
  });
}

// Trả accountId khi đúng số và mật khẩu. Luôn băm thử để thời gian trả lời như nhau.
export async function verifyAccountLogin(phoneE164: string, password: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ id: customerAccounts.id, passwordHash: customerAccounts.passwordHash, active: customerAccounts.active })
    .from(customerAccounts)
    .innerJoin(customers, eq(customerAccounts.customerId, customers.id))
    .where(eq(customers.phoneE164, phoneE164));
  const ok = await verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);
  if (!row || !ok || !row.active) return null;
  await db.update(customerAccounts).set({ lastLoginAt: new Date() }).where(eq(customerAccounts.id, row.id));
  return row.id;
}

// Băm sẵn của một chuỗi ngẫu nhiên, chỉ để so sánh khi không có tài khoản
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export async function createCustomerSession(accountId: string): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const ttlMs = CUSTOMER_SESSION_DAYS * 24 * 60 * 60 * 1000;
  const userAgent = (await headers()).get("user-agent")?.slice(0, 200) ?? null;
  await db.insert(customerSessions).values({ tokenHash: hashToken(token), accountId, userAgent, expiresAt: new Date(Date.now() + ttlMs) });
  await db.delete(customerSessions).where(and(eq(customerSessions.accountId, accountId), lt(customerSessions.expiresAt, new Date())));
  (await cookies()).set(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export async function destroyCustomerSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(CUSTOMER_SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(customerSessions).where(eq(customerSessions.tokenHash, hashToken(token)));
  }
  store.delete(CUSTOMER_SESSION_COOKIE);
}

// Khách đang đăng nhập, đọc một lần mỗi request. null khi chưa đăng nhập hoặc phiên hết hạn.
export const currentCustomer = cache(async (): Promise<CurrentCustomer | null> => {
  const token = (await cookies()).get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ accountId: customerAccounts.id, customerId: customers.id, name: customers.name, phoneE164: customers.phoneE164, active: customerAccounts.active })
    .from(customerSessions)
    .innerJoin(customerAccounts, eq(customerSessions.accountId, customerAccounts.id))
    .innerJoin(customers, eq(customerAccounts.customerId, customers.id))
    .where(and(eq(customerSessions.tokenHash, hashToken(token)), gt(customerSessions.expiresAt, new Date())));
  if (!row || !row.active || !row.phoneE164) return null;
  return { accountId: row.accountId, customerId: row.customerId, name: row.name ?? "", phoneE164: row.phoneE164 };
});

export type AccountOrder = {
  code: string;
  accessToken: string;
  status: string;
  total: number;
  createdAt: Date;
  items: { productId: string; productName: string; quantity: number }[];
};

export async function listAccountOrders(accountId: string): Promise<AccountOrder[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: orders.id, code: orders.code, accessToken: orders.accessToken, status: orders.status, total: orders.total, createdAt: orders.createdAt })
    .from(orders)
    .where(eq(orders.accountId, accountId))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  if (rows.length === 0) return [];
  const items = await db
    .select({ orderId: orderItems.orderId, productId: orderItems.productId, productName: orderItems.productName, quantity: orderItems.quantity })
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((r) => r.id)));
  return rows.map(({ id, ...r }) => ({ ...r, items: items.filter((i) => i.orderId === id) }));
}

// Địa chỉ của đơn gần nhất để điền sẵn ở trang thanh toán
export async function lastShippingAddress(accountId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ recipientName: orders.recipientName, phoneE164: orders.phoneE164, email: orders.email, province: orders.province, ward: orders.ward, addressLine: orders.addressLine })
    .from(orders)
    .where(eq(orders.accountId, accountId))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  return row ?? null;
}

export async function updateAccountName(customerId: string, name: string): Promise<void> {
  const db = await getDb();
  await db.update(customers).set({ name, updatedAt: new Date() }).where(eq(customers.id, customerId));
}

export async function changeAccountPassword(accountId: string, current: string, next: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.query.customerAccounts.findFirst({ where: eq(customerAccounts.id, accountId) });
  if (!row || !(await verifyPassword(current, row.passwordHash))) return false;
  await db.update(customerAccounts).set({ passwordHash: await hashPassword(next) }).where(eq(customerAccounts.id, accountId));
  // Đăng xuất mọi máy khác; máy hiện tại tạo phiên mới ở action
  await db.delete(customerSessions).where(eq(customerSessions.accountId, accountId));
  await writeAudit(db, { actorId: null, action: "customer_account.password_changed", entity: "customer_accounts", entityId: accountId });
  return true;
}

// Nhân viên đặt mật khẩu tạm khi khách quên (khách nhắn Zalo, nhân viên đối chiếu số điện thoại)
export async function resetAccountPasswordByStaff(customerId: string, staffId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.query.customerAccounts.findFirst({ where: eq(customerAccounts.customerId, customerId) });
  if (!row) return null;
  const temp = randomBytes(6).toString("base64url").replace(/[-_]/g, "x");
  await db.update(customerAccounts).set({ passwordHash: await hashPassword(temp) }).where(eq(customerAccounts.id, row.id));
  await db.delete(customerSessions).where(eq(customerSessions.accountId, row.id));
  await writeAudit(db, { actorId: staffId, action: "customer_account.password_reset", entity: "customer_accounts", entityId: row.id });
  return temp;
}

export async function accountForCustomer(customerId: string) {
  const db = await getDb();
  return (await db.query.customerAccounts.findFirst({ where: eq(customerAccounts.customerId, customerId) })) ?? null;
}
