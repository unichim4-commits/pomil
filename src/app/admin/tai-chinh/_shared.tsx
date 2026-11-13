import Link from "next/link";
import { redirect } from "next/navigation";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff, type CurrentStaff } from "@/modules/auth/service";
import { vnToday } from "@/modules/numbering";
import { isIsoDate, LEGAL_NOTICE, normalizePeriodStart, periodBounds, periodLabel, previousPeriodStart, type BudgetPeriod } from "@/modules/finance/rules";
import type { BadgeTone } from "../_components/ui";

// Trang Tài chính cần finance.view (00 mục 5)
export async function requireFinanceView(): Promise<CurrentStaff> {
  const me = await requireStaff();
  if (!can(me.role, "finance.view")) redirect("/admin");
  return me;
}

export function LegalNotice() {
  return (
    <p className="mb-6 border border-line bg-bone p-3 text-sm text-ink-soft" role="note">
      {LEGAL_NOTICE}
    </p>
  );
}

export function Money({ value, signed = false, className = "" }: { value: number; signed?: boolean; className?: string }) {
  const tone = value < 0 ? "text-danger" : "";
  return <span className={`tabular-nums whitespace-nowrap ${tone} ${className}`}>{signed && value > 0 ? "+" : ""}{formatVnd(value)}</span>;
}

export function CsvLink({ href }: { href: string }) {
  return (
    <a href={href} className="btn btn-outline min-h-11 text-xs" download>
      Tải CSV
    </a>
  );
}

export const TONE_OF: Record<"green" | "amber" | "red", BadgeTone> = { green: "green", amber: "amber", red: "red" };

// Kỳ báo cáo từ searchParams: ky=month|quarter|year, ngay=YYYY-MM-DD (mặc định kỳ hiện tại)
export function readPeriod(sp: { ky?: string; ngay?: string }): { period: BudgetPeriod; start: string; from: string; to: string; label: string; prevStart: string } {
  const period: BudgetPeriod = sp.ky === "quarter" || sp.ky === "year" ? sp.ky : "month";
  const day = sp.ngay && isIsoDate(sp.ngay) ? sp.ngay : vnToday();
  const start = normalizePeriodStart(period, day);
  const { from, to } = periodBounds(period, start);
  return { period, start, from, to, label: periodLabel(period, start), prevStart: previousPeriodStart(period, start) };
}

export function PeriodPicker({ basePath, period, start, prevStart, nextStart }: { basePath: string; period: BudgetPeriod; start: string; prevStart: string; nextStart: string }) {
  const q = (p: BudgetPeriod, d: string) => `${basePath}?ky=${p}&ngay=${d}`;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
      {(["month", "quarter", "year"] as const).map((p) => (
        <Link key={p} href={q(p, start)} className={`inline-flex min-h-11 items-center border px-3 ${p === period ? "border-graphite bg-graphite text-bone" : "border-line hover:border-graphite"}`}>
          {p === "month" ? "Tháng" : p === "quarter" ? "Quý" : "Năm"}
        </Link>
      ))}
      <span className="mx-2 h-6 border-l border-line" />
      <Link href={q(period, prevStart)} className="inline-flex min-h-11 items-center border border-line px-3 hover:border-graphite">
        ← Kỳ trước
      </Link>
      <Link href={q(period, nextStart)} className="inline-flex min-h-11 items-center border border-line px-3 hover:border-graphite">
        Kỳ sau →
      </Link>
    </div>
  );
}
