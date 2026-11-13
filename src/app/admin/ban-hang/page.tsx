import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { vnToday } from "@/modules/numbering";
import { countExpiringVouchers } from "@/modules/sales/catalog";
import { dealersEndingSoon } from "@/modules/sales/dealers";
import { listPackedAwaitingShipment, listPackingQueue } from "@/modules/sales/packing";
import { getSalesReport } from "@/modules/sales/reports";
import { countOpenReturns } from "@/modules/sales/returns";
import { addDays, formatPercent } from "@/modules/sales/rules";
import { Card, PageHeader, Stat } from "../_components/ui";

export const metadata: Metadata = { title: "Bán hàng" };

const SECTIONS = [
  { href: "/admin/don-hang/moi", label: "Tạo đơn tay", hint: "Sàn, Zalo, Facebook, đại lý, bán trực tiếp", perm: "sales.write" },
  { href: "/admin/ban-hang/dong-goi", label: "Đóng gói", hint: "Phiếu lấy hàng, xuất kho theo hạn dùng, in phiếu và nhãn", perm: null },
  { href: "/admin/ban-hang/doi-tra", label: "Đổi trả", hint: "Yêu cầu, duyệt, nhận hàng, hoàn tiền hoặc đổi hàng", perm: null },
  { href: "/admin/ban-hang/dai-ly", label: "Đại lý", hint: "Hợp đồng, hạn mức công nợ, chiết khấu, hoa hồng", perm: null },
  { href: "/admin/ban-hang/kenh", label: "Kênh bán", hint: "Phí nền tảng, số ngày tiền về", perm: null },
  { href: "/admin/ban-hang/bang-gia", label: "Bảng giá, combo, mã giảm giá", hint: "Giá theo kênh hoặc đại lý", perm: null },
  { href: "/admin/ban-hang/bao-cao", label: "Báo cáo bán hàng", hint: "Theo ngày, kênh, sản phẩm, đại lý", perm: null },
] as const;

export default async function SalesHomePage() {
  const staff = await requireStaff();
  const db = await getDb();
  const today = vnToday();
  const from = addDays(today, -29);
  const [queue, packed, openReturns, expiring, ending, report] = await Promise.all([
    listPackingQueue(),
    listPackedAwaitingShipment(),
    countOpenReturns(),
    countExpiringVouchers(db),
    dealersEndingSoon(),
    getSalesReport({ from, toExclusive: addDays(today, 1), granularity: "day", withCost: false }),
  ]);

  return (
    <>
      <PageHeader title="Bán hàng" description="Đơn mọi kênh, đóng gói, đổi trả, đại lý và giá. Số liệu 30 ngày gần nhất, tính theo ngày đặt." />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Doanh số 30 ngày" value={formatVnd(report.summary.revenue)} hint={`${report.summary.orders} đơn`} href="/admin/ban-hang/bao-cao" />
        <Stat label="Giá trị đơn trung bình" value={formatVnd(report.summary.aov)} hint={`Thành công ${formatPercent(report.successRate)}`} />
        <Stat label="Chờ đóng gói" value={String(queue.length)} hint={`${packed.length} đơn đã gói chờ giao`} href="/admin/ban-hang/dong-goi" />
        <Stat label="Đổi trả đang mở" value={String(openReturns)} hint={`Tỷ lệ hoàn ${formatPercent(report.returnRate)}`} href="/admin/ban-hang/doi-tra" />
      </div>

      {(expiring > 0 || ending.length > 0) && (
        <Card title="Cần để ý" className="mb-6">
          <ul className="space-y-1 text-sm">
            {expiring > 0 && (
              <li>
                <Link href="/admin/ban-hang/bang-gia#ma-giam-gia" className="inline-flex min-h-11 items-center underline underline-offset-4">
                  {expiring} mã giảm giá hết hạn trong 7 ngày
                </Link>
              </li>
            )}
            {ending.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/ban-hang/dai-ly/${d.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                  Hợp đồng đại lý {d.name} hết hạn {d.contractEnd}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.filter((s) => !s.perm || can(staff.role, s.perm)).map((s) => (
          <Link key={s.href} href={s.href} className="block min-h-11 border border-line bg-bone p-5 hover:bg-pith">
            <span className="block font-medium">{s.label}</span>
            <span className="mt-1 block text-sm text-ink-soft">{s.hint}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
