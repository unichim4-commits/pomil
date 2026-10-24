"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { passwordProblem, verifyPassword } from "@/modules/auth/password";
import {
  clearFailures,
  createSession,
  destroyCurrentSession,
  isLockedOut,
  readSession,
  recordFailure,
  staffCount,
  upgradeSessionAfterMfa,
} from "@/modules/auth/service";
import { createFirstOwner, findStaffByEmail, getStaff, markLogin } from "@/modules/auth/staff";
import { setupMode, setupTokenMatches } from "@/modules/auth/setup";
import { verifyTotp } from "@/modules/auth/totp";

export type AuthState = { status: "idle" } | { status: "error"; message: string };

const setupSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên").max(80),
  email: z.string().trim().email("Email chưa đúng").max(120),
  password: z.string(),
  confirm: z.string(),
  setupToken: z.string().max(200).optional(),
});

const SETUP_LOCK_KEY = "setup";

// Tạo tài khoản chủ cửa hàng đầu tiên. Chỉ chạy được khi chưa có nhân viên nào.
// Bản chạy thật bắt buộc nhập đúng SETUP_TOKEN (biến môi trường) để người lạ không chiếm quyền.
export async function setupOwnerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const expected = process.env.SETUP_TOKEN ?? "";
  const mode = setupMode({ nodeEnv: process.env.NODE_ENV, setupToken: expected });
  if (mode === "disabled") return { status: "error", message: "Chưa đặt SETUP_TOKEN trên Vercel. Tải lại trang để xem 3 bước tạo chủ cửa hàng." };
  if ((await staffCount()) > 0) return { status: "error", message: "Đã có tài khoản quản trị. Hãy đăng nhập." };

  const parsed = setupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ" };
  if (mode === "token") {
    if (isLockedOut(SETUP_LOCK_KEY)) return { status: "error", message: "Sai quá nhiều lần. Thử lại sau 15 phút." };
    if (!setupTokenMatches(expected, parsed.data.setupToken ?? "")) {
      recordFailure(SETUP_LOCK_KEY);
      return { status: "error", message: "Mã khởi tạo chưa đúng." };
    }
  }
  const problem = passwordProblem(parsed.data.password);
  if (problem) return { status: "error", message: problem };
  if (parsed.data.password !== parsed.data.confirm) return { status: "error", message: "Hai lần nhập mật khẩu chưa khớp." };

  const id = await createFirstOwner({ email: parsed.data.email, name: parsed.data.name, password: parsed.data.password });
  if (!id) return { status: "error", message: "Đã có tài khoản quản trị. Hãy đăng nhập." };
  await createSession(id, true);
  await markLogin(id);
  redirect("/admin?moi=1");
}

const loginSchema = z.object({ email: z.string().trim().max(120), password: z.string().max(200) });

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Nhập email và mật khẩu." };
  const key = parsed.data.email.toLowerCase();
  if (isLockedOut(key)) return { status: "error", message: "Sai quá nhiều lần. Thử lại sau 15 phút." };

  const staff = await findStaffByEmail(key);
  const ok = staff ? await verifyPassword(parsed.data.password, staff.passwordHash) : false;
  if (!staff || !ok || !staff.active) {
    recordFailure(key);
    return { status: "error", message: "Email hoặc mật khẩu chưa đúng." };
  }
  clearFailures(key);

  const needsMfa = !!staff.totpEnabledAt;
  await createSession(staff.id, !needsMfa);
  if (needsMfa) redirect("/dang-nhap?buoc=ma");
  await markLogin(staff.id);
  redirect("/admin");
}

export async function mfaAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const session = await readSession();
  if (session.ok) redirect("/admin");
  if (session.reason !== "mfa_required" || !session.staffId) redirect("/dang-nhap");

  const key = `mfa:${session.staffId}`;
  if (isLockedOut(key)) return { status: "error", message: "Sai quá nhiều lần. Đăng nhập lại sau 15 phút." };
  const staff = await getStaff(session.staffId);
  const code = String(formData.get("code") ?? "");
  if (!staff?.totpSecret || !verifyTotp(staff.totpSecret, code)) {
    recordFailure(key);
    return { status: "error", message: "Mã chưa đúng hoặc đã hết hạn." };
  }
  clearFailures(key);
  await upgradeSessionAfterMfa(staff.id);
  await markLogin(staff.id);
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/dang-nhap");
}
