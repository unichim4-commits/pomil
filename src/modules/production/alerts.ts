// Cảnh báo Sản xuất cho Tổng quan (00-tong-quan.md mục 8.7)
import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { extractionRuns, productionOrders, productionPlans } from "@/db/schema";
import type { StaffRole } from "@/modules/auth/rules";
import type { AdminAlert } from "@/modules/alerts";
import { vnToday } from "@/modules/numbering/rules";
import { hasBlockingDeviation } from "@/modules/qms/inspections";

export type { AdminAlert };

export async function getAlerts(role: StaffRole): Promise<AdminAlert[]> {
  void role;
  const db = await getDb();
  const out: AdminAlert[] = [];
  const running = await db.select({ id: productionOrders.id }).from(productionOrders).where(eq(productionOrders.status, "in_progress"));
  let blocked = 0;
  for (const o of running) if (await hasBlockingDeviation(db, { productionOrderId: o.id })) blocked++;
  if (blocked) out.push({ module: "san-xuat", level: "danger", text: `${blocked} lệnh sản xuất tạm dừng do sai lệch IPQC`, href: "/admin/san-xuat", count: blocked });

  const qc = await db.select({ id: productionOrders.id }).from(productionOrders).where(eq(productionOrders.status, "qc"));
  if (qc.length) out.push({ module: "san-xuat", level: "info", text: `${qc.length} lệnh đã ghi sản lượng, chờ FQC để hoàn thành`, href: "/admin/san-xuat/lenh?trang-thai=qc", count: qc.length });

  const waiting = await db.select({ id: productionOrders.id }).from(productionOrders).where(eq(productionOrders.status, "planned"));
  if (waiting.length) out.push({ module: "san-xuat", level: "warn", text: `${waiting.length} lệnh sản xuất chờ duyệt`, href: "/admin/san-xuat/lenh?trang-thai=planned", count: waiting.length });

  const today = vnToday();
  const late = await db
    .select({ id: productionOrders.id })
    .from(productionOrders)
    .where(and(inArray(productionOrders.status, ["approved", "in_progress"]), lt(productionOrders.plannedEnd, today)));
  if (late.length) out.push({ module: "san-xuat", level: "warn", text: `${late.length} lệnh quá ngày kết thúc kế hoạch`, href: "/admin/san-xuat/lenh?trang-thai=active", count: late.length });

  const runs = await db.select({ id: extractionRuns.id }).from(extractionRuns).where(eq(extractionRuns.status, "in_progress"));
  if (runs.length) out.push({ module: "san-xuat", level: "info", text: `${runs.length} mẻ chiết đang chạy`, href: "/admin/san-xuat/chiet-xuat", count: runs.length });

  const plans = await db.select({ id: productionPlans.id }).from(productionPlans).where(and(eq(productionPlans.status, "confirmed"), lt(productionPlans.periodEnd, today)));
  if (plans.length) out.push({ module: "san-xuat", level: "info", text: `${plans.length} kế hoạch đã hết kỳ, chưa đóng`, href: "/admin/san-xuat/ke-hoach", count: plans.length });
  return out;
}
