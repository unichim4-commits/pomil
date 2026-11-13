import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { CAPA_TYPE_LABEL, listCapas } from "@/modules/qms/admin";
import { CAPA_STATUS_LABEL, isOverdue, type CapaStatus } from "@/modules/qms/rules";
import { vnToday } from "@/modules/numbering";
import { Badge, Empty, FilterTabs, PageHeader, Table } from "../../_components/ui";

export const metadata: Metadata = { title: "CAPA" };

export default async function CapaListPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && sp.status in CAPA_STATUS_LABEL ? (sp.status as CapaStatus) : undefined;
  const [staff, rows] = await Promise.all([requireStaff(), listCapas({ status })]);
  const today = vnToday();
  return (
    <>
      <PageHeader
        title="CAPA"
        description="Hành động khắc phục, phòng ngừa: các bước, người làm, hạn, và kiểm tra hiệu quả trước khi đóng."
        actions={
          can(staff.role, "quality.write") && (
            <Link href="/admin/chat-luong/capa/moi" className="btn btn-primary min-h-11">
              Tạo CAPA
            </Link>
          )
        }
      />
      <FilterTabs
        active={status ?? "all"}
        items={[
          { key: "all", label: "Tất cả", href: "/admin/chat-luong/capa" },
          ...(Object.keys(CAPA_STATUS_LABEL) as CapaStatus[]).map((s) => ({ key: s, label: CAPA_STATUS_LABEL[s], href: `/admin/chat-luong/capa?status=${s}` })),
        ]}
      />
      {rows.length === 0 ? (
        <Empty>Không có CAPA nào.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tiêu đề</th>
              <th>Loại</th>
              <th>NCR</th>
              <th>Hạn</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/admin/chat-luong/capa/${c.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                    {c.code}
                  </Link>
                </td>
                <td>{c.title}</td>
                <td className="text-ink-soft">{CAPA_TYPE_LABEL[c.type]}</td>
                <td className="font-mono text-xs">{c.ncrCode ?? "—"}</td>
                <td className={isOverdue(c.dueOn, today, c.status === "closed" || c.status === "cancelled") ? "text-danger" : ""}>{formatDate(c.dueOn)}</td>
                <td>
                  <Badge tone={c.status === "closed" ? "green" : c.status === "cancelled" ? "neutral" : "amber"}>{CAPA_STATUS_LABEL[c.status]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
