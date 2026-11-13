import { getDb } from "@/db/client";
import { channelReport, profitAndLoss, profitByProduct } from "@/modules/finance/reports";
import { periodBounds, PNL_ROWS } from "@/modules/finance/rules";
import { csvResponse } from "../../_csv";
import { readPeriod } from "../../_shared";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = readPeriod({ ky: url.searchParams.get("ky") ?? undefined, ngay: url.searchParams.get("ngay") ?? undefined });
  const bang = url.searchParams.get("bang") ?? "tong";
  const range = { from: p.from, to: p.to };
  return csvResponse(`lai-lo-${bang}-${p.start}`, async () => {
    const db = await getDb();
    if (bang === "san-pham") {
      const { rows } = await profitByProduct(db, range);
      return {
        headers: ["Sản phẩm", "Số lượng", "Doanh thu", "Chiết khấu", "Trả lại", "Giá vốn", "Phí sàn", "Lãi"],
        rows: rows.map((r) => [r.productName, r.quantity, r.revenue, r.discount, r.returns, r.cogs, r.platformFee, r.profit]),
      };
    }
    if (bang === "kenh") {
      const rows = await channelReport(db, range);
      return {
        headers: ["Kênh", "Đơn", "Doanh thu thuần", "Giá vốn", "Phí sàn", "Đóng góp", "Marketing", "Sau marketing", "Doanh thu trên 1đ marketing"],
        rows: rows.map((c) => [c.channelName, c.orders, c.netRevenue, c.cogs, c.platformFee, c.contribution, c.marketing, c.afterMarketing, c.revenuePerMarketing === null ? "" : c.revenuePerMarketing.toFixed(2)]),
      };
    }
    const [cur, prev] = await Promise.all([profitAndLoss(db, range), profitAndLoss(db, periodBounds(p.period, p.prevStart))]);
    return {
      headers: ["Chỉ tiêu", p.label, "Kỳ trước"],
      rows: [
        ...PNL_ROWS.map((r) => [r.label, cur[r.key] as number, prev[r.key] as number]),
        ["Biên lợi nhuận ròng (bp)", cur.marginBp, prev.marginBp],
        ["Chi sản xuất chung chưa vào giá thành", cur.capitalizedNotInCost, prev.capitalizedNotInCost],
        ["Dòng thiếu giá vốn", cur.missingCostLines, prev.missingCostLines],
      ],
    };
  });
}
