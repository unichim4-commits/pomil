import type { Metadata } from "next";
import Link from "next/link";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getSalesReport } from "@/modules/sales/reports";
import { formatBp, formatIsoDate, formatPercent } from "@/modules/sales/rules";
import { Card, PageHeader, Stat, Table } from "../../_components/ui";
import { parseReportParams } from "./params";

export const metadata: Metadata = { title: "Báo cáo bán hàng" };

const G_LABEL = { day: "Ngày", week: "Tuần", month: "Tháng" } as const;

// Báo cáo bán hàng (R-BH-26…R-BH-30). Doanh số theo ngày đặt; lợi nhuận góp và hoa hồng theo ngày giao.
export default async function SalesReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const p = parseReportParams((k) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  });
  const staff = await requireStaff();
  const withCost = can(staff.role, "finance.view");
  const r = await getSalesReport({ from: p.from, toExclusive: p.toExclusive, granularity: p.g, withCost });
  const csvHref = `/admin/ban-hang/bao-cao/csv?from=${p.from}&to=${p.to}&g=${p.g}`;
  const maxSeries = Math.max(1, ...r.series.map((s) => s.revenue));

  return (
    <>
      <Link href="/admin/ban-hang" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Bán hàng
      </Link>
      <PageHeader
        title="Báo cáo bán hàng"
        description={`${formatIsoDate(p.from)} → ${formatIsoDate(p.to)}. Doanh số = tiền hàng trừ giảm giá, không tính phí giao, đơn hủy và đơn hoàn về.`}
        actions={
          <a href={csvHref} className="btn btn-outline min-h-11">
            Tải CSV
          </a>
        }
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="field-label">Từ ngày</span>
          <input type="date" name="from" defaultValue={p.from} className="field min-h-11" />
        </label>
        <label className="block">
          <span className="field-label">Đến ngày</span>
          <input type="date" name="to" defaultValue={p.to} className="field min-h-11" />
        </label>
        <label className="block">
          <span className="field-label">Nhóm theo</span>
          <select name="g" defaultValue={p.g} className="field min-h-11">
            {(Object.keys(G_LABEL) as (keyof typeof G_LABEL)[]).map((k) => (
              <option key={k} value={k}>
                {G_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary min-h-11">
          Xem
        </button>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Doanh số" value={formatVnd(r.summary.revenue)} hint={`${r.summary.orders} đơn`} />
        <Stat label="Giá trị đơn trung bình" value={formatVnd(r.summary.aov)} />
        <Stat label="Tỷ lệ giao thành công" value={formatPercent(r.successRate)} hint="Đơn đặt trong kỳ đã kết thúc" />
        <Stat label="Tỷ lệ hoàn" value={formatPercent(r.returnRate)} hint="Hoàn về + đổi trả, theo ngày giao" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`Theo ${G_LABEL[p.g].toLowerCase()}`}>
          {r.series.length === 0 ? (
            <p className="text-sm text-ink-soft">Không có đơn trong kỳ.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Kỳ</th>
                  <th>Doanh số</th>
                  <th>Đơn</th>
                  <th>Thành công</th>
                </tr>
              </thead>
              <tbody>
                {r.series.map((s) => (
                  <tr key={s.key}>
                    <td className="whitespace-nowrap">{s.key.length === 10 ? formatIsoDate(s.key) : s.key}</td>
                    <td>
                      <span className="tabular-nums">{formatVnd(s.revenue)}</span>
                      <span className="mt-1 block h-1 bg-graphite" style={{ width: `${Math.round((s.revenue / maxSeries) * 100)}%` }} aria-hidden />
                    </td>
                    <td className="tabular-nums">{s.orders}</td>
                    <td className="tabular-nums">{formatPercent(s.successRate)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Theo kênh">
          {r.byChannel.length === 0 ? (
            <p className="text-sm text-ink-soft">Không có dữ liệu.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Kênh</th>
                  <th>Doanh số</th>
                  <th>Đơn</th>
                  <th>AOV</th>
                </tr>
              </thead>
              <tbody>
                {r.byChannel.map((c) => (
                  <tr key={c.key}>
                    <td>{c.name}</td>
                    <td className="tabular-nums">{formatVnd(c.revenue)}</td>
                    <td className="tabular-nums">{c.orders}</td>
                    <td className="tabular-nums">{formatVnd(c.aov)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Sản phẩm bán chạy">
          {r.byProduct.length === 0 ? (
            <p className="text-sm text-ink-soft">Không có dữ liệu.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Sản phẩm</th>
                  <th>Số chai</th>
                  <th>Tiền hàng</th>
                </tr>
              </thead>
              <tbody>
                {r.byProduct.map((x) => (
                  <tr key={x.productId}>
                    <td>{x.name}</td>
                    <td className="tabular-nums">{x.qty}</td>
                    <td className="tabular-nums">{formatVnd(x.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Theo đại lý">
          {r.byDealer.length === 0 && r.dealerCommissions.length === 0 ? (
            <p className="text-sm text-ink-soft">Không có đơn đại lý trong kỳ.</p>
          ) : (
            <div className="space-y-4">
              {r.byDealer.length > 0 && (
                <Table>
                  <thead>
                    <tr>
                      <th>Đại lý</th>
                      <th>Doanh số đặt</th>
                      <th>Đơn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.byDealer.map((d) => (
                      <tr key={d.key}>
                        <td>{d.name}</td>
                        <td className="tabular-nums">{formatVnd(d.revenue)}</td>
                        <td className="tabular-nums">{d.orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {r.dealerCommissions.length > 0 && (
                <>
                  <p className="eyebrow">Hoa hồng (theo ngày giao, trừ tiền hoàn)</p>
                  <Table>
                    <thead>
                      <tr>
                        <th>Đại lý</th>
                        <th>Giao</th>
                        <th>Hoàn</th>
                        <th>Hoa hồng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.dealerCommissions.map((d) => (
                        <tr key={d.dealerId}>
                          <td>
                            <Link href={`/admin/ban-hang/dai-ly/${d.dealerId}`} className="underline-offset-4 hover:underline">
                              {d.name}
                            </Link>
                          </td>
                          <td className="tabular-nums">{formatVnd(d.net)}</td>
                          <td className="tabular-nums">{formatVnd(d.refunded)}</td>
                          <td className="tabular-nums">
                            {formatVnd(d.commission)} <span className="text-xs text-ink-soft">({formatBp(d.commissionBp)})</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </div>
          )}
        </Card>

        {r.margin && (
          <Card title="Lợi nhuận góp theo kênh" className="xl:col-span-2">
            {r.margin.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa có đơn giao trong kỳ.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Kênh</th>
                    <th>Doanh số giao</th>
                    <th>Phí nền tảng</th>
                    <th>Giá vốn</th>
                    <th>Đã hoàn</th>
                    <th>Lợi nhuận góp</th>
                  </tr>
                </thead>
                <tbody>
                  {r.margin.map((m) => (
                    <tr key={m.key}>
                      <td>{m.name}</td>
                      <td className="tabular-nums">{formatVnd(m.revenue)}</td>
                      <td className="tabular-nums">{formatVnd(m.platformFee)}</td>
                      <td className="tabular-nums">{formatVnd(m.cogs)}</td>
                      <td className="tabular-nums">{formatVnd(m.refunded)}</td>
                      <td className={`tabular-nums ${m.margin < 0 ? "text-danger" : ""}`}>{formatVnd(m.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
