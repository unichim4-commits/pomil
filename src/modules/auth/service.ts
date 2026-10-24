import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { staffSessions, staffUsers } from "@/db/schema";
import { can, MFA_PENDING_MINUTES, SESSION_DAYS, sessionUsable, type Permission, type StaffRole } from "./rules";

export const SESSION_COOKIE = "pomil_admin";

export type CurrentStaff = {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  totpEnabled: boolean;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(staffId: string, mfaPassed: boolean): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const ttlMs = mfaPassed ? SESSION_DAYS * 24 * 60 * 60 * 1000 : MFA_PENDING_MINUTES * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 200) ?? null;

  await db.insert(staffSessions).values({ tokenHash: hashToken(token), staffId, mfaPassed, userAgent, expiresAt });
  // Dọn phiên đã hết hạn của người này
  await db.delete(staffSessions).where(and(eq(staffSessions.staffId, staffId), lt(staffSessions.expiresAt, new Date())));

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

// Nâng phiên chờ mã 2 lớp thành phiên đầy đủ (đổi mã phiên mới để tránh cố định phiên).
export async function upgradeSessionAfterMfa(staffId: string): Promise<void> {
  await destroyCurrentSession();
  await createSession(staffId, true);
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(staffSessions).where(eq(staffSessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

export async function destroyAllSessions(staffId: string): Promise<void> {
  const db = await getDb();
  await db.delete(staffSessions).where(eq(staffSessions.staffId, staffId));
}

type SessionLookup =
  | { ok: true; staff: CurrentStaff }
  | { ok: false; reason: "signed_out" | "expired" | "inactive" | "mfa_required"; staffId?: string };

// Đọc phiên một lần cho mỗi request.
export const readSession = cache(async (): Promise<SessionLookup> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { ok: false, reason: "signed_out" };

  const db = await getDb();
  const [row] = await db
    .select({
      expiresAt: staffSessions.expiresAt,
      mfaPassed: staffSessions.mfaPassed,
      id: staffUsers.id,
      email: staffUsers.email,
      name: staffUsers.name,
      role: staffUsers.role,
      active: staffUsers.active,
      totpEnabledAt: staffUsers.totpEnabledAt,
    })
    .from(staffSessions)
    .innerJoin(staffUsers, eq(staffSessions.staffId, staffUsers.id))
    .where(eq(staffSessions.tokenHash, hashToken(token)));
  if (!row) return { ok: false, reason: "signed_out" };

  const verdict = sessionUsable({
    expiresAt: row.expiresAt,
    mfaPassed: row.mfaPassed,
    staffActive: row.active,
    totpEnabled: !!row.totpEnabledAt,
  });
  if (!verdict.ok) return { ok: false, reason: verdict.reason, staffId: row.id };

  return { ok: true, staff: { id: row.id, email: row.email, name: row.name, role: row.role, totpEnabled: !!row.totpEnabledAt } };
});

// Dùng trong trang và layout quản trị: chưa đăng nhập thì chuyển về /dang-nhap.
export async function requireStaff(): Promise<CurrentStaff> {
  const session = await readSession();
  if (!session.ok) redirect(`/dang-nhap?reason=${session.reason}`);
  return session.staff;
}

export class PermissionError extends Error {
  constructor() {
    super("Tài khoản của bạn không có quyền làm việc này.");
  }
}

// Dùng trong Server Action: kiểm tra lại quyền ở máy chủ, không tin việc nút bị ẩn.
export async function requirePermission(permission: Permission): Promise<CurrentStaff> {
  const staff = await requireStaff();
  if (!can(staff.role, permission)) throw new PermissionError();
  return staff;
}

export async function staffCount(): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(staffUsers);
  return row?.n ?? 0;
}

// Chặn dò mật khẩu: 5 lần sai trong 15 phút thì khóa tạm theo email. Lưu trong bộ nhớ,
// đủ cho một máy chủ; khi chạy nhiều máy thì chuyển sang bảng hoặc Redis.
const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export function isLockedOut(key: string): boolean {
  const now = Date.now();
  const recent = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(key: string): void {
  failures.set(key, [...(failures.get(key) ?? []), Date.now()]);
}

export function clearFailures(key: string): void {
  failures.delete(key);
}
