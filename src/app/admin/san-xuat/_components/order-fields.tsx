// Ô nhập của lệnh sản xuất (tạo mới và sửa trước khi duyệt)
import { Field } from "./fields";

type Opt = { id: string; label: string };

export function OrderFields({
  products,
  versions,
  factories,
  showMoney,
  o,
}: {
  products: Opt[];
  versions: Opt[];
  factories: Opt[];
  showMoney: boolean;
  o?: {
    kind: string;
    productId: string;
    formulaVersionId: string | null;
    formulaLabel: string | null;
    supplierId: string | null;
    outsourcingUnitPrice: number | null;
    plannedUnits: number;
    plannedStart: string | null;
    plannedEnd: string | null;
    note: string | null;
  };
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Loại">
          <select name="kind" className="field min-h-11" defaultValue={o?.kind ?? "outsourced"}>
            <option value="outsourced">Gia công tại nhà máy</option>
            <option value="in_house">Tự làm</option>
          </select>
        </Field>
        <Field label="Sản phẩm">
          <select name="productId" required className="field min-h-11" defaultValue={o?.productId ?? ""}>
            <option value="" disabled>
              Chọn sản phẩm
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phiên bản công thức" hint="Tự làm phải chọn bản đã duyệt">
          <select name="formulaVersionId" className="field min-h-11" defaultValue={o?.formulaVersionId ?? ""}>
            <option value="">Không chọn</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mã công thức của nhà máy" hint="Gia công không có công thức trong hệ thống thì ghi mã nhà máy">
          <input name="formulaLabel" className="field min-h-11" defaultValue={o?.formulaLabel ?? ""} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nhà máy gia công">
          <select name="supplierId" className="field min-h-11" defaultValue={o?.supplierId ?? ""}>
            <option value="">—</option>
            {factories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        {showMoney ? (
          <Field label="Đơn giá gia công (đ/chai)">
            <input name="unitPrice" inputMode="numeric" className="field min-h-11" defaultValue={o?.outsourcingUnitPrice ?? ""} />
          </Field>
        ) : (
          o?.outsourcingUnitPrice != null && <input type="hidden" name="unitPrice" value={o.outsourcingUnitPrice} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Số chai kế hoạch">
          <input name="plannedUnits" required inputMode="numeric" className="field min-h-11" defaultValue={o?.plannedUnits ?? ""} />
        </Field>
        <Field label="Ngày bắt đầu">
          <input type="date" name="plannedStart" className="field min-h-11" defaultValue={o?.plannedStart ?? ""} />
        </Field>
        <Field label="Ngày xong dự kiến">
          <input type="date" name="plannedEnd" className="field min-h-11" defaultValue={o?.plannedEnd ?? ""} />
        </Field>
      </div>
      <Field label="Ghi chú">
        <input name="note" className="field min-h-11" defaultValue={o?.note ?? ""} />
      </Field>
    </>
  );
}
