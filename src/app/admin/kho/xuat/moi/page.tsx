import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listItems, listWarehouses, pickableLots } from "@/modules/inventory/admin";
import { isLotUsable } from "@/modules/inventory/rules";
import { vnToday } from "@/modules/numbering/rules";
import { ActionForm } from "../../../_components/action-form";
import { Card, PageHeader } from "../../../_components/ui";
import { createIssueAction } from "../../actions";
import { q, viDate } from "../../_lib/fmt";
import { LINE_ROWS } from "../../_lib/form";
import { ISSUE_KIND_LABEL, ITEM_KIND_LABEL, LOT_STATUS_LABEL, MANUAL_ISSUE_KINDS } from "../../_lib/labels";

export const metadata: Metadata = { title: "Lập phiếu xuất" };

export default async function NewIssuePage({ searchParams }: { searchParams: Promise<{ lo?: string; loai?: string }> }) {
  const [sp, staff, db] = await Promise.all([searchParams, requireStaff(), getDb()]);
  if (!can(staff.role, "inventory.write")) redirect("/admin/kho/xuat");
  const today = vnToday();
  const [items, whs, lotsRaw] = await Promise.all([listItems(db, { activeOnly: true }), listWarehouses(db), pickableLots(db)]);
  const lots = lotsRaw
    .filter((l) => l.qty > 0)
    .sort((a, b) => a.item.code.localeCompare(b.item.code) || (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999") || a.lotCode.localeCompare(b.lotCode));
  const groups = Object.entries(ITEM_KIND_LABEL)
    .map(([k, label]) => ({ label, items: items.filter((i) => i.kind === k) }))
    .filter((g) => g.items.length);
  const approver = can(staff.role, "inventory.approve");
  // Điền sẵn từ trang lô: ?lo=<stockLotId>&loai=scrap
  const defaultKind = (MANUAL_ISSUE_KINDS as readonly string[]).includes(sp.loai ?? "") ? sp.loai! : "sample";
  const prefill = sp.lo ? lots.find((l) => l.stockLotId === sp.lo) : undefined;
  const prefillPick = prefill ? `lot:${prefill.stockLotId}:${prefill.locationId}` : "";

  return (
    <>
      <Link href="/admin/kho/xuat" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Xuất kho
      </Link>
      <PageHeader
        title="Lập phiếu xuất"
        description={`Mỗi dòng chọn một lô cụ thể, hoặc chỉ chọn hàng để hệ thống lấy theo FEFO (hết hạn trước xuất trước). ${approver ? "Lưu nháp rồi ghi sổ." : "Lưu nháp rồi gửi chủ cửa hàng duyệt."}`}
      />
      <ActionForm action={createIssueAction} submitLabel="Lưu nháp" className="space-y-6" noValidate>
        <Card title="Thông tin phiếu">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="block">
              <span className="field-label">Loại xuất</span>
              <select name="kind" defaultValue={defaultKind} className="field">
                {MANUAL_ISSUE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ISSUE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Kho xuất (trống: mọi kho hợp lệ)</span>
              <select name="warehouseId" className="field">
                <option value="">Theo loại xuất</option>
                {whs
                  .filter((w) => w.isActive)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Mục đích (người nhận, lý do hủy…)</span>
              <input name="purpose" className="field" />
            </label>
            <label className="block sm:col-span-2 xl:col-span-3">
              <span className="field-label">Ảnh chứng từ (biên bản hủy, phiếu gửi mẫu; tối đa 5 ảnh)</span>
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
              <legend className="px-1 text-xs text-ink-soft">
                Dòng {i + 1}
                {i > 0 ? " (để trống nếu không dùng)" : ""}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="block sm:col-span-2">
                  <span className="field-label">Lô cụ thể</span>
                  <select name={`pick_${i}`} defaultValue={i === 0 ? prefillPick : ""} className="field">
                    <option value="">Không chọn lô (dùng FEFO)</option>
                    {lots.map((l) => {
                      const st = l.qcStatus ?? l.productLotStatus ?? "pending";
                      const usable = isLotUsable(l, today);
                      return (
                        <option key={`${l.stockLotId}:${l.locationId}`} value={`lot:${l.stockLotId}:${l.locationId}`}>
                          {l.item.code} · {l.lotCode} · {l.warehouseCode}/{l.locationCode} · còn {q(l.qty, l.item)}
                          {l.expiresOn ? ` · HSD ${viDate(l.expiresOn)}` : ""}
                          {usable ? "" : ` · ${LOT_STATUS_LABEL[st] ?? st}`}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="field-label">Hoặc chỉ chọn hàng (FEFO)</span>
                  <select name={`item_${i}`} className="field">
                    <option value="">Chọn hàng</option>
                    {groups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.code} · {it.name} ({it.displayUom})
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
                <label className="block sm:col-span-3">
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
