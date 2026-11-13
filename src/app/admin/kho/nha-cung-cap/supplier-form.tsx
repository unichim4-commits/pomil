import type { suppliers } from "@/db/schema";
import { ActionForm } from "../../_components/action-form";
import { saveSupplierAction } from "../actions";
import { SUPPLIER_KIND_LABEL } from "../_lib/labels";

type Supplier = typeof suppliers.$inferSelect;

export function SupplierForm({ supplier }: { supplier?: Supplier }) {
  return (
    <ActionForm action={saveSupplierAction} submitLabel={supplier ? "Lưu" : "Thêm nhà cung cấp"}>
      {supplier && <input type="hidden" name="id" value={supplier.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {!supplier && (
          <label className="block">
            <span className="field-label">Mã (trống: tự sinh NCC-…)</span>
            <input name="code" className="field" />
          </label>
        )}
        <label className="block">
          <span className="field-label">Tên</span>
          <input name="name" required defaultValue={supplier?.name ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Loại</span>
          <select name="kind" defaultValue={supplier?.kind ?? "material"} className="field">
            {Object.entries(SUPPLIER_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Người liên hệ</span>
          <input name="contactName" defaultValue={supplier?.contactName ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Điện thoại</span>
          <input name="phone" inputMode="tel" defaultValue={supplier?.phone ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Email</span>
          <input name="email" type="email" defaultValue={supplier?.email ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Mã số thuế</span>
          <input name="taxCode" defaultValue={supplier?.taxCode ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Hạn trả (ngày, 0 = trả ngay)</span>
          <input name="paymentTermsDays" inputMode="numeric" defaultValue={String(supplier?.paymentTermsDays ?? 0)} className="field" />
        </label>
        <label className="block sm:col-span-2">
          <span className="field-label">Địa chỉ</span>
          <input name="address" defaultValue={supplier?.address ?? ""} className="field" />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="qualified" defaultChecked={supplier?.qualified ?? false} className="accent-graphite" /> Đã đánh giá đạt
        </label>
        {supplier && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={supplier.isActive} className="accent-graphite" /> Đang dùng
          </label>
        )}
      </div>
      <label className="block">
        <span className="field-label">Ghi chú</span>
        <textarea name="note" defaultValue={supplier?.note ?? ""} className="field" />
      </label>
    </ActionForm>
  );
}
