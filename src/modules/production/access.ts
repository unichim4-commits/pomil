// Sản xuất: người thao tác và kiểm quyền ở tầng service (Server Action đã kiểm requirePermission;
// service kiểm lại để test gọi thẳng và để không có đường ghi nào bỏ qua quyền).
import { eq } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { settings } from "@/db/schema";
import { can, type Permission, type StaffRole } from "@/modules/auth/rules";
import { PermissionError } from "@/modules/auth/service";
import { ERP_SETTINGS_KEY, parseErpSettings, type ErpSettings } from "@/modules/settings/erp-schema";

export type Actor = { id: string; role: StaffRole };

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) throw new PermissionError();
}

export const STALE = "Chứng từ vừa được người khác cập nhật, tải lại trang.";

export async function readErpSettings(db: Db | Tx): Promise<ErpSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, ERP_SETTINGS_KEY)).limit(1);
  return parseErpSettings(row?.value);
}
