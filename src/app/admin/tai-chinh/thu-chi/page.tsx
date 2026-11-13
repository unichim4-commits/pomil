import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { CASH_PAGE_SIZE, listAccountsWithBalance, listCashTransactions, listCategories } from "@/modules/finance/cash";
import { CASH_STATUS_LABEL, SOURCE_LABEL } from "@/modules/finance/rules";
import { Badge, Empty, FilterTabs, PageHeader, Pagination, Table, type BadgeTone } from "../../_components/ui";
import { CsvLink, LegalNotice, Money } from "../_shared";
import { cashFilterFrom, one, type SP } from "./_filter";

export const metadata: Metadata = { title: "Thu chi" };

const STATUS_TONE: Record<string, BadgeTone> = { pending_approval: "amber", posted: "green", cancelled: "red" };
const DIR_LABEL = { in: "Thu", out: "Chi", transfer: "Chuyển quỹ" } as const;

export default async function CashListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireStaff();
  const canView = can(me.role, "finance.view");
  const mine = one(sp["cua-toi"]) === "1";
  // Cộng tác viên (finance.request) chỉ xem đề nghị chi của mình
  if (!canView) {
    if (!can(me.role, "finance.request")) redirect("/admin");
    if (!mine) redirect("/admin/tai-chinh/thu-chi?cua-toi=1");
  }
  const db = await getDb();
  const filter = cashFilterFrom(sp);
  if (mine) filter.createdBy = me.id;
  const [{ rows, total }, accounts, categories] = await Promise.all([
    listCashTransactions(db, filter),
    canView ? listAccountsWithBalance(db) : Promise.resolve([]),
    canView ? listCategories(db) : Promise.resolve([]),
  ]);

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (one(v)) p.set(k, one(v));
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const s = p.toString();
    return `/admin/tai-chinh/thu-chi${s ? `?${s}` : ""}`;
  };
  const csvQs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (one(v) && k !== "trang") csvQs.set(k, one(v));

  return (
    <>
      <PageHeader
        title={mine ? "Đề nghị chi của tôi" : "Thu chi"}
        description={
          mine
            ? "Đề nghị chi bạn đã lập. Chủ duyệt xong thì phiếu mới trừ tiền."
            : "Mọi phiếu thu, phiếu chi, chuyển quỹ. Phiếu tự sinh từ đơn, kho, sản xuất mở về chứng từ gốc."
        }
        actions={
          can(me.role, "finance.write") ? (
            <>
              <Link href="/admin/tai-chinh/thu-chi/moi?loai=thu" className="btn btn-outline min-h-11">
                Phiếu thu
              </Link>
              <Link href="/admin/tai-chinh/thu-chi/moi?loai=chi" className="btn btn-outline min-h-11">
                Phiếu chi
              </Link>
              <Link href="/admin/tai-chinh/thu-chi/moi?loai=chuyen" className="btn btn-primary min-h-11">
                Chuyển quỹ
              </Link>
              <CsvLink href={`/admin/tai-chinh/thu-chi/csv?${csvQs.toString()}`} />
            </>
          ) : (
            <Link href="/admin/tai-chinh/thu-chi/moi?loai=chi" className="btn btn-primary min-h-11">
              Lập đề nghị chi
            </Link>
          )
        }
      />
      <LegalNotice />

      {canView && (
        <>
          <FilterTabs
            active={mine ? "mine" : (filter.status ?? "all")}
            items={[
              { key: "all", label: "Tất cả", href: qs({ trang_thai: undefined, "cua-toi": undefined, trang: undefined }) },
              { key: "pending_approval", label: "Chờ duyệt", href: qs({ trang_thai: "pending_approval", "cua-toi": undefined, trang: undefined }) },
              { key: "posted", label: "Đã ghi", href: qs({ trang_thai: "posted", "cua-toi": undefined, trang: undefined }) },
              { key: "cancelled", label: "Đã hủy", href: qs({ trang_thai: "cancelled", "cua-toi": undefined, trang: undefined }) },
              { key: "mine", label: "Của tôi", href: qs({ "cua-toi": "1", trang_thai: undefined, trang: undefined }) },
            ]}
          />
          <form method="get" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {filter.status && <input type="hidden" name="trang_thai" value={filter.status} />}
            {mine && <input type="hidden" name="cua-toi" value="1" />}
            <label className="text-sm">
              <span className="field-label">Tài khoản</span>
              <select name="tk" defaultValue={filter.accountId ?? ""} className="field min-h-11 w-full">
                <option value="">Tất cả</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="field-label">Hạng mục</span>
              <select name="hm" defaultValue={filter.categoryId ?? ""} className="field min-h-11 w-full">
                <option value="">Tất cả</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.direction === "in" ? "Thu" : "Chi"} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="field-label">Loại</span>
              <select name="loai" defaultValue={filter.direction ?? ""} className="field min-h-11 w-full">
                <option value="">Tất cả</option>
                <option value="in">Thu</option>
                <option value="out">Chi</option>
                <option value="transfer">Chuyển quỹ</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="field-label">Nguồn</span>
              <select name="nguon" defaultValue={filter.origin ?? ""} className="field min-h-11 w-full">
                <option value="">Tất cả</option>
                <option value="manual">Phiếu tay</option>
                <option value="auto">Tự sinh</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="field-label">Từ ngày</span>
              <input type="date" name="tu" defaultValue={filter.from ?? ""} className="field min-h-11 w-full" />
            </label>
            <label className="text-sm">
              <span className="field-label">Đến ngày</span>
              <input type="date" name="den" defaultValue={filter.to ?? ""} className="field min-h-11 w-full" />
            </label>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
              <button className="btn btn-primary min-h-11">Lọc</button>
              <Link href="/admin/tai-chinh/thu-chi" className="btn btn-outline min-h-11">
                Bỏ lọc
              </Link>
            </div>
          </form>
        </>
      )}

      {rows.length === 0 ? (
        <Empty>{mine ? "Bạn chưa lập đề nghị chi nào." : "Không có phiếu nào khớp bộ lọc."}</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Mã</th>
              <th>Ngày</th>
              <th>Loại</th>
              <th>Tài khoản</th>
              <th>Hạng mục</th>
              <th>Đối tượng</th>
              <th>Nguồn</th>
              <th className="text-right">Số tiền</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/tai-chinh/thu-chi/${r.id}`} className="inline-flex min-h-11 items-center font-mono underline-offset-4 hover:underline">
                    {r.code}
                  </Link>
                </td>
                <td className="whitespace-nowrap">{formatDate(r.occurredOn)}</td>
                <td>{DIR_LABEL[r.direction]}</td>
                <td>{r.direction === "transfer" ? `${r.accountName} → ${r.toAccountName ?? ""}` : r.accountName}</td>
                <td>{r.categoryName ?? "—"}</td>
                <td>{r.counterpartyName || "—"}</td>
                <td className="text-xs text-ink-soft">
                  {r.sourceType && r.sourceType !== "manual" ? `${SOURCE_LABEL[r.sourceType] ?? r.sourceType}${r.sourceCode ? ` ${r.sourceCode}` : ""}` : "Phiếu tay"}
                </td>
                <td className="text-right">
                  <Money value={r.direction === "out" ? -r.amount : r.amount} />
                </td>
                <td>
                  <Badge tone={STATUS_TONE[r.status]}>{CASH_STATUS_LABEL[r.status]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={filter.page ?? 1} total={total} pageSize={CASH_PAGE_SIZE} hrefFor={(p) => qs({ trang: String(p) })} />
    </>
  );
}
