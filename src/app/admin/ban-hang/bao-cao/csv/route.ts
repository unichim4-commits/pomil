import { requireStaff } from "@/modules/auth/service";
import { getSalesReport, reportCsv } from "@/modules/sales/reports";
import { parseReportParams } from "../params";

// CSV báo cáo bán hàng: theo kỳ, theo kênh, theo sản phẩm. Không có giá vốn hay dữ liệu khách.
export async function GET(request: Request) {
  await requireStaff();
  const sp = new URL(request.url).searchParams;
  const p = parseReportParams((k) => sp.get(k));
  const report = await getSalesReport({ from: p.from, toExclusive: p.toExclusive, granularity: p.g, withCost: false });
  return new Response(reportCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bao-cao-ban-hang-${p.from}-${p.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
