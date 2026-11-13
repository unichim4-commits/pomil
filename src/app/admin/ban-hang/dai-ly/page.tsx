import type { Metadata } from "next";
import Link from "next/link";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listDealers } from "@/modules/sales/dealers";
import { DEALER_STATUS_LABEL, formatBp, formatIsoDate, type DealerStatus } from "@/modules/sales/rules";
import { Badge, Empty, PageHeader, Table } from "../../_components/ui";

export const metadata: Metadata = { title: "Đại lý" };

export default async function DealersPage() {
  const [staff, rows] = await Promise.all([requireStaff(), listDealers()]);
  return (
    <>
      <Link href="/admin/ban-hang" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Bán hàng
      </Link>
      <PageHeader
        title="Đại lý"
        description="Hợp đồng, bảng giá riêng, chiết khấu, hoa hồng và hạn mức công nợ. Đơn công nợ vượt hạn mức bị chặn khi tạo và khi xác nhận."
        actions={
          can(staff.role, "sales.write") ? (
            <Link href="/admin/ban-hang/dai-ly/moi" className="btn btn-primary min-h-11">
              Thêm đại lý
            </Link>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <Empty>Chưa có đại lý nào.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Đại lý</th>
              <th>Cấp</th>
              <th>Chiết khấu · hoa hồng</th>
              <th>Đang nợ / hạn mức</th>
              <th>Hợp đồng</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-bone">
                <td>
                  <Link href={`/admin/ban-hang/dai-ly/${d.id}`} className="underline-offset-4 hover:underline">
                    {d.name}
                  </Link>
                  <span className="block font-mono text-xs text-ink-soft">{d.code}</span>
                </td>
                <td>{d.tier || "—"}</td>
                <td className="tabular-nums">
                  {formatBp(d.discountBp)} · {formatBp(d.commissionBp)}
                </td>
                <td className={`tabular-nums ${d.creditLimit > 0 && d.outstanding > d.creditLimit ? "text-danger" : ""}`}>
                  {formatVnd(d.outstanding)} / {formatVnd(d.creditLimit)}
                </td>
                <td className="text-sm">
                  {d.contractEnd ? `đến ${formatIsoDate(d.contractEnd)}` : "—"}
                  {d.expired && (
                    <span className="block">
                      <Badge tone="red">Hết hạn</Badge>
                    </span>
                  )}
                  {!d.expired && d.endingSoon && (
                    <span className="block">
                      <Badge tone="amber">Sắp hết hạn</Badge>
                    </span>
                  )}
                </td>
                <td>
                  <Badge tone={d.status === "active" ? "green" : "neutral"}>{DEALER_STATUS_LABEL[d.status as DealerStatus]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
