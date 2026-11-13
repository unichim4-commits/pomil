// Cảnh báo tài chính cho Tổng quan (00-tong-quan.md mục 8.7; 05-tai-chinh.md R-TC-30). Chỉ trả khi can(role, "finance.view").
import { and, eq, isNull, lt } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { productionOrders, settings } from "@/db/schema";
import { formatVnd } from "@/lib/format";
import { can, type StaffRole } from "@/modules/auth/rules";
import type { AdminAlert } from "@/modules/alerts";
import { vnToday } from "@/modules/numbering";
import { ERP_SETTINGS_KEY, parseErpSettings } from "@/modules/settings/erp-schema";
import { activeBudgetsOn, getBudgetReport } from "./budgets";
import { listPendingRequests } from "./cash";
import { listPayables, listReceivables } from "./debts";
import { cashForecast } from "./reports";
import { addDaysIso, BUDGET_GROUP_LABEL, shortageText, vnStartOf } from "./rules";

export type { AdminAlert };

export async function getAlerts(role: StaffRole): Promise<AdminAlert[]> {
  if (!can(role, "finance.view")) return [];
  const db = await getDb();
  return computeFinanceAlerts(db, role, vnToday());
}

// Tách riêng để test truyền "hôm nay"
export async function computeFinanceAlerts(db: Db, role: StaffRole, today: string): Promise<AdminAlert[]> {
  if (!can(role, "finance.view")) return [];
  const out: AdminAlert[] = [];
  const [cfgRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, ERP_SETTINGS_KEY));
  const cfg = parseErpSettings(cfgRow?.value);

  // Phải thu quá hạn
  const recs = await listReceivables(db, { today, dueSoonDays: cfg.debtDueSoonDays, status: "open_all" });
  const overdueRec = recs.filter((r) => r.overdueDays > 0);
  if (overdueRec.length) {
    out.push({ module: "tai-chinh", level: "danger", text: `${overdueRec.length} khoản phải thu quá hạn, tổng ${formatVnd(overdueRec.reduce((a, r) => a + r.remaining, 0))}`, href: "/admin/tai-chinh/cong-no?the=phai-thu", count: overdueRec.length });
  }

  // Phải trả quá hạn / sắp đến hạn
  const pays = await listPayables(db, { today, dueSoonDays: cfg.debtDueSoonDays, status: "open_all" });
  const overduePay = pays.filter((p) => p.overdueDays > 0);
  const soonPay = pays.filter((p) => p.dueSoon);
  if (overduePay.length) {
    out.push({ module: "tai-chinh", level: "danger", text: `${overduePay.length} khoản phải trả quá hạn, tổng ${formatVnd(overduePay.reduce((a, r) => a + r.remaining, 0))}`, href: "/admin/tai-chinh/cong-no?the=phai-tra", count: overduePay.length });
  }
  if (soonPay.length) {
    out.push({ module: "tai-chinh", level: "warn", text: `${soonPay.length} khoản phải trả đến hạn trong ${cfg.debtDueSoonDays} ngày, tổng ${formatVnd(soonPay.reduce((a, r) => a + r.remaining, 0))}`, href: "/admin/tai-chinh/cong-no?the=phai-tra", count: soonPay.length });
  }

  // Ngân sách ≥ 80% hoặc vượt
  for (const b of await activeBudgetsOn(db, today)) {
    const report = await getBudgetReport(db, b.id, cfg.budgetWarnBp);
    for (const l of report?.lines ?? []) {
      if (l.tone === "green") continue;
      const label = l.categoryName ?? BUDGET_GROUP_LABEL[l.group];
      out.push({
        module: "tai-chinh",
        level: l.tone === "red" ? "danger" : "warn",
        text: l.tone === "red" ? `${label} vượt ${formatVnd(l.over)} (${b.name})` : `${label} đã dùng ${Math.round((l.ratioBp ?? 0) / 100)}% ngân sách (${b.name})`,
        href: `/admin/tai-chinh/ngan-sach/${b.id}`,
      });
    }
  }

  // Dự báo thiếu tiền
  const fc = await cashForecast(db, { today, weeks: cfg.forecastWeeks, minCash: cfg.minCashAlert });
  const first = fc.shortages[0];
  if (first) out.push({ module: "tai-chinh", level: "danger", text: shortageText(first), href: "/admin/tai-chinh/dong-tien" });

  // Đề nghị chi chờ duyệt
  const pending = await listPendingRequests(db);
  if (pending.length) {
    out.push({ module: "tai-chinh", level: "info", text: `${pending.length} đề nghị chi chờ duyệt, tổng ${formatVnd(pending.reduce((a, p) => a + p.amount, 0))}`, href: "/admin/tai-chinh/thu-chi?trang-thai=pending_approval", count: pending.length });
  }

  // Lệnh hoàn thành quá 30 ngày chưa chốt giá vốn
  const stale = await db
    .select({ id: productionOrders.id })
    .from(productionOrders)
    .where(and(eq(productionOrders.status, "completed"), isNull(productionOrders.costLockedAt), lt(productionOrders.finishedAt, vnStartOf(addDaysIso(today, -30)))));
  if (stale.length) out.push({ module: "tai-chinh", level: "warn", text: `${stale.length} lệnh sản xuất hoàn thành quá 30 ngày chưa chốt giá vốn`, href: "/admin/tai-chinh/gia-von", count: stale.length });

  return out;
}
