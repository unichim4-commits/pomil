// Người thao tác trong service Bán hàng: service tự kiểm quyền cho các quy tắc phụ thuộc quyền
// (sửa đơn giá, chiết khấu tay vượt ngưỡng, hoàn tiền…), Server Action vẫn gọi requirePermission trước.
import { UserError } from "@/lib/errors";
import { can, type Permission, type StaffRole } from "@/modules/auth/rules";

export type Actor = { id: string; role: StaffRole };

export const NO_PERMISSION = "Tài khoản của bạn không có quyền làm việc này.";

export function assertCan(actor: Actor, permission: Permission, message = NO_PERMISSION): void {
  if (!can(actor.role, permission)) throw new UserError(message);
}
