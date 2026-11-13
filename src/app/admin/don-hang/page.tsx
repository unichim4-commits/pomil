import type { Metadata } from "next";
import Link from "next/link";
import { displayPhone, formatDateTime, formatVnd } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/modules/orders/rules";
import { countOrdersByStatus, listOrders, ORDER_PAGE_SIZE } from "@/modules/orders/service";
import { listChannels } from "@/modules/sales/catalog";
import { listDealers } from "@/modules/sales/dealers";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/modules/sales/rules";
import { Badge, Empty, FilterTabs, ORDER_TONE, PageHeader, Pagination, Table } from "../_components/ui";

export const metadata: Metadata = { title: "Đơn hàng" };

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];

type Props = { searchParams: Promise<{ status?: string; q?: string; page?: string; kenh?: string; daily?: string; tt?: string }> };
const PAY = ["unpaid", "paid", "refunded"] as const;

export default async function OrdersPage({ searchParams }: Props) {
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as OrderStatus) ? (sp.status as OrderStatus) : undefined;
  const page = Number(sp.page) || 1;
  const paymentStatus = PAY.find((p) => p === sp.tt);
  const [staff, { rows, total }, counts, channels, dealers] = await Promise.all([
    requireStaff(),
    listOrders({ status, q: sp.q, page, channel: sp.kenh || undefined, dealerId: sp.daily || undefined, paymentStatus }),
    countOrdersByStatus(),
    listChannels(),
    listDealers(),
  ]);
  const showPhone = can(staff.role, "customers.view_phone");
  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  const href = (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries({ status, q: sp.q, kenh: sp.kenh, daily: sp.daily, tt: paymentStatus, ...params }).filter((e): e is [string, string] => !!e[1]));
    return `/admin/don-hang${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Đơn hàng"
        description="Đơn đi tới theo thứ tự: chờ xác nhận → đã xác nhận → đóng gói → đang giao → đã giao. Hủy được trước khi giao."
        actions={
          can(staff.role, "sales.write") ? (
            <Link href="/admin/don-hang/moi" className="btn btn-primary min-h-11">
              Tạo đơn
            </Link>
          ) : null
        }
      />
      <FilterTabs
        active={status ?? "all"}
        items={[
          { key: "all", label: "Tất cả", count: all, href: href({ status: undefined, page: undefined }) },
          ...STATUSES.map((s) => ({ key: s, label: ORDER_STATUS_LABEL[s], count: counts[s] ?? 0, href: href({ status: s, page: undefined }) })),
        ]}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <input name="q" defaultValue={sp.q} placeholder="Mã đơn, mã sàn, tên hoặc số điện thoại" className="field min-h-11 min-w-0 flex-1 basis-60 text-sm" />
        <select name="kenh" defaultValue={sp.kenh ?? ""} className="field min-h-11 w-auto text-sm" aria-label="Kênh">
          <option value="">Mọi kênh</option>
          {channels.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="daily" defaultValue={sp.daily ?? ""} className="field min-h-11 w-auto text-sm" aria-label="Đại lý">
          <option value="">Mọi đại lý</option>
          {dealers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} · {d.name}
            </option>
          ))}
        </select>
        <select name="tt" defaultValue={paymentStatus ?? ""} className="field min-h-11 w-auto text-sm" aria-label="Thanh toán">
          <option value="">Mọi trạng thái tiền</option>
          <option value="unpaid">Chưa trả</option>
          <option value="paid">Đã trả</option>
          <option value="refunded">Đã hoàn</option>
        </select>
        <button className="btn btn-outline min-h-11">Lọc</button>
      </form>

      {rows.length === 0 ? (
        <Empty>Không có đơn nào khớp bộ lọc.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Mã đơn</th>
              <th>Kênh</th>
              <th>Khách</th>
              <th>Giao tới</th>
              <th>Tổng</th>
              <th>Thanh toán</th>
              <th>Trạng thái</th>
              <th>Lúc đặt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-bone">
                <td>
                  <Link href={`/admin/don-hang/${o.id}`} className="font-mono underline-offset-4 hover:underline">
                    {o.code}
                  </Link>
                </td>
                <td className="text-xs">
                  {o.channel}
                  {o.externalRef && <span className="block font-mono text-ink-soft">{o.externalRef}</span>}
                </td>
                <td>
                  {o.recipientName}
                  <span className="block text-xs text-ink-soft">{showPhone ? displayPhone(o.phoneE164) : maskPhone(o.phoneE164)}</span>
                </td>
                <td className="text-ink-soft">{o.province}</td>
                <td className="tabular-nums">{formatVnd(o.total)}</td>
                <td>
                  <span className="text-xs">{PAYMENT_METHOD_LABEL[o.paymentMethod as PaymentMethod] ?? o.paymentMethod}</span>
                  <span className="block">
                    <Badge tone={o.paymentStatus === "paid" ? "green" : o.paymentStatus === "refunded" ? "red" : "neutral"}>
                      {o.paymentStatus === "paid" ? "Đã trả" : o.paymentStatus === "refunded" ? "Đã hoàn" : "Chưa trả"}
                    </Badge>
                  </span>
                </td>
                <td>
                  <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                </td>
                <td className="whitespace-nowrap text-ink-soft">{formatDateTime(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} total={total} pageSize={ORDER_PAGE_SIZE} hrefFor={(p) => href({ page: String(p) })} />
    </>
  );
}
