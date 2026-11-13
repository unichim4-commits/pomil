import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime, formatVnd } from "@/lib/format";
import { requireStaff } from "@/modules/auth/service";
import { listReturns } from "@/modules/sales/returns";
import { RETURN_REASON_LABEL, RETURN_RESOLUTION_LABEL, RETURN_STATUS_LABEL, type ReturnReason, type ReturnResolution, type ReturnStatus } from "@/modules/sales/rules";
import { Badge, Empty, FilterTabs, PageHeader, Table } from "../../_components/ui";
import { returnTone } from "./tone";

export const metadata: Metadata = { title: "Đổi trả" };

const STATUSES = Object.keys(RETURN_STATUS_LABEL) as ReturnStatus[];
const REASONS = Object.keys(RETURN_REASON_LABEL) as ReturnReason[];

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ status?: string; lydo?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const reason = REASONS.find((r) => r === sp.lydo);
  const rows = await listReturns({ status, reason });
  const href = (p: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = { status, lydo: reason };
    const qs = new URLSearchParams(Object.entries({ ...base, ...p }).filter((e): e is [string, string] => !!e[1]));
    return `/admin/ban-hang/doi-tra${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <Link href="/admin/ban-hang" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Bán hàng
      </Link>
      <PageHeader title="Đổi trả" description="Tạo yêu cầu từ trang đơn đã giao (nút Tạo đổi trả). Luồng: yêu cầu → duyệt → nhận hàng → hoàn tất (hoàn tiền hoặc gửi đơn đổi)." />
      <FilterTabs
        active={status ?? "all"}
        items={[{ key: "all", label: "Tất cả", href: href({ status: undefined }) }, ...STATUSES.map((s) => ({ key: s, label: RETURN_STATUS_LABEL[s], href: href({ status: s }) }))]}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href={href({ lydo: undefined })} className={`inline-flex min-h-11 items-center border px-3 ${reason ? "border-line" : "border-graphite"}`}>
          Mọi lý do
        </Link>
        {REASONS.map((r) => (
          <Link key={r} href={href({ lydo: r })} className={`inline-flex min-h-11 items-center border px-3 ${reason === r ? "border-graphite" : "border-line"}`}>
            {RETURN_REASON_LABEL[r]}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>Chưa có đổi trả nào khớp bộ lọc.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Mã</th>
              <th>Đơn</th>
              <th>Lý do</th>
              <th>Cách giải quyết</th>
              <th>Tiền hoàn</th>
              <th>Trạng thái</th>
              <th>Lúc tạo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, orderCode, recipientName, channel }) => (
              <tr key={r.id} className="hover:bg-bone">
                <td>
                  <Link href={`/admin/ban-hang/doi-tra/${r.id}`} className="font-mono underline-offset-4 hover:underline">
                    {r.code}
                  </Link>
                </td>
                <td>
                  <span className="font-mono">{orderCode}</span>
                  <span className="block text-xs text-ink-soft">
                    {recipientName} · {channel}
                  </span>
                </td>
                <td>{RETURN_REASON_LABEL[r.reason as ReturnReason]}</td>
                <td>{RETURN_RESOLUTION_LABEL[r.resolution as ReturnResolution]}</td>
                <td className="tabular-nums">{formatVnd(r.refundAmount)}</td>
                <td>
                  <Badge tone={returnTone(r.status)}>{RETURN_STATUS_LABEL[r.status as ReturnStatus]}</Badge>
                </td>
                <td className="whitespace-nowrap text-ink-soft">{formatDateTime(r.requestedAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
