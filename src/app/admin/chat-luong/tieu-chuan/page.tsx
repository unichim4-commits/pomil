import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { APPLIES_TO_LABEL, STANDARD_STATUS_LABEL } from "@/modules/qms/admin";
import { QMS_DISCLAIMER } from "@/modules/qms/rules";
import { listStandards } from "@/modules/qms/standards";
import { Badge, Empty, PageHeader, Table } from "../../_components/ui";

export const metadata: Metadata = { title: "Tiêu chuẩn chất lượng" };

const TONE = { draft: "amber", active: "green", archived: "neutral" } as const;

export default async function StandardsPage() {
  const [staff, rows] = await Promise.all([requireStaff(), listStandards()]);
  const groups = Object.keys(APPLIES_TO_LABEL) as (keyof typeof APPLIES_TO_LABEL)[];
  return (
    <>
      <PageHeader
        title="Tiêu chuẩn chất lượng"
        description="Chỉ tiêu và giới hạn cho từng nhóm hàng. Mỗi lần đổi giới hạn là một phiên bản mới; phiếu cũ giữ giới hạn đã chép."
        actions={
          can(staff.role, "quality.write") && (
            <Link href="/admin/chat-luong/tieu-chuan/moi" className="btn btn-primary min-h-11">
              Tạo tiêu chuẩn
            </Link>
          )
        }
      />
      <p className="mb-6 border border-line bg-pith/40 p-3 text-xs text-ink-soft">{QMS_DISCLAIMER}</p>
      {rows.length === 0 ? (
        <Empty>Chưa có tiêu chuẩn nào. Phiếu kiểm vẫn tạo được, thêm chỉ tiêu tự do trên phiếu.</Empty>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => {
            const list = rows.filter((r) => r.appliesTo === g);
            if (list.length === 0) return null;
            return (
              <section key={g}>
                <h2 className="eyebrow mb-3 text-[0.68rem]">{APPLIES_TO_LABEL[g]}</h2>
                <Table>
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Tên</th>
                      <th>Gắn với</th>
                      <th>Hiệu lực từ</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link href={`/admin/chat-luong/tieu-chuan/${s.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                            {s.code} v{s.version}
                          </Link>
                        </td>
                        <td>{s.name}</td>
                        <td className="text-ink-soft">{s.itemCode ?? s.productName ?? "Dùng chung"}</td>
                        <td>{formatDate(s.effectiveFrom)}</td>
                        <td>
                          <Badge tone={TONE[s.status]}>{STANDARD_STATUS_LABEL[s.status]}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
