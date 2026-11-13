import { APPLIES_TO_LABEL } from "@/modules/qms/admin";
import { formatMilli, PARAM_GROUP_LABEL, PARAM_KIND_LABEL } from "@/modules/qms/rules";
import { TEST_LABEL } from "@/modules/quality/admin";
import { ActionForm } from "../../_components/action-form";
import type { ActionResult } from "../../_lib/result";

type ParamRow = {
  name: string;
  paramGroup: string;
  kind: string;
  unit: string;
  minMilli: number | null;
  maxMilli: number | null;
  expectedText: string | null;
  method: string;
  lotTestType: string | null;
  isCritical: boolean;
};

export type StandardFormValues = {
  id?: string;
  name: string;
  appliesTo: string;
  itemId: string | null;
  productId: string | null;
  effectiveFrom: string | null;
  note: string | null;
  params: ParamRow[];
};

const BLANK: ParamRow = { name: "", paramGroup: "physicochemical", kind: "range", unit: "", minMilli: null, maxMilli: null, expectedText: null, method: "", lotTestType: null, isCritical: true };

// Form tiêu chuẩn: các dòng chỉ tiêu hiện sẵn + 4 dòng trống; dòng để trống tên bị bỏ khi lưu
export function StandardForm({
  action,
  values,
  items,
  products,
  submitLabel,
}: {
  action: (s: ActionResult, fd: FormData) => Promise<ActionResult>;
  values: StandardFormValues;
  items: { id: string; code: string; name: string }[];
  products: { id: string; name: string }[];
  submitLabel: string;
}) {
  const rows = [...values.params, BLANK, BLANK, BLANK, BLANK];
  const target = values.itemId ? `item:${values.itemId}` : values.productId ? `product:${values.productId}` : "";
  return (
    <ActionForm action={action} submitLabel={submitLabel} noValidate>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <input type="hidden" name="rows" value={rows.length} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="field-label">Tên tiêu chuẩn</span>
          <input name="name" defaultValue={values.name} className="field" required />
        </label>
        <label className="block">
          <span className="field-label">Nhóm áp dụng</span>
          <select name="appliesTo" defaultValue={values.appliesTo} className="field">
            {Object.entries(APPLIES_TO_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Gắn hàng hoặc sản phẩm (để trống: dùng chung cho nhóm)</span>
          <select name="target" defaultValue={target} className="field">
            <option value="">Dùng chung</option>
            <optgroup label="Hàng hóa">
              {items.map((i) => (
                <option key={i.id} value={`item:${i.id}`}>
                  {i.code} · {i.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Sản phẩm">
              {products.map((p) => (
                <option key={p.id} value={`product:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="block">
          <span className="field-label">Hiệu lực từ</span>
          <input type="date" name="effectiveFrom" defaultValue={values.effectiveFrom ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Ghi chú, nguồn giới hạn</span>
          <input name="note" defaultValue={values.note ?? ""} className="field" />
        </label>
      </div>

      <div className="space-y-3">
        <p className="text-sm text-ink-soft">Chỉ tiêu. Số thập phân dùng dấu phẩy (ví dụ 4,5). Giới hạn chỉ dùng cho kiểu khoảng giá trị.</p>
        {rows.map((p, i) => (
          <fieldset key={i} className="grid gap-2 border border-line p-3 sm:grid-cols-6">
            <legend className="px-1 text-xs text-ink-soft">Chỉ tiêu {i + 1}</legend>
            <input name={`p_name_${i}`} defaultValue={p.name} placeholder="Tên chỉ tiêu" aria-label="Tên chỉ tiêu" className="field sm:col-span-2" />
            <select name={`p_group_${i}`} defaultValue={p.paramGroup} aria-label="Nhóm" className="field">
              {Object.entries(PARAM_GROUP_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select name={`p_kind_${i}`} defaultValue={p.kind} aria-label="Kiểu" className="field">
              {Object.entries(PARAM_KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input name={`p_unit_${i}`} defaultValue={p.unit} placeholder="Đơn vị" aria-label="Đơn vị" className="field" />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name={`p_critical_${i}`} defaultChecked={p.isCritical} className="accent-graphite" /> Trọng yếu
            </label>
            <input name={`p_min_${i}`} defaultValue={p.minMilli == null ? "" : formatMilli(p.minMilli)} placeholder="Giới hạn dưới" aria-label="Giới hạn dưới" inputMode="decimal" className="field" />
            <input name={`p_max_${i}`} defaultValue={p.maxMilli == null ? "" : formatMilli(p.maxMilli)} placeholder="Giới hạn trên" aria-label="Giới hạn trên" inputMode="decimal" className="field" />
            <input name={`p_expected_${i}`} defaultValue={p.expectedText ?? ""} placeholder="Yêu cầu (chữ)" aria-label="Yêu cầu" className="field" />
            <input name={`p_method_${i}`} defaultValue={p.method} placeholder="Phương pháp" aria-label="Phương pháp" className="field" />
            <select name={`p_lottest_${i}`} defaultValue={p.lotTestType ?? ""} aria-label="Nối phiếu kiểm nghiệm lô" className="field sm:col-span-2">
              <option value="">Không nối phiếu kiểm nghiệm lô</option>
              {Object.entries(TEST_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  Lấy kết quả từ phiếu {v}
                </option>
              ))}
            </select>
          </fieldset>
        ))}
      </div>
    </ActionForm>
  );
}
