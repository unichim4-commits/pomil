import { vnToday } from "@/modules/numbering";
import { addDays, type Granularity } from "@/modules/sales/rules";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

function valid(d: string | null | undefined): d is string {
  return !!d && ISO.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
}

// Kỳ báo cáo từ query (không chứa dữ liệu cá nhân): from, to (gồm cả ngày cuối), g = day|week|month.
// Mặc định 30 ngày gần nhất; kỳ dài hơn 366 ngày bị cắt.
export function parseReportParams(get: (k: string) => string | null | undefined) {
  const today = vnToday();
  let to = get("to");
  if (!valid(to)) to = today;
  let from = get("from");
  if (!valid(from)) from = addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (addDays(from, MAX_DAYS - 1) < to) from = addDays(to, -(MAX_DAYS - 1));
  const raw = get("g");
  const g: Granularity = raw === "week" || raw === "month" ? raw : "day";
  return { from, to, toExclusive: addDays(to, 1), g };
}
