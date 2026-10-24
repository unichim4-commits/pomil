import "server-only";
import { asc, count, desc, eq, and, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { auditLog, staffUsers } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "./password";
import type { StaffRole } from "./rules";
import { destroyAllSessions } from "./service";

export async function listStaff() {
  const db = await getDb();
  return db
    .select({
      id: staffUsers.id,
      email: staffUsers.email,
      name: staffUsers.name,
      role: staffUsers.role,
      active: staffUsers.active,
      totpEnabledAt: staffUsers.totpEnabledAt,
      lastLoginAt: staffUsers.lastLoginAt,
    })
    .from(staffUsers)
    .orderBy(asc(staffUsers.createdAt));
}

export async function findStaffByEmail(email: string) {
  const db = await getDb();
  return db.query.staffUsers.findFirst({ where: eq(staffUsers.email, email.trim().toLowerCase()) });
}

export async function getStaff(id: string) {
  const db = await getDb();
  return db.query.staffUsers.findFirst({ where: eq(staffUsers.id, id) });
}

export async function createStaff(input: { email: string; name: string; role: StaffRole; password: string }, actorId: string | null): Promise<string> {
  const db = await getDb();
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(staffUsers)
      .values({ email: input.email.trim().toLowerCase(), name: input.name, role: input.role, passwordHash })
      .returning({ id: staffUsers.id });
    await writeAudit(tx, { actorId: actorId ?? row!.id, action: "staff.created", entity: "staff_users", entityId: row!.id, after: { email: input.email, role: input.role } });
    return row!.id;
  });
}

// Khóa riêng cho việc tạo chủ cửa hàng đầu tiên (số tùy chọn, cố định).
const FIRST_OWNER_LOCK = 7_042_001;

// Tạo chủ cửa hàng đầu tiên. Kiểm "chưa có nhân viên" và thêm mới trong cùng một giao dịch
// có khóa, nên hai lần gửi cùng lúc chỉ tạo được một chủ. Trả null nếu đã có nhân viên.
export async function createFirstOwner(input: { email: string; name: string; password: string }): Promise<string | null> {
  const db = await getDb();
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${FIRST_OWNER_LOCK})`);
    const [existing] = await tx.select({ n: count() }).from(staffUsers);
    if ((existing?.n ?? 0) > 0) return null;
    const [row] = await tx
      .insert(staffUsers)
      .values({ email: input.email.trim().toLowerCase(), name: input.name, role: "owner", passwordHash })
      .returning({ id: staffUsers.id });
    await writeAudit(tx, { actorId: row!.id, action: "staff.created", entity: "staff_users", entityId: row!.id, after: { email: input.email, role: "owner", via: "setup" } });
    return row!.id;
  });
}

export async function updateStaff(id: string, data: { role: StaffRole; active: boolean; name: string }, actorId: string): Promise<{ ok: boolean; message?: string }> {
  const db = await getDb();
  const target = await getStaff(id);
  if (!target) return { ok: false, message: "Không tìm thấy nhân viên" };
  // Luôn giữ ít nhất một chủ cửa hàng còn hoạt động
  if (target.role === "owner" && (data.role !== "owner" || !data.active)) {
    const [owners] = await db.select({ n: count() }).from(staffUsers).where(and(eq(staffUsers.role, "owner"), eq(staffUsers.active, true)));
    if ((owners?.n ?? 0) <= 1) return { ok: false, message: "Cần giữ ít nhất một chủ cửa hàng đang hoạt động." };
  }
  await db.transaction(async (tx) => {
    await tx.update(staffUsers).set(data).where(eq(staffUsers.id, id));
    await writeAudit(tx, { actorId, action: "staff.updated", entity: "staff_users", entityId: id, before: { role: target.role, active: target.active }, after: data });
  });
  if (!data.active) await destroyAllSessions(id);
  return { ok: true };
}

export async function setStaffPassword(id: string, password: string, actorId: string): Promise<void> {
  const db = await getDb();
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(staffUsers).set({ passwordHash }).where(eq(staffUsers.id, id));
    await writeAudit(tx, { actorId, action: "staff.password_changed", entity: "staff_users", entityId: id });
  });
  await destroyAllSessions(id);
}

export async function setTotp(id: string, secret: string | null, actorId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(staffUsers)
      .set({ totpSecret: secret, totpEnabledAt: secret ? new Date() : null })
      .where(eq(staffUsers.id, id));
    await writeAudit(tx, { actorId, action: secret ? "staff.totp_enabled" : "staff.totp_disabled", entity: "staff_users", entityId: id });
  });
}

export async function markLogin(id: string): Promise<void> {
  const db = await getDb();
  await db.update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, id));
}

export const AUDIT_PAGE_SIZE = 50;

export async function listAudit(page = 1) {
  const db = await getDb();
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      at: auditLog.at,
      actorEmail: staffUsers.email,
    })
    .from(auditLog)
    .leftJoin(staffUsers, eq(auditLog.actorId, staffUsers.id))
    .orderBy(desc(auditLog.at))
    .limit(AUDIT_PAGE_SIZE)
    .offset((Math.max(1, page) - 1) * AUDIT_PAGE_SIZE);
}
