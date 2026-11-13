// Ô nhập dùng lại giữa các form Sản xuất (server component, chỉ HTML)
import { formatBp } from "@/modules/production/rules";
import { qtyInput } from "../_lib/view";

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export function VersionParamFields({ v }: { v?: { batchSize: number; batchUom: string; bulkDensityMgPerMl: number | null; expectedYieldBp: number; processNote: string } }) {
  const unit = v?.batchUom === "mg" ? "kg" : "l";
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cỡ mẻ">
          <input name="batchSize" required inputMode="decimal" className="field min-h-11" defaultValue={v ? qtyInput(v.batchSize, unit) : ""} placeholder="30" />
        </Field>
        <Field label="Đơn vị">
          <select name="batchUnit" className="field min-h-11" defaultValue={unit}>
            <option value="l">lít</option>
            <option value="kg">kg</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Khối lượng riêng (mg/ml)" hint="Cần khi tính chai theo ml mà mẻ đo theo kg">
          <input name="density" inputMode="numeric" className="field min-h-11" defaultValue={v?.bulkDensityMgPerMl ?? ""} placeholder="1000" />
        </Field>
        <Field label="Hiệu suất dự kiến (%)">
          <input name="yield" inputMode="decimal" className="field min-h-11" defaultValue={v ? formatBp(v.expectedYieldBp).replace("%", "") : "98"} />
        </Field>
      </div>
      <Field label="Quy trình">
        <textarea name="processNote" rows={4} className="field" defaultValue={v?.processNote ?? ""} />
      </Field>
    </>
  );
}
