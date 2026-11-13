"use server";

import { revalidatePath } from "next/cache";
import { resetAccountPasswordByStaff } from "@/modules/accounts/service";
import { requirePermission } from "@/modules/auth/service";
import { addCareNote, addCustomerTag, removeCustomerTag, STAGE_LABEL, updateCustomerStage, withdrawMarketingConsent } from "@/modules/customers/admin";
import { fail, guard, ok, str, type ActionResult } from "../_lib/result";

export async function withdrawConsentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("customers.write");
    const id = str(formData, "customerId");
    await withdrawMarketingConsent(id, staff.id);
    revalidatePath(`/admin/khach-hang/${id}`);
    return ok("Đã ghi nhận khách dừng nhận tin.");
  });
}

export async function stageAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("customers.write");
    const id = str(formData, "customerId");
    const stage = str(formData, "stage") as keyof typeof STAGE_LABEL;
    if (!(stage in STAGE_LABEL)) return fail("Giai đoạn không hợp lệ");
    await updateCustomerStage(id, stage, staff.id);
    revalidatePath(`/admin/khach-hang/${id}`);
    return ok("Đã cập nhật.");
  });
}

// Khách quên mật khẩu: nhân viên đối chiếu số Zalo nhắn tới với số đăng ký rồi đặt mật khẩu tạm.
export async function resetCustomerPasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("customers.write");
    const temp = await resetAccountPasswordByStaff(str(formData, "customerId"), staff.id);
    if (!temp) return fail("Khách này chưa có tài khoản.");
    return ok(`Mật khẩu tạm: ${temp}. Gửi riêng cho khách qua Zalo và nhắc đổi ngay sau khi đăng nhập.`);
  });
}

// R-BH-28: nhãn và ghi chú chăm sóc
export async function addTagAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "customerId");
    await addCustomerTag(id, str(formData, "tag"), staff);
    revalidatePath(`/admin/khach-hang/${id}`);
    return ok("Đã thêm nhãn.");
  });
}

export async function removeTagAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "customerId");
    await removeCustomerTag(id, str(formData, "tag"), staff);
    revalidatePath(`/admin/khach-hang/${id}`);
    return ok("Đã bỏ nhãn.");
  });
}

export async function careNoteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "customerId");
    await addCareNote(id, str(formData, "text"), staff);
    revalidatePath(`/admin/khach-hang/${id}`);
    return ok("Đã lưu ghi chú.");
  });
}
