// Định dạng dùng chung cho các trang Sản xuất
import type { BadgeTone } from "../../_components/ui";
import { DISPLAY_UOM, formatQty, type BaseUom, type DisplayUom } from "@/modules/inventory/rules";
import type { ExtractionStatus, FormulaVersionStatus, PlanStatus, ProductionStatus } from "@/modules/production/rules";

export function qty(n: number | null | undefined, base: string | null | undefined, display?: string | null): string {
  if (n === null || n === undefined || !base) return "—";
  return formatQty(n, base as BaseUom, (display ?? undefined) as DisplayUom | undefined);
}

// Giá trị để điền lại ô số lượng theo đơn vị hiển thị ("1,5")
export function qtyInput(n: number | null | undefined, display: string): string {
  if (n === null || n === undefined) return "";
  const f = DISPLAY_UOM[display as DisplayUom]?.factor ?? 1;
  return (n / f).toLocaleString("vi-VN", { maximumFractionDigits: 6, useGrouping: false });
}

export const ORDER_TONE: Record<ProductionStatus, BadgeTone> = {
  draft: "neutral",
  planned: "neutral",
  approved: "dark",
  in_progress: "amber",
  qc: "amber",
  completed: "green",
  cancelled: "red",
};

export const PLAN_TONE: Record<PlanStatus, BadgeTone> = { draft: "neutral", confirmed: "dark", closed: "green", cancelled: "red" };
export const VERSION_TONE: Record<FormulaVersionStatus, BadgeTone> = { draft: "neutral", trial: "amber", approved: "green", archived: "neutral" };
export const RUN_TONE: Record<ExtractionStatus, BadgeTone> = { draft: "neutral", in_progress: "amber", completed: "green", cancelled: "red" };
export const QC_TONE: Record<string, BadgeTone> = { pending: "amber", passed: "green", failed: "red", cancelled: "neutral" };
export const QC_LABEL: Record<string, string> = { pending: "Chờ kiểm", passed: "Đạt", failed: "Không đạt", cancelled: "Đã hủy" };

export function vnToday(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}
