import type { CashFilter } from "@/modules/finance/cash";
import { isIsoDate } from "@/modules/finance/rules";

export type SP = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Bộ lọc danh sách thu chi từ query string (dùng chung cho trang và CSV)
export function cashFilterFrom(sp: SP): CashFilter {
  const status = one(sp.trang_thai);
  const origin = one(sp.nguon);
  const direction = one(sp.loai);
  return {
    accountId: one(sp.tk) || undefined,
    categoryId: one(sp.hm) || undefined,
    from: isIsoDate(one(sp.tu)) ? one(sp.tu) : undefined,
    to: isIsoDate(one(sp.den)) ? one(sp.den) : undefined,
    status: status === "pending_approval" || status === "posted" || status === "cancelled" ? status : undefined,
    origin: origin === "manual" || origin === "auto" ? origin : undefined,
    direction: direction === "in" || direction === "out" || direction === "transfer" ? direction : undefined,
    page: Math.max(1, Number(one(sp.trang)) || 1),
  };
}
