import type { Metadata } from "next";
import Link from "next/link";
import { displayPhone, formatDate, formatVnd } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { countByStage, CUSTOMER_PAGE_SIZE, listCustomers, STAGE_LABEL } from "@/modules/customers/admin";
import { Badge, Empty, FilterTabs, PageHeader, Pagination, Table } from "../_components/ui";

export const metadata: Metadata = { title: "Khách hàng" };

type Stage = keyof typeof STAGE_LABEL;
const STAGES = Object.keys(STAGE_LABEL) as Stage[];

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string; page?: string }> }) {
  const sp = await searchParams;
  const stage = STAGES.includes(sp.stage as Stage) ? (sp.stage as Stage) : undefined;
  const page = Number(sp.page) || 1;
  const [staff, { rows, total }, counts] = await Promise.all([requireStaff(), listCustomers({ q: sp.q, stage, page }), countByStage()]);
  const showPhone = can(staff.role, "customers.view_phone");
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const href = (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries({ stage, q: sp.q, ...params }).filter((e): e is [string, string] => !!e[1]));
    return `/admin/khach-hang${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Khách hàng" description="Gộp theo số điện thoại. Người đăng ký chờ và người mua chung một hồ sơ. Chỉ số quan trọng nhất: số khách mua lần 2." />
      <FilterTabs
        active={stage ?? "all"}
        items={[
          { key: "all", label: "Tất cả", count: all, href: href({ stage: undefined, page: undefined }) },
          ...STAGES.filter((s) => (counts[s] ?? 0) > 0 || s === "repeat_buyer").map((s) => ({ key: s, label: STAGE_LABEL[s], count: counts[s] ?? 0, href: href({ stage: s, page: undefined }) })),
        ]}
      />
      <form className="mb-4 flex max-w-md gap-2">
        {stage && <input type="hidden" name="stage" value={stage} />}
        <input name="q" defaultValue={sp.q} placeholder="Tên, số điện thoại hoặc mã giới thiệu" className="field min-h-10 py-1.5 text-sm" />
        <button className="btn btn-outline min-h-10 py-1.5">Tìm</button>
      </form>
      {rows.length === 0 ? (
        <Empty>Chưa có khách nào khớp.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Khách</th>
              <th>Giai đoạn</th>
              <th>Số đơn</th>
              <th>Đã chi</th>
              <th>Từ ngày</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-bone">
                <td>
                  <Link href={`/admin/khach-hang/${c.id}`} className="underline-offset-4 hover:underline">
                    {c.name || "(chưa có tên)"}
                  </Link>
                  <span className="block text-xs text-ink-soft">{c.phoneE164 ? (showPhone ? displayPhone(c.phoneE164) : maskPhone(c.phoneE164)) : ""}</span>
                </td>
                <td>
                  <Badge tone={c.stage === "repeat_buyer" || c.stage === "ambassador" ? "green" : c.stage === "lead" ? "amber" : "neutral"}>{STAGE_LABEL[c.stage]}</Badge>
                </td>
                <td className="tabular-nums">{c.orders}</td>
                <td className="tabular-nums">{formatVnd(c.spent)}</td>
                <td className="text-ink-soft">{formatDate(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} total={total} pageSize={CUSTOMER_PAGE_SIZE} hrefFor={(p) => href({ page: String(p) })} />
    </>
  );
}
