import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cashAccounts } from "@/db/schema";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listItems, listSuppliers, listWarehouses, productLotsForItems } from "@/modules/inventory/admin";
import { vnToday } from "@/modules/numbering/rules";
import { ActionForm } from "../../../_components/action-form";
import { Card, PageHeader } from "../../../_components/ui";
import { createReceiptAction } from "../../actions";
import { LINE_ROWS } from "../../_lib/form";
import { ITEM_KIND_LABEL, PAYMENT_MODE_LABEL, RECEIPT_KIND_LABEL } from "../../_lib/labels";

export const metadata: Metadata = { title: "Lập phiếu nhập" };

const KINDS = ["purchase", "opening", "other"] as const;

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ loai?: string }> }) {
  const [sp, staff, db] = await Promise.all([searchParams, requireStaff(), getDb()]);
  if (!can(staff.role, "inventory.write")) redirect("/admin/kho/nhap");
  const kind = (KINDS as readonly string[]).includes(sp.loai ?? "") ? sp.loai! : "purchase";
  const [items, sups, whs, plots, accounts] = await Promise.all([
    listItems(db, { activeOnly: true }),
    listSuppliers(db, { activeOnly: true }),
    listWarehouses(db),
    productLotsForItems(db),
    db.select().from(cashAccounts).where(eq(cashAccounts.isActive, true)).orderBy(asc(cashAccounts.sort)),
  ]);
  const activeWh = whs.filter((w) => w.isActive);
  const groups = Object.entries(ITEM_KIND_LABEL).map(([k, label]) => ({ label, items: items.filter((i) => i.kind === k) })).filter((g) => g.items.length);

  return (
    <>
      <Link href="/admin/kho/nhap" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Nhập kho
      </Link>
      <PageHeader title="Lập phiếu nhập" description="Số lượng theo đơn vị hiển thị của hàng (ví dụ 1,5 kg; 300 cái). Nhập thành tiền hoặc đơn giá theo đơn vị giá nhập." />
      <p className="mb-4 flex flex-wrap gap-2 text-sm">
        {KINDS.map((k) => (
          <Link key={k} href={`/admin/kho/nhap/moi?loai=${k}`} className={`inline-flex min-h-11 items-center border px-3 ${k === kind ? "border-graphite" : "border-line hover:border-graphite"}`}>
            {RECEIPT_KIND_LABEL[k]}
          </Link>
        ))}
      </p>
      {kind === "opening" && (
        <p className="mb-4 border border-line bg-pith/40 p-3 text-sm">
          Tồn đầu kỳ: không ghi tiền, chủ cửa hàng ghi sổ. Ghi NSX, HSD và giá trị từng dòng để tính giá vốn. Hàng thành phẩm chọn lô sản xuất có sẵn.
        </p>
      )}
      <ActionForm action={createReceiptAction} submitLabel="Lưu nháp" pendingLabel="Đang lưu…" className="space-y-6" noValidate>
        <input type="hidden" name="kind" value={kind} />
        <Card title="Thông tin phiếu">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="block">
              <span className="field-label">Kho nhận</span>
              <select name="warehouseId" required className="field">
                {activeWh.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Ngày nhập</span>
              <input type="date" name="receivedOn" defaultValue={vnToday()} required className="field" />
            </label>
            <label className="block">
              <span className="field-label">Nhà cung cấp</span>
              <select name="supplierId" className="field">
                <option value="">Không</option>
                {sups.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                    {s.qualified ? "" : " (chưa đánh giá)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Số hóa đơn</span>
              <input name="invoiceNo" className="field" />
            </label>
            {kind !== "opening" && (
              <>
                <label className="block">
                  <span className="field-label">Cách trả tiền</span>
                  <select name="paymentMode" defaultValue="payable" className="field">
                    {Object.entries(PAYMENT_MODE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Tài khoản (khi trả tiền ngay)</span>
                  <select name="payAccountId" className="field">
                    <option value="">Chọn</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label className="block sm:col-span-2 xl:col-span-3">
              <span className="field-label">Ảnh chứng từ (hóa đơn, phiếu giao; tối đa 5 ảnh, 3 MB mỗi ảnh)</span>
              <input type="file" name="files" multiple accept="image/jpeg,image/png,image/webp,image/avif" className="block min-h-11 w-full text-sm file:mr-3 file:border file:border-graphite file:bg-transparent file:px-3 file:py-3" />
            </label>
            <label className="block sm:col-span-2 xl:col-span-3">
              <span className="field-label">Ghi chú</span>
              <input name="note" className="field" />
            </label>
          </div>
        </Card>

        <div className="space-y-4">
          {Array.from({ length: LINE_ROWS }, (_, i) => (
            <fieldset key={i} className="border border-line bg-paper p-4">
              <legend className="px-1 text-xs text-ink-soft">Dòng {i + 1}{i > 0 ? " (để trống nếu không dùng)" : ""}</legend>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="block sm:col-span-2">
                  <span className="field-label">Hàng</span>
                  <select name={`item_${i}`} className="field">
                    <option value="">Chọn hàng</option>
                    {groups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.code} · {it.name} ({it.displayUom}){it.requiresIqc ? " · cần IQC" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Số lượng</span>
                  <input name={`qty_${i}`} inputMode="decimal" className="field tabular-nums" />
                </label>
                <label className="block">
                  <span className="field-label">Thành tiền (đồng)</span>
                  <input name={`cost_${i}`} inputMode="numeric" className="field tabular-nums" />
                </label>
                <label className="block">
                  <span className="field-label">Hoặc đơn giá / đơn vị giá nhập</span>
                  <input name={`price_${i}`} inputMode="numeric" className="field tabular-nums" />
                </label>
                <label className="block">
                  <span className="field-label">Số lô NCC</span>
                  <input name={`slot_${i}`} className="field" />
                </label>
                <label className="block">
                  <span className="field-label">NSX</span>
                  <input type="date" name={`mfg_${i}`} className="field" />
                </label>
                <label className="block">
                  <span className="field-label">HSD (trống: tự tính theo hạn mặc định)</span>
                  <input type="date" name={`exp_${i}`} className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Vị trí (trống: CHUNG)</span>
                  <select name={`loc_${i}`} className="field">
                    <option value="">Vị trí mặc định</option>
                    {activeWh.flatMap((w) =>
                      w.locations
                        .filter((l) => l.isActive && !l.isDefault)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {w.code}/{l.code}
                          </option>
                        )),
                    )}
                  </select>
                </label>
                {plots.length > 0 && (
                  <label className="block">
                    <span className="field-label">Lô sản xuất (chỉ hàng thành phẩm)</span>
                    <select name={`plot_${i}`} className="field">
                      <option value="">Không</option>
                      {plots.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.lotNo}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {kind === "opening" && (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" name={`pre_${i}`} className="accent-graphite" /> Đã kiểm trước đó (không tạo IQC)
                  </label>
                )}
                <label className="block sm:col-span-2">
                  <span className="field-label">Ghi chú dòng</span>
                  <input name={`note_${i}`} className="field" />
                </label>
              </div>
            </fieldset>
          ))}
        </div>
      </ActionForm>
    </>
  );
}
