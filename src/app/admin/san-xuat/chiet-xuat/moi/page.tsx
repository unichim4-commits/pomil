import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { EXTRACTION_METHOD_LABEL } from "@/modules/production/rules";
import { ActionForm } from "../../../_components/action-form";
import { Card, PageHeader } from "../../../_components/ui";
import { createRunAction } from "../../actions";
import { Field } from "../../_components/fields";
import { itemOptions, supplierOptions } from "../../_lib/data";

export const metadata: Metadata = { title: "Tạo mẻ chiết" };

export default async function NewRunPage() {
  const staff = await requireStaff();
  if (!can(staff.role, "production.write")) notFound();
  const db = await getDb();
  const [outputs, farms, services] = await Promise.all([itemOptions(db, ["extract"]), supplierOptions(db, ["farm", "material"]), supplierOptions(db, ["service", "factory"])]);
  const showMoney = can(staff.role, "finance.view");
  return (
    <>
      <PageHeader title="Tạo mẻ chiết" description="Mẻ mới ở dạng nháp. Xuất vỏ ở trang chi tiết; lần xuất đầu tiên tự chuyển sang đang chạy." />
      <Card className="max-w-3xl">
        <ActionForm action={createRunAction} submitLabel="Tạo mẻ">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loại">
              <select name="kind" className="field min-h-11" defaultValue="outsourced">
                <option value="outsourced">Thuê lò</option>
                <option value="in_house">Tự chiết</option>
              </select>
            </Field>
            <Field label="Phương pháp">
              <select name="method" className="field min-h-11" defaultValue="steam_distillation">
                {Object.entries(EXTRACTION_METHOD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Hàng đầu ra (tinh dầu, dịch chiết)">
            <select name="outputItemId" required className="field min-h-11" defaultValue="">
              <option value="" disabled>
                Chọn hàng
              </option>
              {outputs.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.code} · {it.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Giống bưởi">
              <input name="pomeloVariety" className="field min-h-11" placeholder="Da xanh" />
            </Field>
            <Field label="Nguồn vỏ">
              <select name="sourceSupplierId" className="field min-h-11" defaultValue="">
                <option value="">—</option>
                {farms.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ngày thu hoạch">
              <input type="date" name="harvestOn" className="field min-h-11" />
            </Field>
          </div>
          <Field label="Tình trạng vỏ">
            <input name="peelCondition" className="field min-h-11" placeholder="Tươi, phơi 1 ngày" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Thiết bị / lò">
              <input name="equipment" className="field min-h-11" />
            </Field>
            <Field label="Người vận hành">
              <input name="operatorName" className="field min-h-11" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Đơn vị thuê lò">
              <select name="serviceSupplierId" className="field min-h-11" defaultValue="">
                <option value="">—</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            {showMoney && (
              <>
                <Field label="Phí thuê lò (đ)">
                  <input name="serviceFee" inputMode="numeric" className="field min-h-11" />
                </Field>
                <Field label="Chi phí khác (đ)">
                  <input name="otherCost" inputMode="numeric" className="field min-h-11" />
                </Field>
              </>
            )}
          </div>
          <Field label="Thông số" hint="Mỗi dòng: tên | giá trị | đơn vị, ví dụ: Nhiệt độ | 100 | °C">
            <textarea name="params" rows={4} className="field" />
          </Field>
          <Field label="Ghi chú">
            <input name="note" className="field min-h-11" />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
