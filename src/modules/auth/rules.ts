// Phân quyền quản trị. Hàm thuần để test được.

export type StaffRole = "owner" | "collaborator" | "viewer";

export type Permission =
  | "orders.write"
  | "products.write"
  | "content.write"
  | "lots.write"
  | "complaints.write"
  | "customers.write"
  | "customers.view_phone"
  | "settings.write"
  | "staff.manage"
  | "audit.view"
  | "reviews.write";

const COLLABORATOR: readonly Permission[] = [
  "orders.write",
  "products.write",
  "content.write",
  "lots.write",
  "complaints.write",
  "customers.write",
  "customers.view_phone",
  "reviews.write",
];

export const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Chủ cửa hàng",
  collaborator: "Cộng tác viên",
  viewer: "Chỉ xem",
};

export function can(role: StaffRole, permission: Permission): boolean {
  if (role === "owner") return true;
  if (role === "collaborator") return COLLABORATOR.includes(permission);
  return false;
}

export const SESSION_DAYS = 14;
// Phiên mới qua mật khẩu, còn chờ mã 2 lớp: hết hạn sau 10 phút
export const MFA_PENDING_MINUTES = 10;

// Phiên chỉ dùng được khi chưa hết hạn, tài khoản còn hoạt động, và đã qua bước 2 lớp nếu có bật.
export function sessionUsable(input: {
  expiresAt: Date;
  mfaPassed: boolean;
  staffActive: boolean;
  totpEnabled: boolean;
  now?: Date;
}): { ok: true } | { ok: false; reason: "expired" | "inactive" | "mfa_required" } {
  const now = input.now ?? new Date();
  if (input.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (!input.staffActive) return { ok: false, reason: "inactive" };
  if (input.totpEnabled && !input.mfaPassed) return { ok: false, reason: "mfa_required" };
  return { ok: true };
}
