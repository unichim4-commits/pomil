"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { passwordProblem } from "@/modules/auth/password";
import { requirePermission } from "@/modules/auth/service";
import { createStaff, findStaffByEmail, setStaffPassword, updateStaff } from "@/modules/auth/staff";
import { fail, guard, ok, str, type ActionResult } from "../_lib/result";

const role = z.enum(["owner", "collaborator", "viewer"]);

export async function createStaffAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requirePermission("staff.manage");
    const parsed = z
      .object({ email: z.string().trim().email("Email chưa đúng"), name: z.string().trim().min(1, "Nhập tên").max(80), role, password: z.string() })
      .safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ");
    const problem = passwordProblem(parsed.data.password);
    if (problem) return fail(problem);
    if (await findStaffByEmail(parsed.data.email)) return fail("Email này đã có tài khoản");
    await createStaff(parsed.data, me.id);
    revalidatePath("/admin/nhan-vien");
    return ok("Đã tạo tài khoản. Gửi mật khẩu tạm cho người đó qua kênh riêng và nhắc đổi ngay.");
  });
}

export async function updateStaffAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requirePermission("staff.manage");
    const id = str(formData, "id");
    const parsedRole = role.safeParse(str(formData, "role"));
    if (!parsedRole.success) return fail("Vai trò không hợp lệ");
    const active = formData.get("active") === "on";
    if (id === me.id && (!active || parsedRole.data !== "owner")) return fail("Không tự hạ quyền hoặc tự khóa tài khoản của mình.");
    const r = await updateStaff(id, { role: parsedRole.data, active, name: str(formData, "name") }, me.id);
    revalidatePath("/admin/nhan-vien");
    return r.ok ? ok("Đã lưu") : fail(r.message ?? "Không lưu được");
  });
}

export async function resetPasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requirePermission("staff.manage");
    const password = str(formData, "password");
    const problem = passwordProblem(password);
    if (problem) return fail(problem);
    await setStaffPassword(str(formData, "id"), password, me.id);
    return ok("Đã đặt mật khẩu mới và đăng xuất mọi phiên của người đó.");
  });
}
