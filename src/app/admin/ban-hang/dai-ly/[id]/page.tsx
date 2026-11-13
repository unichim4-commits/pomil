import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateTime, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { vnToday } from "@/modules/numbering";
import { ORDER_STATUS_LABEL } from "@/modules/orders/rules";
import { dealerPeriodSales, getDealer } from "@/modules/sales/dealers";
import { addDays, canChangeDealerStatus, DEALER_STATUS_LABEL, formatBp, formatIsoDate, type DealerStatus } from "@/modules/sales/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, ORDER_TONE, PageHeader, Stat, Table } from "../../../_components/ui";
import { dealerStatusAction, saveDealerAction } from "../../actions";
import { DealerFields } from "../dealer-form";

export const metadata: Metadata = { title: "Đại lý" };

const STATUS_ACTION: Record<DealerStatus, string> = { active: "Hợp tác lại", paused: "Tạm dừng", ended: "Kết thúc hợp tác" };

export default async function DealerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, data] = await Promise.all([requireStaff(), getDealer(id)]);
  if (!data) notFound();
  const { dealer: d, orders, receivables, outstanding, priceLists } = data;
  const today = vnToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const month = await dealerPeriodSales(d.id, monthStart, addDays(today, 1), d.commissionBp);
  const canWrite = can(staff.role, "sales.write");
  const status = d.status as DealerStatus;
  const room = d.creditLimit - outstanding.total;

  return (
    <>
      <Link href="/admin/ban-hang/dai-ly" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Đại lý
      </Link>
      <PageHeader
        title={d.name}
        description={`${d.code}${d.tier ? ` · ${d.tier}` : ""}${d.contractNo ? ` · HĐ ${d.contractNo}` : ""}${d.contractEnd ? ` · đến ${formatIsoDate(d.contractEnd)}` : ""}`}
        actions={<Badge tone={status === "active" ? "green" : "neutral"}>{DEALER_STATUS_LABEL[status]}</Badge>}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Đang nợ" value={formatVnd(outstanding.receivable)} hint={`Đơn chưa giao ${formatVnd(outstanding.openOrders)}`} />
        <Stat label="Hạn mức còn" value={d.creditLimit > 0 ? formatVnd(Math.max(0, room)) : "Không cấp nợ"} hint={`Hạn mức ${formatVnd(d.creditLimit)} · nợ ${d.paymentTermsDays} ngày`} />
        <Stat label="Doanh số giao tháng này" value={formatVnd(month.net)} hint={`${month.orders} đơn · hoàn ${formatVnd(month.refunded)}`} />
        <Stat label="Hoa hồng tháng này" value={formatVnd(month.commission)} hint={`${formatBp(d.commissionBp)} trên doanh số trừ hoàn`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card
            title="Đơn gần đây"
            actions={
              <Link href={`/admin/don-hang?daily=${d.id}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
                Tất cả
              </Link>
            }
          >
            {orders.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa có đơn.</p>
            ) : (
              <Table>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/admin/don-hang/${o.id}`} className="font-mono hover:underline">
                          {o.code}
                        </Link>
                      </td>
                      <td className="tabular-nums">{formatVnd(o.total)}</td>
                      <td>
                        <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                      </td>
                      <td className="text-ink-soft">{formatDateTime(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title="Công nợ">
            {receivables.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa có khoản phải thu.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Số tiền</th>
                    <th>Đã thu</th>
                    <th>Hạn</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono">{r.code}</td>
                      <td className="tabular-nums">{formatVnd(r.amount)}</td>
                      <td className="tabular-nums">{formatVnd(r.paidAmount)}</td>
                      <td className={r.dueOn < today && (r.status === "open" || r.status === "partial") ? "text-danger" : ""}>{formatIsoDate(r.dueOn)}</td>
                      <td>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="mt-3 text-xs text-ink-soft">Thu tiền đại lý ở mục Tài chính → Công nợ.</p>
          </Card>
        </div>

        <div className="space-y-6">
          {canWrite ? (
            <Card title="Hồ sơ">
              <ActionForm action={saveDealerAction}>
                <DealerFields dealer={d} priceLists={priceLists} pricing={can(staff.role, "sales.pricing")} />
              </ActionForm>
            </Card>
          ) : (
            <Card title="Hồ sơ">
              <p className="text-sm">
                Chiết khấu {formatBp(d.discountBp)} · hoa hồng {formatBp(d.commissionBp)}
              </p>
            </Card>
          )}
          {canWrite && (
            <Card title="Trạng thái">
              <div className="flex flex-wrap gap-3">
                {(["active", "paused", "ended"] as DealerStatus[])
                  .filter((to) => canChangeDealerStatus(status, to))
                  .map((to) => (
                    <ActionForm
                      key={to}
                      action={dealerStatusAction}
                      submitLabel={STATUS_ACTION[to]}
                      submitClassName={to === "ended" ? "btn border-danger bg-danger text-bone" : "btn btn-outline"}
                      confirm={to === "ended" ? "Kết thúc hợp tác? Không mở lại được, đại lý không đặt đơn mới." : undefined}
                      inline
                    >
                      <input type="hidden" name="dealerId" value={d.id} />
                      <input type="hidden" name="status" value={to} />
                    </ActionForm>
                  ))}
                {status === "ended" && <p className="text-sm text-ink-soft">Đã kết thúc hợp tác.</p>}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
