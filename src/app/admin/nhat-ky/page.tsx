import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { AUDIT_PAGE_SIZE, listAudit } from "@/modules/auth/staff";
import { PageHeader, Table } from "../_components/ui";

export const metadata: Metadata = { title: "Nhật ký thao tác" };

const ACTION: Record<string, string> = {
  "order.created": "Khách đặt đơn",
  "order.status": "Đổi trạng thái đơn",
  "order.payment": "Đổi thanh toán",
  "order.assign_lot": "Gán lô cho đơn",
  "customer.created": "Tạo khách",
  "customer.stage": "Đổi giai đoạn khách",
  "consent.withdrawn": "Khách dừng nhận tin",
  "product.created": "Tạo sản phẩm",
  "product.updated": "Sửa sản phẩm",
  "content.created": "Tạo nội dung",
  "content.updated": "Sửa nội dung",
  "content.deleted": "Xóa nội dung",
  "settings.updated": "Sửa cài đặt",
  "lot.created": "Tạo lô",
  "lot.released": "Duyệt xuất kho",
  "lot.auto_hold": "Tự giữ lô (ngưỡng phản ánh)",
  "lot.hold": "Giữ lô",
  "lot.unhold": "Mở lại lô",
  "lot.public_info": "Sửa trang lô",
  "lot.test_added": "Thêm phiếu kiểm nghiệm",
  "lot.test_result": "Đổi kết quả kiểm nghiệm",
  "notification.added": "Thêm phiếu công bố",
  "complaint.updated": "Cập nhật phản ánh",
  "staff.created": "Tạo nhân viên",
  "staff.updated": "Sửa nhân viên",
  "staff.password_changed": "Đổi mật khẩu",
  "staff.totp_enabled": "Bật 2 lớp",
  "staff.totp_disabled": "Tắt 2 lớp",
};

function summarize(v: Record<string, unknown> | null): string {
  if (!v) return "";
  return Object.entries(v)
    .filter(([, x]) => x !== undefined && x !== null && typeof x !== "object")
    .slice(0, 4)
    .map(([k, x]) => `${k}: ${String(x)}`)
    .join(" · ");
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const me = await requireStaff();
  if (!can(me.role, "audit.view")) redirect("/admin");
  const page = Number((await searchParams).page) || 1;
  const rows = await listAudit(page);

  return (
    <>
      <PageHeader title="Nhật ký thao tác" description="Mọi thay đổi quan trọng: ai làm, lúc nào, trước và sau. Không sửa, không xóa được." />
      <Table>
        <thead>
          <tr>
            <th>Lúc</th>
            <th>Người làm</th>
            <th>Việc</th>
            <th>Chi tiết</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-ink-soft">{formatDateTime(r.at)}</td>
              <td>{r.actorEmail ?? <span className="text-ink-soft">Hệ thống / khách</span>}</td>
              <td>{ACTION[r.action] ?? r.action}</td>
              <td className="text-xs text-ink-soft">
                {summarize(r.before) && <span className="block">Trước: {summarize(r.before)}</span>}
                {summarize(r.after) && <span className="block">Sau: {summarize(r.after)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-4 flex justify-between text-sm">
        {page > 1 ? <Link href={`/admin/nhat-ky?page=${page - 1}`}>← Mới hơn</Link> : <span />}
        {rows.length === AUDIT_PAGE_SIZE && <Link href={`/admin/nhat-ky?page=${page + 1}`}>Cũ hơn →</Link>}
      </div>
    </>
  );
}
