"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logError } from "@/lib/log";
import { normalizeVnPhone } from "@/lib/phone";
import { customerPasswordProblem, safeNextPath } from "@/modules/accounts/rules";
import {
  changeAccountPassword,
  createCustomerSession,
  currentCustomer,
  destroyCustomerSession,
  registerAccount,
  updateAccountName,
  verifyAccountLogin,
} from "@/modules/accounts/service";
import { clearFailures, isLockedOut, recordFailure } from "@/modules/auth/service";
import { ACCOUNT_DATA_CONSENT_TEXT } from "@/modules/consent/texts";

export type AccountFormState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; message: string; at: number };

const PHONE_ERROR = "Số di động Việt Nam chưa đúng, ví dụ 0901 234 567.";

const registerSchema = z.object({
  name: z.string().trim().min(2, "Nhập tên của bạn").max(80),
  phone: z.string().trim().min(9, "Nhập số điện thoại").max(20),
  password: z.string().max(200),
  confirm: z.string().max(200),
  dataConsent: z.literal("on", { errorMap: () => ({ message: "Cần đồng ý để Pomil tạo tài khoản cho bạn" }) }),
  next: z.string().max(300).optional(),
  website: z.string().max(0).optional(),
});

export async function registerAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ" };
  const d = parsed.data;
  const phoneE164 = normalizeVnPhone(d.phone);
  if (!phoneE164) return { status: "error", message: PHONE_ERROR };
  const problem = customerPasswordProblem(d.password, phoneE164);
  if (problem) return { status: "error", message: problem };
  if (d.password !== d.confirm) return { status: "error", message: "Hai lần nhập mật khẩu chưa khớp." };

  const lockKey = `kh-dk:${phoneE164}`;
  if (isLockedOut(lockKey)) return { status: "error", message: "Thử quá nhiều lần. Bạn thử lại sau 15 phút nhé." };

  let result;
  try {
    result = await registerAccount({ name: d.name, phoneE164, password: d.password, consentText: ACCOUNT_DATA_CONSENT_TEXT });
  } catch (error) {
    logError("account register", error);
    return { status: "error", message: "Chưa tạo được tài khoản, bạn thử lại sau ít phút nhé." };
  }
  if (!result.ok) {
    recordFailure(lockKey);
    return { status: "error", message: "Số này đã có tài khoản. Bạn đăng nhập, hoặc nhắn Zalo Pomil nếu quên mật khẩu." };
  }
  await createCustomerSession(result.accountId);
  redirect(safeNextPath(d.next, "/tai-khoan?moi=1"));
}

const loginSchema = z.object({ phone: z.string().trim().max(20), password: z.string().max(200), next: z.string().max(300).optional() });

export async function customerLoginAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Nhập số điện thoại và mật khẩu." };
  const phoneE164 = normalizeVnPhone(parsed.data.phone);
  if (!phoneE164) return { status: "error", message: PHONE_ERROR };

  const lockKey = `kh:${phoneE164}`;
  if (isLockedOut(lockKey)) return { status: "error", message: "Sai quá nhiều lần. Bạn thử lại sau 15 phút nhé." };
  const accountId = await verifyAccountLogin(phoneE164, parsed.data.password);
  if (!accountId) {
    recordFailure(lockKey);
    return { status: "error", message: "Số điện thoại hoặc mật khẩu chưa đúng." };
  }
  clearFailures(lockKey);
  await createCustomerSession(accountId);
  redirect(safeNextPath(parsed.data.next));
}

export async function customerLogoutAction(): Promise<void> {
  await destroyCustomerSession();
  redirect("/");
}

export async function updateProfileAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const me = await currentCustomer();
  if (!me) redirect("/tai-khoan/dang-nhap");
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) return { status: "error", message: "Tên cần từ 2 đến 80 ký tự." };
  await updateAccountName(me.customerId, name);
  revalidatePath("/tai-khoan");
  return { status: "ok", message: "Đã lưu tên.", at: Date.now() };
}

export async function changePasswordAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const me = await currentCustomer();
  if (!me) redirect("/tai-khoan/dang-nhap");
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const problem = customerPasswordProblem(next, me.phoneE164);
  if (problem) return { status: "error", message: problem };
  if (next !== confirm) return { status: "error", message: "Hai lần nhập mật khẩu mới chưa khớp." };

  const lockKey = `kh:${me.phoneE164}`;
  if (isLockedOut(lockKey)) return { status: "error", message: "Sai quá nhiều lần. Bạn thử lại sau 15 phút nhé." };
  if (!(await changeAccountPassword(me.accountId, current, next))) {
    recordFailure(lockKey);
    return { status: "error", message: "Mật khẩu hiện tại chưa đúng." };
  }
  await createCustomerSession(me.accountId);
  return { status: "ok", message: "Đã đổi mật khẩu. Các máy khác đã được đăng xuất.", at: Date.now() };
}
