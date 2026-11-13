import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listRecalls, RECALL_STATUS_LABEL } from "@/modules/qms/admin";
import { QMS_DISCLAIMER, SEVERITY_LABEL } from "@/modules/qms/rules";
import { Badge, Empty, PageHeader, Table } from "../../_components/ui";

export const metadata: Metadata = { title: "Thu hồi" };

export default async function RecallListPage() {
  const [staff, rows] = await Promise.all([requireStaff(), listRecalls()]);
  return (
    <>
      <PageHeader
        title="Thu hồi"
        description="Khóa lô, chuyển tồn sang kho cách ly, lập danh sách đơn cần liên hệ. Phần mềm không tự gửi tin cho khách."
        actions={
          can(staff.role, "quality.approve") && (
            <Link href="/admin/chat-luong/thu-hoi/moi" className="btn btn-primary min-h-11">
              Mở thu hồi
            </Link>
          )
        }
      />
      <p className="mb-6 border border-line bg-pith/40 p-3 text-xs text-ink-soft">{QMS_DISCLAIMER}</p>
      {rows.length === 0 ? (
        <Empty>Chưa có hồ sơ thu hồi nào.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Mã</th>
              <th>Lý do</th>
              <th>Mức độ</th>
              <th>Mở lúc</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/chat-luong/thu-hoi/${r.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                    {r.code}
                  </Link>
                </td>
                <td>{r.reason}</td>
                <td>{SEVERITY_LABEL[r.severity]}</td>
                <td className="text-ink-soft">{formatDateTime(r.openedAt)}</td>
                <td>
                  <Badge tone={r.status === "closed" ? "green" : "amber"}>{RECALL_STATUS_LABEL[r.status]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
