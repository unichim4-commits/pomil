"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/service";
import { ACTION_STATUS, ISSUE_TAGS, pickKeys, type ActionStatus } from "@/modules/reviews/rules";
import { setReviewStatus } from "@/modules/reviews/service";
import { fail, guard, ok, optStr, str, type ActionResult } from "../_lib/result";

export async function reviewStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("reviews.write");
    const status = str(formData, "status");
    if (status !== "new" && status !== "published" && status !== "hidden") return fail("Trạng thái không hợp lệ");
    const actionStatus = str(formData, "actionStatus");
    if (actionStatus && !(actionStatus in ACTION_STATUS)) return fail("Trạng thái xử lý không hợp lệ");
    await setReviewStatus({
      id: str(formData, "id"),
      status,
      staffNote: optStr(formData, "staffNote"),
      staffId: staff.id,
      issueTags: pickKeys(ISSUE_TAGS, formData.getAll("issueTags")),
      actionStatus: (actionStatus || undefined) as ActionStatus | undefined,
      actionTaken: optStr(formData, "actionTaken"),
    });
    revalidatePath("/admin/danh-gia");
    revalidatePath("/san-pham", "layout");
    return ok(status === "published" ? "Đã hiện trên web." : "Đã lưu.");
  });
}
