"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/service";
import { listRecentZaloUsers } from "@/modules/notify/channels";
import { deliver, retryNotification } from "@/modules/notify/service";
import { fail, guard, ok, str, type ActionResult } from "../_lib/result";

export async function sendTestAction(): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("settings.write");
    const r = await deliver({ kind: "test", requestedBy: staff.email });
    revalidatePath("/admin/thong-bao");
    if (r.noRecipients) return fail("Chưa có người nhận. Điền email hoặc user_id Zalo ở Cài đặt cửa hàng.");
    if (r.sent === 0) return fail(`Chưa gửi được tin nào (${r.failed} lỗi, ${r.skipped} kênh chưa cấu hình). Xem lý do trong bảng bên dưới.`);
    return ok(`Đã gửi ${r.sent} tin${r.failed + r.skipped ? `, ${r.failed + r.skipped} chưa gửi được` : ""}.`);
  });
}

export async function retryAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    await requirePermission("settings.write");
    const r = await retryNotification(str(formData, "id"));
    revalidatePath("/admin/thong-bao");
    return r.ok ? ok("Đã gửi") : fail(r.error);
  });
}

export type ZaloUsersState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; users: { userId: string; name: string }[] };

export async function zaloUsersAction(): Promise<ZaloUsersState> {
  try {
    await requirePermission("settings.write");
  } catch {
    return { status: "error", message: "Không có quyền" };
  }
  const r = await listRecentZaloUsers();
  return r.ok ? { status: "ok", users: r.users } : { status: "error", message: r.error };
}
