import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { formatVnd } from "@/lib/format";
import { channelReport, profitAndLoss, profitByProduct } from "@/modules/finance/reports";
import { changeBp, formatBpPct, periodBounds, PNL_ROWS } from "@/modules/finance/rules";
import { Card, Empty, PageHeader, Table } from "../../_components/ui";
import { CsvLink, LegalNotice, Money, PeriodPicker, readPeriod, requireFinanceView } from "../_shared";

export const metadata: Metadata = { title: "Lãi lỗ" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const NEGATIVE_ROWS = new Set(["discount", "returns", "cogs", "selling", "marketing", "admin", "otherExpense", "tax"]);

export default async function PnlPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireFinanceView();
  const sp = await searchParams;
  const p = readPeriod({ ky: one(sp.ky), ngay: one(sp.ngay) });
  const db = await getDb();
  const prev = periodBounds(p.period, p.prevStart);
  const [cur, before, byProduct, byChannel] = await Promise.all([
    profitAndLoss(db, { from: p.from, to: p.to }),
    profitAndLoss(db, prev),
    profitByProduct(db, { from: p.from, to: p.to }),
    channelReport(db, { from: p.from, to: p.to }),
  ]);
  const csv = (bang: string) => `/admin/tai-chinh/lai-lo/csv?bang=${bang}&ky=${p.period}&ngay=${p.start}`;

  return (
    <>
      <PageHeader title={`Lãi lỗ · ${p.label}`} description="Ghi nhận theo ngày giao hàng. Đơn chưa giao không vào doanh thu." actions={<CsvLink href={csv("tong")} />} />
      <LegalNotice />
      <PeriodPicker basePath="/admin/tai-chinh/lai-lo" period={p.period} start={p.start} prevStart={p.prevStart} nextStart={p.to} />

      {cur.missingCostLines > 0 && (
        <p className="mb-4 border border-[#e3cf9f] bg-[#f1e2c4] p-3 text-sm text-[#6b4e12]">Dòng thiếu giá vốn: {cur.missingCostLines}. Các dòng đơn này chưa gắn lô kho, giá vốn tính 0.</p>
      )}

      <Card title={`Báo cáo lãi lỗ · ${cur.orderCount} đơn đã giao`} className="mb-6">
        <Table>
          <thead>
            <tr>
              <th>Chỉ tiêu</th>
              <th className="text-right">{p.label}</th>
              <th className="text-right">Kỳ trước</th>
              <th className="text-right">Thay đổi</th>
            </tr>
          </thead>
          <tbody>
            {PNL_ROWS.map((r) => {
              const v = cur[r.key] as number;
              const pv = before[r.key] as number;
              const sign = NEGATIVE_ROWS.has(r.key) ? -1 : 1;
              return (
                <tr key={r.key} className={r.strong ? "bg-bone" : ""}>
                  <td className={r.strong ? "font-medium" : ""}>{r.label}</td>
                  <td className="text-right">
                    <Money value={sign * v} className={r.strong ? "font-medium" : ""} />
                  </td>
                  <td className="text-right text-ink-soft">
                    <Money value={sign * pv} />
                  </td>
                  <td className="text-right text-xs">{formatBpPct(changeBp(v, pv))}</td>
                </tr>
              );
            })}
            <tr>
              <td>Biên lợi nhuận ròng</td>
              <td className="text-right tabular-nums">{cur.marginBp === null ? "—" : formatBpPct(cur.marginBp, { signed: false })}</td>
              <td className="text-right tabular-nums text-ink-soft">{before.marginBp === null ? "—" : formatBpPct(before.marginBp, { signed: false })}</td>
              <td></td>
            </tr>
          </tbody>
        </Table>
        {cur.capitalizedNotInCost !== 0 && (
          <p className="mt-3 text-sm text-ink-soft">
            Ghi chú: chi sản xuất chung {formatVnd(cur.capitalizedNotInCost)} trong kỳ chưa phân bổ vào giá thành, không tính vào lãi lỗ. Phân bổ ở trang Giá vốn.
          </p>
        )}
      </Card>

      <Card title="Theo sản phẩm" className="mb-6" actions={<CsvLink href={csv("san-pham")} />}>
        {byProduct.rows.length === 0 ? (
          <Empty>Chưa có đơn giao trong kỳ.</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Sản phẩm</th>
                  <th className="text-right">SL</th>
                  <th className="text-right">Doanh thu</th>
                  <th className="text-right">Chiết khấu</th>
                  <th className="text-right">Trả lại</th>
                  <th className="text-right">Giá vốn</th>
                  <th className="text-right">Phí sàn</th>
                  <th className="text-right">Lãi</th>
                </tr>
              </thead>
              <tbody>
                {byProduct.rows.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.productName}</td>
                    <td className="text-right tabular-nums">{r.quantity}</td>
                    <td className="text-right"><Money value={r.revenue} /></td>
                    <td className="text-right"><Money value={-r.discount} /></td>
                    <td className="text-right"><Money value={-r.returns} /></td>
                    <td className="text-right"><Money value={-r.cogs} /></td>
                    <td className="text-right"><Money value={-r.platformFee} /></td>
                    <td className="text-right"><Money value={r.profit} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-ink-soft">Thu phí giao {formatVnd(byProduct.shippingIncome)} không chia cho sản phẩm.</p>
          </>
        )}
      </Card>

      <Card title="Theo kênh" actions={<CsvLink href={csv("kenh")} />}>
        {byChannel.length === 0 ? (
          <Empty>Chưa có số liệu kênh trong kỳ.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Kênh</th>
                <th className="text-right">Đơn</th>
                <th className="text-right">Doanh thu thuần</th>
                <th className="text-right">Giá vốn</th>
                <th className="text-right">Phí sàn</th>
                <th className="text-right">Đóng góp</th>
                <th className="text-right">Marketing</th>
                <th className="text-right">Sau marketing</th>
                <th className="text-right">Doanh thu / 1đ marketing</th>
              </tr>
            </thead>
            <tbody>
              {byChannel.map((c) => (
                <tr key={c.channel || "none"}>
                  <td>{c.channelName}</td>
                  <td className="text-right tabular-nums">{c.orders}</td>
                  <td className="text-right"><Money value={c.netRevenue} /></td>
                  <td className="text-right"><Money value={-c.cogs} /></td>
                  <td className="text-right"><Money value={-c.platformFee} /></td>
                  <td className="text-right"><Money value={c.contribution} /></td>
                  <td className="text-right"><Money value={-c.marketing} /></td>
                  <td className="text-right"><Money value={c.afterMarketing} /></td>
                  <td className="text-right tabular-nums">{c.revenuePerMarketing === null ? "—" : c.revenuePerMarketing.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
