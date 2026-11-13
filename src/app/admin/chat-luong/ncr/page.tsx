import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listNcrs } from "@/modules/qms/admin";
import { NCR_CATEGORY_LABEL, NCR_STATUS_LABEL, SEVERITY_LABEL, isOverdue, type NcrSeverity, type NcrStatus } from "@/modules/qms/rules";
import { vnToday } from "@/modules/numbering";
import { Badge, Empty, FilterTabs, PageHeader, Table } from "../../_components/ui";

export const metadata: Metadata = { title: "Sai lỗi (NCR)" };

const SEV_TONE = { minor: "neutral", major: "amber", critical: "red" } as const;

export default async function NcrListPage({ searchParams }: { searchParams: Promise<{ status?: string; muc?: string; han?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && sp.status in NCR_STATUS_LABEL ? (sp.status as NcrStatus) : undefined;
  const severity = sp.muc && sp.muc in SEVERITY_LABEL ? (sp.muc as NcrSeverity) : undefined;
  const today = vnToday();
  const overdue = sp.han === "qua-han";
  const [staff, rows] = await Promise.all([requireStaff(), listNcrs({ status, severity, overdueOn: overdue ? today : undefined })]);
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, muc: severity, han: overdue ? "qua-han" : undefined, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/chat-luong/ncr${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Sai lỗi (NCR)"
        description="Ghi nhận sai lỗi từ phiếu kiểm, phản ánh, đổi trả. NCR nghiêm trọng cần CAPA trước khi đóng."
        actions={
          can(staff.role, "quality.write") && (
            <Link href="/admin/chat-luong/ncr/moi" className="btn btn-primary min-h-11">
              Tạo NCR
            </Link>
          )
        }
      />
      <FilterTabs
        active={overdue ? "overdue" : (status ?? "all")}
        items={[
          { key: "all", label: "Tất cả", href: href({ status: undefined, han: undefined }) },
          { key: "overdue", label: "Quá hạn", href: href({ status: undefined, han: "qua-han" }) },
          ...(Object.keys(NCR_STATUS_LABEL) as NcrStatus[]).map((s) => ({ key: s, label: NCR_STATUS_LABEL[s], href: href({ status: s, han: undefined }) })),
        ]}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {(Object.keys(SEVERITY_LABEL) as NcrSeverity[]).map((s) => (
          <Link key={s} href={href({ muc: severity === s ? undefined : s })} className={`inline-flex min-h-11 items-center border px-3 ${severity === s ? "border-graphite" : "border-line text-ink-soft"}`}>
            {SEVERITY_LABEL[s]}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>Không có NCR nào.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tiêu đề</th>
              <th>Loại</th>
              <th>Mức độ</th>
              <th>Hạn</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const late = isOverdue(n.dueOn, today, n.status === "closed" || n.status === "cancelled");
              return (
                <tr key={n.id}>
                  <td>
                    <Link href={`/admin/chat-luong/ncr/${n.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                      {n.code}
                    </Link>
                  </td>
                  <td>
                    {n.title}
                    {n.lotNo && <span className="block font-mono text-xs text-ink-soft">{n.lotNo}</span>}
                  </td>
                  <td className="text-ink-soft">{NCR_CATEGORY_LABEL[n.category]}</td>
                  <td>
                    <Badge tone={SEV_TONE[n.severity]}>{SEVERITY_LABEL[n.severity]}</Badge>
                  </td>
                  <td className={late ? "text-danger" : ""}>{formatDate(n.dueOn)}</td>
                  <td>
                    <Badge tone={n.status === "closed" ? "green" : n.status === "cancelled" ? "neutral" : "amber"}>{NCR_STATUS_LABEL[n.status]}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
