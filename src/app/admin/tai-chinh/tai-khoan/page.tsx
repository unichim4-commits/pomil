import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { listAccountsWithBalance, listCategories, listReconciliations } from "@/modules/finance/cash";
import { ACCOUNT_KIND_LABEL, BUDGET_GROUP_LABEL, PL_LINE_LABEL, type BudgetGroup, type PlLine } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, PageHeader, Table } from "../../_components/ui";
import { createAccountAction, createCategoryAction, reconcileAction, updateAccountAction, updateCategoryAction } from "../actions";
import { LegalNotice, Money, requireFinanceView } from "../_shared";

export const metadata: Metadata = { title: "Tài khoản tiền" };

const PL_LINES = Object.keys(PL_LINE_LABEL) as PlLine[];
const GROUPS = Object.keys(BUDGET_GROUP_LABEL) as BudgetGroup[];

function PlSelect({ value }: { value?: PlLine }) {
  return (
    <select name="plLine" defaultValue={value ?? "admin"} className="field min-h-11 w-full">
      {PL_LINES.map((p) => (
        <option key={p} value={p}>
          {PL_LINE_LABEL[p]}
        </option>
      ))}
    </select>
  );
}

function GroupSelect({ value }: { value?: BudgetGroup | null }) {
  return (
    <select name="budgetGroup" defaultValue={value ?? ""} className="field min-h-11 w-full">
      <option value="">Không vào ngân sách</option>
      {GROUPS.map((g) => (
        <option key={g} value={g}>
          {BUDGET_GROUP_LABEL[g]}
        </option>
      ))}
    </select>
  );
}

