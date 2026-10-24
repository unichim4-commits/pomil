"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { passwordProblem, verifyPassword } from "@/modules/auth/password";
import { createSession, requireStaff } from "@/modules/auth/service";
import { getStaff, setStaffPassword, setTotp } from "@/modules/auth/staff";
import { generateTotpSecret, verifyTotp } from "@/modules/auth/totp";
import { fail, guard, ok, str, type ActionResult } from "../_lib/result";

const PENDING_TOTP_COOKIE = "pomil_totp_setup";

export async function changePasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requireStaff();
    const staff = await getStaff(me.id);
    if (!staff || !(await verifyPassword(str(formData, "current"), staff.passwordHash))) return fail("Mật khẩu hiện tại chưa đúng.");
    const next = str(formData, "next");
    const problem = passwordProblem(next);
    if (problem) return fail(problem);
    if (next !== str(formData, "confirm")) return fail("Hai lần nhập mật khẩu mới chưa khớp.");
    await setStaffPassword(me.id, next, me.id);
    // Đổi mật khẩu đăng xuất mọi phiên, nên tạo lại phiên cho chính máy này
    await createSession(me.id, true);
    return ok("Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.");
  });
}

// Bước 1: tạo khóa tạm, giữ trong cookie 10 phút cho tới khi người dùng nhập đúng mã.
export async function startTotpAction(): Promise<void> {
  await requireStaff();
  (await cookies()).set(PENDING_TOTP_COOKIE, generateTotpSecret(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin/tai-khoan",
    maxAge: 600,
  });
  revalidatePath("/admin/tai-khoan");
}

export async function confirmTotpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requireStaff();
    const store = await cookies();
    const secret = store.get(PENDING_TOTP_COOKIE)?.value;
    if (!secret) return fail("Mã QR đã hết hạn, bấm bắt đầu lại.");
    if (!verifyTotp(secret, str(formData, "code"))) return fail("Mã chưa đúng. Kiểm tra giờ trên điện thoại rồi thử lại.");
    await setTotp(me.id, secret, me.id);
    store.delete({ name: PENDING_TOTP_COOKIE, path: "/admin/tai-khoan" });
    revalidatePath("/admin", "layout");
    return ok("Đã bật xác thực 2 lớp. Lần đăng nhập sau sẽ hỏi mã.");
  });
}

export async function disableTotpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requireStaff();
    const staff = await getStaff(me.id);
    if (!staff?.totpSecret || !verifyTotp(staff.totpSecret, str(formData, "code"))) return fail("Nhập mã hiện tại trong ứng dụng để tắt.");
    await setTotp(me.id, null, me.id);
    revalidatePath("/admin", "layout");
    return ok("Đã tắt xác thực 2 lớp.");
  });
}

export async function readPendingTotp(): Promise<string | null> {
  return (await cookies()).get(PENDING_TOTP_COOKIE)?.value ?? null;
}
