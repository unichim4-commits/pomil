import type { Metadata } from "next";
import Link from "next/link";
import { asc, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { customers, dealers, suppliers } from "@/db/schema";
import { formatDate, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { listCategories } from "@/modules/finance/cash";
import { DEBT_KIND_SLUG, groupByParty, listPayables, listReceivables, type DebtKind, type DebtRow } from "@/modules/finance/debts";
import { AGING_LABEL, AGING_ORDER, DEBT_STATUS_LABEL, type AgingBucket } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";
import { getErpSettings } from "@/modules/settings/service";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, Empty, FilterTabs, PageHeader, Stat, Table, type BadgeTone } from "../../_components/ui";
import { createPayableAction, createReceivableAction } from "../actions";
import { CsvLink, LegalNotice, Money, requireFinanceView } from "../_shared";

export const metadata: Metadata = { title: "Công nợ" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const STATUS_TONE: Record<string, BadgeTone> = { open: "amber", partial: "amber", paid: "green", cancelled: "neutral" };
const STATUS_FILTERS = ["open_all", "paid", "cancelled", "all"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_FILTER_LABEL: Record<StatusFilter, string> = { open_all: "Còn nợ", paid: "Đã trả đủ", cancelled: "Đã hủy", all: "Tất cả" };

export default async function DebtsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireFinanceView();
  const sp = await searchParams;
  const kind: DebtKind = one(sp.the) === "phai-tra" ? "payable" : "receivable";
  const rawStatus = one(sp.trang_thai) as StatusFilter;
  const statusFilter: StatusFilter = STATUS_FILTERS.includes(rawStatus) ? rawStatus : "open_all";
  const db = await getDb();
  const today = vnToday();
  const cfg = await getErpSettings();
  const opts = { today, dueSoonDays: cfg.debtDueSoonDays };
  const all = kind === "receivable" ? await listReceivables(db, opts) : await listPayables(db, opts);
  const rows = statusFilter === "all" ? all : statusFilter === "open_all" ? all.filter((r) => r.status === "open" || r.status === "partial") : all.filter((r) => r.status === statusFilter);
  const open = all.filter((r) => r.status === "open" || r.status === "partial");
  const groups = groupByParty(all);
  const aging = AGING_ORDER.reduce(
    (acc, b) => ({ ...acc, [b]: open.filter((r) => r.bucket === b).reduce((s, r) => s + r.remaining, 0) }),
    {} as Record<AgingBucket, number>,
  );
  const sum = (xs: DebtRow[]) => xs.reduce((a, r) => a + r.remaining, 0);
  const canWrite = can(me.role, "finance.write");

  const [dealerList, customerList, supplierList, outCategories] = canWrite
    ? await Promise.all([
        db.select({ id: dealers.id, name: dealers.name }).from(dealers).orderBy(asc(dealers.name)),
        db.select({ id: customers.id, name: customers.name }).from(customers).where(isNotNull(customers.name)).orderBy(desc(customers.createdAt)).limit(200),
        db.select({ id: suppliers.id, name: suppliers.name, terms: suppliers.paymentTermsDays }).from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
        listCategories(db, { activeOnly: true, direction: "out" }),
      ])
    : [[], [], [], []];

  const slug = DEBT_KIND_SLUG[kind];
  const tabHref = (k: DebtKind) => `/admin/tai-chinh/cong-no?the=${DEBT_KIND_SLUG[k]}`;

  return (
    <>
      <PageHeader
        title="Công nợ"
        description="Ai nợ mình, mình nợ ai, khoản nào quá hạn. Trả nợ ở đây tự sinh phiếu thu, phiếu chi."
        actions={<CsvLink href={`/admin/tai-chinh/cong-no/csv?the=${slug}&trang_thai=${statusFilter}`} />}
      />
      <LegalNotice />

      <FilterTabs
        active={kind}
        items={[
          { key: "receivable", label: "Phải thu", href: tabHref("receivable") },
          { key: "payable", label: "Phải trả", href: tabHref("payable") },
        ]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label={kind === "receivable" ? "Phải thu còn lại" : "Phải trả còn lại"} value={formatVnd(sum(open))} hint={`${open.length} khoản`} />
        <Stat label="Quá hạn" value={formatVnd(sum(open.filter((r) => r.overdueDays > 0)))} hint={`${open.filter((r) => r.overdueDays > 0).length} khoản`} />
        <Stat label={`Sắp đến hạn (${cfg.debtDueSoonDays} ngày)`} value={formatVnd(sum(open.filter((r) => r.dueSoon)))} hint={`${open.filter((r) => r.dueSoon).length} khoản`} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title="Tuổi nợ">
          <ul className="divide-y divide-line text-sm">
            {AGING_ORDER.map((b) => (
              <li key={b} className="flex items-center justify-between gap-3 py-2">
                <span>{AGING_LABEL[b]}</span>
                <Money value={aging[b]} className={b !== "current" && aging[b] > 0 ? "text-danger" : ""} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Theo đối tượng">
          {groups.length === 0 ? (
            <p className="text-sm text-ink-soft">Không còn khoản nợ nào.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {groups.slice(0, 12).map((g) => (
                <li key={g.partyKey} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {g.partyName} <span className="text-xs text-ink-soft">{g.count} khoản</span>
                  </span>
                  <span className="text-right">
                    <Money value={g.remaining} />
                    {g.overdue > 0 && <span className="ml-2 text-xs text-danger">quá hạn {formatVnd(g.overdue)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={`/admin/tai-chinh/cong-no?the=${slug}&trang_thai=${s}`}
            className={`inline-flex min-h-11 items-center border px-3 ${s === statusFilter ? "border-graphite bg-graphite text-bone" : "border-line hover:border-graphite"}`}
          >
            {STATUS_FILTER_LABEL[s]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>Không có khoản nào.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Mã</th>
              <th>{kind === "receivable" ? "Khách / đại lý" : "Nhà cung cấp"}</th>
              <th>Nguồn</th>
              <th>Ngày ghi</th>
              <th>Hạn</th>
              <th className="text-right">Số nợ</th>
              <th className="text-right">Còn lại</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/tai-chinh/cong-no/${slug}/${r.id}`} className="inline-flex min-h-11 items-center font-mono underline-offset-4 hover:underline">
                    {r.code}
                  </Link>
                </td>
                <td>{r.partyName}</td>
                <td className="text-xs text-ink-soft">{r.sourceLabel}</td>
                <td className="whitespace-nowrap">{formatDate(r.issuedOn)}</td>
                <td className="whitespace-nowrap">
                  {formatDate(r.dueOn)}
                  {r.overdueDays > 0 && <span className="ml-1 text-xs text-danger">quá {r.overdueDays} ngày</span>}
                  {r.dueSoon && <span className="ml-1 text-xs text-[#6b4e12]">sắp đến hạn</span>}
                </td>
                <td className="text-right">
                  <Money value={r.amount} />
                </td>
                <td className="text-right">
                  <Money value={r.remaining} />
                </td>
                <td>
                  <Badge tone={r.overdueDays > 0 ? "red" : STATUS_TONE[r.status]}>{DEBT_STATUS_LABEL[r.status]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {canWrite && (
        <Card title={kind === "receivable" ? "Tạo tay khoản phải thu" : "Tạo tay khoản phải trả"} className="mt-6 max-w-2xl">
          {kind === "receivable" ? (
            <ActionForm action={createReceivableAction} submitLabel="Tạo khoản phải thu" submitClassName="btn btn-primary min-h-11" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="field-label">Loại đối tượng</span>
                  <select name="party" defaultValue="dealer" className="field min-h-11 w-full">
                    <option value="dealer">Đại lý</option>
                    <option value="customer">Khách hàng</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Đại lý</span>
                  <select name="dealerId" className="field min-h-11 w-full">
                    <option value="">—</option>
                    {dealerList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="field-label">Khách hàng (khi chọn loại Khách hàng)</span>
                  <select name="customerId" className="field min-h-11 w-full">
                    <option value="">—</option>
                    {customerList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Số tiền (đồng)</span>
                  <input name="amount" required inputMode="numeric" className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Ngày ghi nợ</span>
                  <input type="date" name="issuedOn" required defaultValue={today} className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Hạn thu</span>
                  <input type="date" name="dueOn" required defaultValue={today} className="field min-h-11 w-full" />
                </label>
              </div>
              <label className="block text-sm">
                <span className="field-label">Ghi chú</span>
                <input name="note" className="field min-h-11 w-full" />
              </label>
            </ActionForm>
          ) : (
            <ActionForm action={createPayableAction} submitLabel="Tạo khoản phải trả" submitClassName="btn btn-primary min-h-11" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="field-label">Nhà cung cấp</span>
                  <select name="supplierId" required className="field min-h-11 w-full">
                    <option value="">Chọn nhà cung cấp</option>
                    {supplierList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · hạn {s.terms} ngày
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Hạng mục chi</span>
                  <select name="categoryId" required className="field min-h-11 w-full">
                    <option value="">Chọn hạng mục</option>
                    {outCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Số tiền (đồng)</span>
                  <input name="amount" required inputMode="numeric" className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Ngày ghi nợ</span>
                  <input type="date" name="issuedOn" required defaultValue={today} className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Hạn trả (để trống: theo hạn nhà cung cấp)</span>
                  <input type="date" name="dueOn" className="field min-h-11 w-full" />
                </label>
              </div>
              <label className="block text-sm">
                <span className="field-label">Ghi chú</span>
                <input name="note" className="field min-h-11 w-full" />
              </label>
            </ActionForm>
          )}
        </Card>
      )}
    </>
  );
}