export default async function AccountsPage() {
  const me = await requireFinanceView();
  const db = await getDb();
  const today = vnToday();
  const [accounts, categories, recons] = await Promise.all([listAccountsWithBalance(db), listCategories(db), listReconciliations(db)]);
  const canWrite = can(me.role, "finance.write");
  const canApprove = can(me.role, "finance.approve");

  return (
    <>
      <PageHeader title="Tài khoản tiền" description="Quỹ tiền mặt, tài khoản ngân hàng, tiền chờ đối soát; đối chiếu quỹ và hạng mục thu chi." />
      <LegalNotice />

      <Card title="Tài khoản" className="mb-6">
        <Table>
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên</th>
              <th>Loại</th>
              <th>Số dư đầu</th>
              <th className="text-right">Số dư hiện tại</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td className="font-mono text-xs">{a.code}</td>
                <td>
                  {a.name}
                  {(a.bankName || a.accountNo) && <span className="block text-xs text-ink-soft">{[a.bankName, a.accountNo].filter(Boolean).join(" · ")}</span>}
                  {canWrite && (
                    <details className="mt-1">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs underline">Sửa</summary>
                      <ActionForm action={updateAccountAction} submitLabel="Lưu" className="mt-2 grid max-w-md gap-2" submitClassName="btn btn-primary min-h-11">
                        <input type="hidden" name="id" value={a.id} />
                        <input name="name" defaultValue={a.name} required className="field min-h-11 w-full" aria-label="Tên" />
                        <input name="bankName" defaultValue={a.bankName ?? ""} placeholder="Ngân hàng" className="field min-h-11 w-full" />
                        <input name="accountNo" defaultValue={a.accountNo ?? ""} placeholder="Số tài khoản" className="field min-h-11 w-full" />
                        <input name="openingBalance" defaultValue={String(a.openingBalance)} inputMode="numeric" className="field min-h-11 w-full" aria-label="Số dư đầu" />
                        <input type="date" name="openingOn" defaultValue={a.openingOn} className="field min-h-11 w-full" aria-label="Ngày số dư đầu" />
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input type="checkbox" name="isActive" defaultChecked={a.isActive} /> Đang dùng
                        </label>
                      </ActionForm>
                    </details>
                  )}
                </td>
                <td>{ACCOUNT_KIND_LABEL[a.kind]}</td>
                <td className="whitespace-nowrap">
                  <Money value={a.openingBalance} /> <span className="text-xs text-ink-soft">{formatDate(a.openingOn)}</span>
                </td>
                <td className="text-right">
                  <Money value={a.balance} />
                </td>
                <td>{a.isActive ? <Badge tone="green">Đang dùng</Badge> : <Badge>Ngừng</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        {canApprove && (
          <Card title="Đối chiếu quỹ">
            <p className="mb-4 text-sm text-ink-soft">Đếm tiền hoặc xem sao kê, nhập số thực tế. Chọn ghi chênh lệch để hệ thống lập phiếu điều chỉnh.</p>
            <ActionForm action={reconcileAction} submitLabel="Đối chiếu" submitClassName="btn btn-primary min-h-11">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="field-label">Tài khoản</span>
                  <select name="accountId" required className="field min-h-11 w-full">
                    {accounts
                      .filter((a) => a.isActive)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Tính đến ngày</span>
                  <input type="date" name="asOf" required defaultValue={today} max={today} className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Số dư thực tế</span>
                  <input name="actualBalance" required inputMode="numeric" className="field min-h-11 w-full" />
                </label>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="writeAdjustment" defaultChecked /> Ghi phiếu chênh lệch
              </label>
              <input name="note" placeholder="Ghi chú" className="field min-h-11 w-full" />
            </ActionForm>
          </Card>
        )}

        <Card title="Lịch sử đối chiếu">
          {recons.length === 0 ? (
            <p className="text-sm text-ink-soft">Chưa đối chiếu lần nào.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {recons.map((r) => (
                <li key={r.id} className="py-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>
                      {r.accountName} · {formatDate(r.asOf)}
                    </span>
                    <span>
                      Hệ thống <Money value={r.systemBalance} /> · thực tế <Money value={r.actualBalance} />
                    </span>
                  </div>
                  <p className="text-xs text-ink-soft">
                    {r.difference === 0 ? "Khớp" : `Chênh ${r.difference > 0 ? "+" : ""}${r.difference.toLocaleString("vi-VN")}đ`}
                    {r.adjustmentTxId && (
                      <>
                        {" · "}
                        <Link href={`/admin/tai-chinh/thu-chi/${r.adjustmentTxId}`} className="underline">
                          {r.adjustmentCode}
                        </Link>
                      </>
                    )}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {canWrite && (
        <Card title="Thêm tài khoản" className="mb-6 max-w-2xl">
          <ActionForm action={createAccountAction} submitLabel="Thêm" submitClassName="btn btn-primary min-h-11" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="field-label">Mã (không dấu)</span>
                <input name="code" required placeholder="NH-2" className="field min-h-11 w-full" />
              </label>
              <label className="block text-sm">
                <span className="field-label">Tên</span>
                <input name="name" required className="field min-h-11 w-full" />
              </label>
              <label className="block text-sm">
                <span className="field-label">Loại</span>
                <select name="kind" defaultValue="bank" className="field min-h-11 w-full">
                  <option value="cash">Tiền mặt</option>
                  <option value="bank">Ngân hàng</option>
                  <option value="clearing">Chờ đối soát (COD, ví sàn)</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="field-label">Ngân hàng</span>
                <input name="bankName" className="field min-h-11 w-full" />
              </label>
              <label className="block text-sm">
                <span className="field-label">Số tài khoản</span>
                <input name="accountNo" className="field min-h-11 w-full" />
              </label>
              <label className="block text-sm">
                <span className="field-label">Số dư đầu</span>
                <input name="openingBalance" required defaultValue="0" inputMode="numeric" className="field min-h-11 w-full" />
              </label>
              <label className="block text-sm">
                <span className="field-label">Ngày số dư đầu</span>
                <input type="date" name="openingOn" required defaultValue={today} className="field min-h-11 w-full" />
              </label>
            </div>
          </ActionForm>
        </Card>
      )}

      <Card title="Hạng mục thu chi">
        <Table>
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên</th>
              <th>Loại</th>
              <th>Dòng lãi lỗ</th>
              <th>Nhóm ngân sách</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.code}</td>
                <td>
                  {c.name}
                  {canWrite && !c.isSystem && (
                    <details className="mt-1">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs underline">Sửa</summary>
                      <ActionForm action={updateCategoryAction} submitLabel="Lưu" className="mt-2 grid max-w-md gap-2" submitClassName="btn btn-primary min-h-11">
                        <input type="hidden" name="id" value={c.id} />
                        <input name="name" defaultValue={c.name} required className="field min-h-11 w-full" aria-label="Tên" />
                        <PlSelect value={c.plLine} />
                        <GroupSelect value={c.budgetGroup} />
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input type="checkbox" name="isActive" defaultChecked={c.isActive} /> Đang dùng
                        </label>
                      </ActionForm>
                    </details>
                  )}
                </td>
                <td>{c.direction === "in" ? "Thu" : "Chi"}</td>
                <td>{PL_LINE_LABEL[c.plLine]}</td>
                <td>{c.budgetGroup ? BUDGET_GROUP_LABEL[c.budgetGroup] : "—"}</td>
                <td>
                  {c.isSystem && <Badge tone="dark">Hệ thống</Badge>} {c.isActive ? <Badge tone="green">Đang dùng</Badge> : <Badge>Ngừng</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>

        {canWrite && (
          <div className="mt-6 max-w-2xl">
            <h3 className="eyebrow mb-3 text-[0.68rem]">Thêm hạng mục</h3>
            <ActionForm action={createCategoryAction} submitLabel="Thêm hạng mục" submitClassName="btn btn-primary min-h-11" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="field-label">Mã (không dấu)</span>
                  <input name="code" required placeholder="CHI-THUE-KHO" className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Tên</span>
                  <input name="name" required className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Loại</span>
                  <select name="direction" defaultValue="out" className="field min-h-11 w-full">
                    <option value="out">Chi</option>
                    <option value="in">Thu</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Dòng lãi lỗ</span>
                  <PlSelect />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Nhóm ngân sách</span>
                  <GroupSelect />
                </label>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>
    </>
  );
}
