import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { salesChannels } from "@/db/schema";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listAccountsWithBalance, listCategories } from "@/modules/finance/cash";
import { ACCOUNT_KIND_LABEL } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";
import { ActionForm } from "../../../_components/action-form";
import { Card, PageHeader } from "../../../_components/ui";
import { createCashAction, createTransferAction, settleCodAction } from "../../actions";
import { LegalNotice, Money } from "../../_shared";

export const metadata: Metadata = { title: "Lập phiếu" };

type SP = Record<string, string | string[] | undefined>;

export default async function NewCashPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.loai) ? sp.loai[0] : sp.loai;
  const me = await requireStaff();
  const canWrite = can(me.role, "finance.write");
  // Cộng tác viên chỉ lập đề nghị chi (R-TC-3)
  if (!canWrite && !can(me.role, "finance.request")) redirect("/admin");
  const loai = !canWrite ? "chi" : raw === "thu" || raw === "chuyen" ? raw : "chi";
  const db = await getDb();
  const today = vnToday();
  const [accounts, categories, channels] = await Promise.all([
    listAccountsWithBalance(db, { activeOnly: true }),
    loai === "chuyen" ? Promise.resolve([]) : listCategories(db, { activeOnly: true, direction: loai === "thu" ? "in" : "out" }),
    db.select({ code: salesChannels.code, name: salesChannels.name }).from(salesChannels).where(eq(salesChannels.isActive, true)).orderBy(asc(salesChannels.sort)),
  ]);
  const accountOption = (a: (typeof accounts)[number]) => (
    <option key={a.id} value={a.id}>
      {a.name} · {ACCOUNT_KIND_LABEL[a.kind]}
    </option>
  );
  const title = !canWrite ? "Lập đề nghị chi" : loai === "thu" ? "Phiếu thu" : loai === "chi" ? "Phiếu chi" : "Chuyển quỹ";

  return (
    <>
      <PageHeader
        title={title}
        description={!canWrite ? "Đề nghị chờ chủ duyệt; duyệt xong mới trừ tiền." : "Ngày phiếu không được sau hôm nay. Chi tiền mặt quá số dư sẽ bị chặn."}
        actions={
          <Link href={canWrite ? "/admin/tai-chinh/thu-chi" : "/admin/tai-chinh/thu-chi?cua-toi=1"} className="btn btn-outline min-h-11">
            ← Danh sách
          </Link>
        }
      />
      <LegalNotice />

      {canWrite && (
        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          {(
            [
              ["thu", "Phiếu thu"],
              ["chi", "Phiếu chi"],
              ["chuyen", "Chuyển quỹ, đối soát COD"],
            ] as const
          ).map(([k, label]) => (
            <Link key={k} href={`/admin/tai-chinh/thu-chi/moi?loai=${k}`} className={`inline-flex min-h-11 items-center border px-3 ${k === loai ? "border-graphite bg-graphite text-bone" : "border-line hover:border-graphite"}`}>
              {label}
            </Link>
          ))}
        </div>
      )}

      {canWrite && (
        <Card title="Số dư hiện tại" className="mb-6">
          <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span>{a.name}</span>
                <Money value={a.balance} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {loai !== "chuyen" ? (
        <Card title={title} className="max-w-2xl">
          <ActionForm action={createCashAction} submitLabel={!canWrite ? "Gửi đề nghị" : "Ghi phiếu"} submitClassName="btn btn-primary min-h-11">
            <input type="hidden" name="direction" value={loai === "thu" ? "in" : "out"} />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="field-label">Số tiền (đồng)</span>
                <input name="amount" required inputMode="numeric" placeholder="500000" className="field min-h-11 w-full" />
              </label>
              <label className="block text-sm">
                <span className="field-label">Ngày</span>
                <input type="date" name="occurredOn" required defaultValue={today} max={today} className="field min-h-11 w-full" />
              </label>
              <label className="block text-sm">
                <span className="field-label">Tài khoản</span>
                <select name="accountId" required className="field min-h-11 w-full">
                  {accounts.map(accountOption)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="field-label">Hạng mục</span>
                <select name="categoryId" required className="field min-h-11 w-full">
                  <option value="">Chọn hạng mục</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="field-label">Đối tượng</span>
                <select name="counterpartyType" defaultValue="other" className="field min-h-11 w-full">
                  <option value="other">Khác</option>
                  <option value="customer">Khách hàng</option>
                  <option value="dealer">Đại lý</option>
                  <option value="supplier">Nhà cung cấp</option>
                  <option value="channel">Kênh bán</option>
                  <option value="staff">Nhân sự</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="field-label">Tên đối tượng</span>
                <input name="counterpartyName" className="field min-h-11 w-full" />
              </label>
              {loai === "chi" && (
                <label className="block text-sm">
                  <span className="field-label">Gắn kênh (chi marketing)</span>
                  <select name="channelCode" defaultValue="" className="field min-h-11 w-full">
                    <option value="">Không gắn</option>
                    {channels.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm">
                <span className="field-label">Ảnh chứng từ</span>
                <input type="file" name="files" accept="image/*" multiple className="field min-h-11 w-full" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="field-label">Ghi chú</span>
              <textarea name="note" rows={2} className="field w-full" />
            </label>
          </ActionForm>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card title="Chuyển quỹ giữa hai tài khoản">
            <ActionForm action={createTransferAction} submitLabel="Chuyển" submitClassName="btn btn-primary min-h-11" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="field-label">Từ tài khoản</span>
                  <select name="fromId" required className="field min-h-11 w-full">
                    {accounts.map(accountOption)}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Sang tài khoản</span>
                  <select name="toId" required defaultValue={accounts[1]?.id} className="field min-h-11 w-full">
                    {accounts.map(accountOption)}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Số tiền (đồng)</span>
                  <input name="amount" required inputMode="numeric" className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Ngày</span>
                  <input type="date" name="occurredOn" required defaultValue={today} max={today} className="field min-h-11 w-full" />
                </label>
              </div>
              <label className="block text-sm">
                <span className="field-label">Ghi chú</span>
                <input name="note" className="field min-h-11 w-full" />
              </label>
            </ActionForm>
          </Card>

          <Card title="Đối soát COD với hãng vận chuyển">
            <p className="mb-4 text-sm text-ink-soft">Hãng trả ít hơn tiền COD thu hộ: phần chênh ghi thành phí thu hộ (chi phí bán hàng).</p>
            <ActionForm action={settleCodAction} submitLabel="Ghi đối soát" submitClassName="btn btn-primary min-h-11" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="field-label">Tài khoản COD</span>
                  <select name="codAccountId" required defaultValue={accounts.find((a) => a.kind === "clearing")?.id} className="field min-h-11 w-full">
                    {accounts.map(accountOption)}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Tiền về tài khoản</span>
                  <select name="bankAccountId" required defaultValue={accounts.find((a) => a.kind === "bank")?.id} className="field min-h-11 w-full">
                    {accounts.map(accountOption)}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="field-label">Tổng COD thu hộ</span>
                  <input name="collected" required inputMode="numeric" className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Hãng thực trả</span>
                  <input name="received" required inputMode="numeric" className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Hãng vận chuyển</span>
                  <input name="carrier" className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Ngày</span>
                  <input type="date" name="occurredOn" required defaultValue={today} max={today} className="field min-h-11 w-full" />
                </label>
              </div>
              <label className="block text-sm">
                <span className="field-label">Ghi chú</span>
                <input name="note" className="field min-h-11 w-full" />
              </label>
            </ActionForm>
          </Card>
        </div>
      )}
    </>
  );
}
