// Cảnh báo Bán hàng cho Tổng quan (00-tong-quan.md mục 8.7, R-BH-10).
import { and, inArray, lt, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dealers, orders, returnRequests } from "@/db/schema";
import type { StaffRole } from "@/modules/auth/rules";
import type { AdminAlert } from "@/modules/alerts";
import { vnToday } from "@/modules/numbering";
import { awaitsPackingSql } from "./packing-sql";
import { contractEndingSoon, formatIsoDate } from "./rules";

export type { AdminAlert };

export async function getAlerts(role: StaffRole): Promise<AdminAlert[]> {
  void role;
  const db = await getDb();
  const today = vnToday();
  const out: AdminAlert[] = [];

  const dealerRows = await db.select({ id: dealers.id, name: dealers.name, contractEnd: dealers.contractEnd }).from(dealers).where(sql`${dealers.status} = 'active'`);
  for (const d of dealerRows) {
    if (contractEndingSoon(d.contractEnd, today)) out.push({ module: "ban-hang", level: "warn", text: `Hợp đồng đại lý ${d.name} hết hạn ngày ${formatIsoDate(d.contractEnd!)}`, href: `/admin/ban-hang/dai-ly/${d.id}` });
    else if (d.contractEnd && d.contractEnd < today) out.push({ module: "ban-hang", level: "danger", text: `Hợp đồng đại lý ${d.name} đã hết hạn, chưa tạo đơn được`, href: `/admin/ban-hang/dai-ly/${d.id}` });
  }

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(inArray(orders.status, ["pending"]), lt(orders.createdAt, dayAgo)));
  if (Number(pending?.n ?? 0) > 0) out.push({ module: "ban-hang", level: "warn", text: `${pending!.n} đơn chờ xác nhận quá 1 ngày`, href: "/admin/don-hang?status=pending", count: Number(pending!.n) });

  const [toPack] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(awaitsPackingSql);
  if (Number(toPack?.n ?? 0) > 0) out.push({ module: "ban-hang", level: "info", text: `${toPack!.n} đơn chờ đóng gói`, href: "/admin/ban-hang/dong-goi", count: Number(toPack!.n) });

  const [rma] = await db.select({ n: sql<number>`count(*)::int` }).from(returnRequests).where(notInArray(returnRequests.status, ["completed", "rejected", "cancelled"]));
  if (Number(rma?.n ?? 0) > 0) out.push({ module: "ban-hang", level: "info", text: `${rma!.n} đổi trả đang xử lý`, href: "/admin/ban-hang/doi-tra", count: Number(rma!.n) });

  return out;
}
