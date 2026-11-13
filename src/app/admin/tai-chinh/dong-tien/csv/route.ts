import { getDb } from "@/db/client";
import { cashFlowActual, cashForecast } from "@/modules/finance/reports";
import { vnToday } from "@/modules/numbering";
import { getErpSettings } from "@/modules/settings/service";
import { csvResponse } from "../../_csv";
import { readPeriod } from "../../_shared";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = readPeriod({ ky: url.searchParams.get("ky") ?? undefined, ngay: url.searchParams.get("ngay") ?? undefined });
  const forecast = url.searchParams.get("bang") === "du-bao";
  return csvResponse(forecast ? "du-bao-dong-tien" : `dong-tien-${p.start}`, async () => {
    const db = await getDb();
    if (forecast) {
      const cfg = await getErpSettings();
      const f = await cashForecast(db, { today: vnToday(), weeks: cfg.forecastWeeks, minCash: cfg.minCashAlert });
      return {
        headers: ["Tuần", "Từ", "Đến", "Đầu tuần", "Dự thu", "Dự chi", "Cuối tuần"],
        rows: f.weeks.map((w) => [w.week, w.from, w.to, w.opening, w.inflow, w.outflow, w.closing]),
      };
    }
    const flows = await cashFlowActual(db, { from: p.from, to: p.to });
    const rows: (string | number)[][] = [];
    for (const a of flows) {
      rows.push([a.name, "Đầu kỳ", "", a.opening]);
      for (const x of a.inflows) rows.push([a.name, "Thu", x.category, x.amount]);
      for (const x of a.outflows) rows.push([a.name, "Chi", x.category, -x.amount]);
      if (a.transferIn) rows.push([a.name, "Chuyển vào", "", a.transferIn]);
      if (a.transferOut) rows.push([a.name, "Chuyển ra", "", -a.transferOut]);
      rows.push([a.name, "Cuối kỳ", "", a.closing]);
    }
    return { headers: ["Tài khoản", "Dòng", "Hạng mục", "Số tiền"], rows };
  });
}
