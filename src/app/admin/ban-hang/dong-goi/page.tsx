import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { requireStaff } from "@/modules/auth/service";
import { buildPickList, listPackedAwaitingShipment, listPackingQueue } from "@/modules/sales/packing";
import { formatIsoDate } from "@/modules/sales/rules";
import { Badge, Card, Empty, ORDER_TONE, PageHeader, Table } from "../../_components/ui";
import { ORDER_STATUS_LABEL } from "@/modules/orders/rules";

export const metadata: Metadata = { title: "Đóng gói" };

type Props = { searchParams: Promise<{ don?: string | string[] }> };

// R-BH-12: chọn nhiều đơn → phiếu lấy hàng gộp theo sản phẩm, gợi ý lô FEFO và vị trí
export default async function PackingQueuePage({ searchParams }: Props) {
  await requireStaff();
  const sp = await searchParams;
  const chosen = (Array.isArray(sp.don) ? sp.don : sp.don ? [sp.don] : []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const [queue, packed, pick] = await Promise.all([listPackingQueue(), listPackedAwaitingShipment(), buildPickList(chosen)]);

  return (
    <>
      <Link href="/admin/ban-hang" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Bán hàng
      </Link>
      <PageHeader title="Đóng gói" description="Chọn các đơn cần gói để in phiếu lấy hàng gộp. Mở từng đơn để tích đủ hàng và xuất kho theo hạn dùng (hết hạn trước xuất trước)." />

      {pick.products.length > 0 && (
        <Card title={`Phiếu lấy hàng · ${pick.orders.length} đơn`} className="mb-6">
          <Table>
            <thead>
              <tr>
                <th>Sản phẩm</th>
                <th>Số chai</th>
                <th>Lấy ở lô (vị trí)</th>
              </tr>
            </thead>
            <tbody>
              {pick.products.map((p) => (
                <tr key={p.productId}>
                  <td>
                    {p.name}
                    <span className="block font-mono text-xs text-ink-soft">{p.code}</span>
                  </td>
                  <td className="tabular-nums">{p.qty}</td>
                  <td className="text-sm">
                    {!p.track ? (
                      <span className="text-ink-soft">Chưa quản lý theo kho: gán lô ở trang đơn</span>
                    ) : p.suggestion ? (
                      p.suggestion.map((s) => (
                        <span key={s.stockLotId} className="block">
                          <span className="font-mono">{s.code}</span> × {s.qty} · {s.locations.join(", ")}
                          {s.expiresOn ? ` · hạn ${formatIsoDate(s.expiresOn)}` : ""}
                        </span>
                      ))
                    ) : (
                      <span className="text-danger">Thiếu hàng: kho thành phẩm dùng được còn {p.available}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <ul className="mt-4 space-y-1 text-sm">
            {pick.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/ban-hang/dong-goi/${o.id}`} className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4">
                  <span className="font-mono">{o.code}</span>
                  <span className="text-ink-soft">{o.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Chờ đóng gói · ${queue.length}`} className="mb-6">
        {queue.length === 0 ? (
          <Empty>Không có đơn nào chờ đóng gói.</Empty>
        ) : (
          <form method="get">
            <ul className="divide-y divide-line">
              {queue.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3 py-2">
                  <label className="flex min-h-11 min-w-11 items-center">
                    <input type="checkbox" name="don" value={o.id} defaultChecked={chosen.includes(o.id)} className="size-5" aria-label={`Chọn ${o.code}`} />
                  </label>
                  <Link href={`/admin/ban-hang/dong-goi/${o.id}`} className="font-mono underline-offset-4 hover:underline">
                    {o.code}
                  </Link>
                  <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                  <span className="min-w-0 flex-1 text-sm text-ink-soft">{o.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}</span>
                  <span className="text-xs text-ink-soft">{formatDateTime(o.createdAt)}</span>
                </li>
              ))}
            </ul>
            <button className="btn btn-primary mt-4 min-h-11">Lập phiếu lấy hàng</button>
          </form>
        )}
      </Card>

      <Card title={`Đã gói, chờ giao vận chuyển · ${packed.length}`}>
        {packed.length === 0 ? (
          <p className="text-sm text-ink-soft">Không có đơn nào.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {packed.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-4">
                <Link href={`/admin/don-hang/${o.id}`} className="inline-flex min-h-11 items-center font-mono underline-offset-4 hover:underline">
                  {o.code}
                </Link>
                <span className="text-ink-soft">{o.trackingNo ? `Vận đơn ${o.trackingNo}` : "Chưa có mã vận đơn"}</span>
                <span className="ml-auto flex gap-4">
                  <Link href={`/admin/ban-hang/dong-goi/${o.id}/phieu`} target="_blank" className="inline-flex min-h-11 items-center underline underline-offset-4">
                    Phiếu
                  </Link>
                  <Link href={`/admin/ban-hang/dong-goi/${o.id}/nhan`} target="_blank" className="inline-flex min-h-11 items-center underline underline-offset-4">
                    Nhãn
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
