import type { inventoryItems, suppliers, warehouses } from "@/db/schema";
import { ActionForm } from "../../_components/action-form";
import { saveItemAction } from "../actions";
import { qPlain } from "../_lib/fmt";
import { BASE_UOM_LABEL, ITEM_KIND_LABEL, UOMS_BY_BASE } from "../_lib/labels";

type Item = typeof inventoryItems.$inferSelect;

// Form hàng hóa (R-KHO-1, R-KHO-2). Đơn vị hiển thị và đơn vị giá nhập phải cùng chiều với đơn vị cơ sở; máy chủ kiểm lại.
export function ItemForm({
  item,
  suggestedCode,
  defaultKind,
  supplierList,
  warehouseList,
  canWrite,
}: {
  item?: Item | null;
  suggestedCode?: string | null;
  defaultKind?: string;
  supplierList: (typeof suppliers.$inferSelect)[];
  warehouseList: (typeof warehouses.$inferSelect)[];
  canWrite: boolean;
}) {
  if (!canWrite) return null;
  const pcs = defaultKind === "packaging";
  const allUoms = Object.entries(UOMS_BY_BASE);
  return (
    <ActionForm action={saveItemAction} submitLabel={item ? "Lưu thay đổi" : "Thêm hàng"} noValidate>
      <div className="space-y-4">
        {item && <input type="hidden" name="id" value={item.id} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Mã hàng</span>
            <input name="code" required defaultValue={item?.code ?? suggestedCode ?? ""} className="field font-mono uppercase" maxLength={20} />
            <span className="mt-1 block text-xs text-ink-soft">Chữ, số, gạch ngang. Gợi ý: NL-NNN, TD-NNN, BB-NNN, BTP-NNN.</span>
          </label>
          <label className="block">
            <span className="field-label">Tên hàng</span>
            <input name="name" required defaultValue={item?.name ?? ""} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Nhóm</span>
            <select name="kind" defaultValue={item?.kind ?? defaultKind ?? "raw_material"} className="field">
              {Object.entries(ITEM_KIND_LABEL)
                .filter(([k]) => k !== "finished")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Nhóm tự do (không bắt buộc)</span>
            <input name="groupName" defaultValue={item?.groupName ?? ""} placeholder="Chất dưỡng, Nắp…" className="field" />
          </label>
          <label className="block">
            <span className="field-label">Đơn vị cơ sở</span>
            <select name="baseUom" defaultValue={item?.baseUom ?? (pcs ? "pcs" : "ul")} className="field">
              {Object.entries(BASE_UOM_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-soft">Không đổi được khi hàng đã có lịch sử kho.</span>
          </label>
          <label className="block">
            <span className="field-label">Đơn vị hiển thị</span>
            <select name="displayUom" defaultValue={item?.displayUom ?? (pcs ? "cái" : "ml")} className="field">
              {allUoms.map(([base, us]) => (
                <optgroup key={base} label={BASE_UOM_LABEL[base]}>
                  {us.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Đơn vị tính giá nhập</span>
            <select name="purchaseUom" defaultValue={item?.purchaseUom ?? (pcs ? "cái" : "l")} className="field">
              {allUoms.map(([base, us]) => (
                <optgroup key={base} label={BASE_UOM_LABEL[base]}>
                  {us.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Giá nhập tham chiếu (đồng / đơn vị giá nhập)</span>
            <input name="refUnitPrice" inputMode="numeric" defaultValue={item?.refUnitPrice ?? ""} className="field tabular-nums" />
          </label>
          <label className="block">
            <span className="field-label">Tồn tối thiểu (theo đơn vị hiển thị)</span>
            <input name="minStock" inputMode="decimal" defaultValue={item?.minStock != null ? qPlain(item.minStock, item) : ""} className="field tabular-nums" />
          </label>
          <label className="block">
            <span className="field-label">Hạn dùng mặc định (ngày từ NSX)</span>
            <input name="shelfLifeDays" type="number" min={1} defaultValue={item?.shelfLifeDays ?? ""} className="field tabular-nums" />
          </label>
          <label className="block">
            <span className="field-label">Khối lượng riêng (mg/ml)</span>
            <input name="densityMgPerMl" type="number" min={1} defaultValue={item?.densityMgPerMl ?? ""} className="field tabular-nums" />
          </label>
          <label className="block">
            <span className="field-label">Nhà cung cấp mặc định</span>
            <select name="defaultSupplierId" defaultValue={item?.defaultSupplierId ?? ""} className="field">
              <option value="">Không</option>
              {supplierList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Kho mặc định</span>
            <select name="defaultWarehouseId" defaultValue={item?.defaultWarehouseId ?? ""} className="field">
              <option value="">Không</option>
              {warehouseList
                .filter((w) => w.kind !== "finished")
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Quy cách</span>
            <input name="spec" defaultValue={item?.spec ?? ""} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Điều kiện bảo quản</span>
            <input name="storageCondition" defaultValue={item?.storageCondition ?? ""} className="field" />
          </label>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" name="requiresIqc" defaultChecked={item?.requiresIqc ?? true} className="accent-graphite" /> Cần kiểm khi nhập (IQC)
        </label>
        {item && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={item.isActive} className="accent-graphite" /> Đang dùng (bỏ chọn để ngừng dùng, chỉ được khi tồn bằng 0)
          </label>
        )}
        <label className="block">
          <span className="field-label">Ghi chú</span>
          <textarea name="note" defaultValue={item?.note ?? ""} className="field" />
        </label>
      </div>
    </ActionForm>
  );
}
