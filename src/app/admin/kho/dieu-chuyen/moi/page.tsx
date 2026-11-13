import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listWarehouses, pickableLots } from "@/modules/inventory/admin";
import { ActionForm } from "../../../_components/action-form";
import { Card, PageHeader } from "../../../_components/ui";
import { createTransferAction } from "../../actions";
import { q, viDate } from "../../_lib/fmt";
import { LINE_ROWS } from "../../_lib/form";

export const metadata: Metadata = { title: "Lập phiếu điều chuyển" };

export default async function NewTransferPage() {
  const [staff, db] = await Promise.all([requireStaff(), getDb()]);
  if (!can(staff.role, "inventory.write")) redirect("/admin/kho/dieu-chuyen");
  const [whs, lotsRaw] = await Promise.all([listWarehouses(db), pickableLots(db)]);
  const active = whs.filter((w) => w.isActive);
  const lots = lotsRaw.filter((l) => l.qty > 0).sort((a, b) => a.warehouseCode.localeCompare(b.warehouseCode) || a.item.code.localeCompare(b.item.code) || a.lotCode.localeCompare(b.lotCode));

  return (
    <>
      <Link href="/admin/kho/dieu-chuyen" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Điều chuyển
      </Link>
      <PageHeader title="Lập phiếu điều chuyển" description="Chọn kho đi, kho đến, rồi chọn lô nằm ở kho đi. Cùng kho thì là chuyển vị trí." />
      <ActionForm action={createTransferAction} submitLabel="Lưu nháp" className="space-y-6" noValidate>
        <Card title="Thông tin phiếu">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="field-label">Kho đi</span>
              <select name="fromWarehouseId" className="field">
                {active.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Kho đến</span>
              <select name="toWarehouseId" className="field">
                {active.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Lý do</span>
              <input name="reason" className="field" />
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
                  <span className="field-label">Lô và vị trí đi</span>
                  <select name={`pick_${i}`} className="field">
                    <option value="">Chọn lô</option>
                    {lots.map((l) => (
                      <option key={`${l.stockLotId}:${l.locationId}`} value={`lot:${l.stockLotId}:${l.locationId}`}>
                        {l.warehouseCode}/{l.locationCode} · {l.item.code} · {l.lotCode} · còn {q(l.qty, l.item)}
                        {l.expiresOn ? ` · HSD ${viDate(l.expiresOn)}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Số lượng</span>
                  <input name={`qty_${i}`} inputMode="decimal" className="field tabular-nums" />
                </label>
                <label className="block">
                  <span className="field-label">Vị trí đến (trống: mặc định)</span>
                  <select name={`to_${i}`} className="field">
                    <option value="">Vị trí mặc định</option>
                    {active.flatMap((w) =>
                      w.locations
                        .filter((l) => l.isActive)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {w.code}/{l.code}
                          </option>
                        )),
                    )}
                  </select>
                </label>
              </div>
            </fieldset>
          ))}
        </div>
      </ActionForm>
    </>
  );
}
