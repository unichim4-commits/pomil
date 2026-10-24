import { UserError } from "@/lib/errors";
import { logError } from "@/lib/log";
import { PermissionError } from "@/modules/auth/service";

export type ActionResult = { status: "idle" } | { status: "ok"; message: string; at: number } | { status: "error"; message: string };

export const IDLE: ActionResult = { status: "idle" };

export function ok(message: string): ActionResult {
  return { status: "ok", message, at: Date.now() };
}

export function fail(message: string): ActionResult {
  return { status: "error", message };
}

export const UNEXPECTED_ERROR = "Có lỗi, thử lại sau. Nếu lặp lại, báo kỹ thuật kèm thời điểm.";

// Bọc thân Server Action: lỗi quyền và lỗi bất ngờ đổi thành câu báo, không làm sập trang.
// Chỉ lỗi nghiệp vụ có chủ ý (UserError, PermissionError) mới hiện nguyên câu; lỗi khác (có thể chứa
// câu SQL và dữ liệu khách) chỉ hiện câu chung và ghi log đã lọc.
export async function guard(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PermissionError || error instanceof UserError) return fail(error.message);
    // redirect() và notFound() của Next ném lỗi đặc biệt: phải để nó đi tiếp
    if (error && typeof error === "object" && "digest" in error) throw error;
    logError("admin action", error);
    return fail(UNEXPECTED_ERROR);
  }
}

export function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export function optStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v === "" ? null : v;
}
