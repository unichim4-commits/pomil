import type { Metadata } from "next";
import Link from "next/link";
import { displayPhone, formatDateTime, formatVnd } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/modules/orders/rules";
import { countOrdersByStatus, listOrders, ORDER_PAGE_SIZE } from "@/modules/orders/service";
import { Badge, Empty, FilterTabs, ORDER_TONE, PageHeader, Pagination, Table } from "../_components/ui";

export const metadata: Metadata = { title: "Đơn hàng" };

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];

type Props = { searchParams: Promise<{ status?: string; q?: string; page?: string }> };

export default async function OrdersPage({ searchParams }: Props) {
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as OrderStatus) ? (sp.status as OrderStatus) : undefined;
  const page = Number(sp.page) || 1;
  const [staff, { rows, total }, counts] = await Promise.all([requireStaff(), listOrders({ status, q: sp.q, page }), countOrdersByStatus()]);
  const showPhone = can(staff.role, "customers.view_phone");
  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  const href = (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries({ status, q: sp.q, ...params }).filter((e): e is [string, string] => !!e[1]));
    return `/admin/don-hang${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Đơn hàng" description="Đơn đi tới theo thứ tự: chờ xác nhận → đã xác nhận → đóng gói → đang giao → đã giao. Hủy được trước khi giao." />
      <FilterTabs
        active={status ?? "all"}
        items={[
          { key: "all", label: "Tất cả", count: all, href: href({ status: undefined, page: undefined }) },
          ...STATUSES.map((s) => ({ key: s, label: ORDER_STATUS_LABEL[s], count: counts[s] ?? 0, href: href({ status: s, page: undefined }) })),
        ]}
      />
      <form className="mb-4 flex max-w-md gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <input name="q" defaultValue={sp.q} placeholder="Mã đơn, tên hoặc số điện thoại" className="field min-h-11 text-sm" />
        <button className="btn btn-outline min-h-11">Tìm</button>
      </form>

      {rows.length === 0 ? (
        <Empty>Không có đơn nào khớp bộ lọc.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Mã đơn</th>
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
                <td>
                  {o.recipientName}
                  <span className="block text-xs text-ink-soft">{showPhone ? displayPhone(o.phoneE164) : maskPhone(o.phoneE164)}</span>
                </td>
                <td className="text-ink-soft">{o.province}</td>
                <td className="tabular-nums">{formatVnd(o.total)}</td>
                <td>
                  <span className="text-xs">{o.paymentMethod === "cod" ? "COD" : "Chuyển khoản"}</span>
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
