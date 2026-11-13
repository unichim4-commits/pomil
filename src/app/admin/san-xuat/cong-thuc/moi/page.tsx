import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { ActionForm } from "../../../_components/action-form";
import { Card, PageHeader } from "../../../_components/ui";
import { createFormulaAction } from "../../actions";
import { Field, VersionParamFields } from "../../_components/fields";
import { productOptions } from "../../_lib/data";

export const metadata: Metadata = { title: "Tạo công thức" };

export default async function NewFormulaPage() {
  const staff = await requireStaff();
  if (!can(staff.role, "formulas.write")) notFound();
  const products = await productOptions(await getDb());
  return (
    <>
      <PageHeader title="Tạo công thức" description="Tạo xong là có phiên bản 1 ở dạng nháp. Thêm dòng nguyên liệu và bao bì ở trang chi tiết." />
      <Card className="max-w-2xl">
        <ActionForm action={createFormulaAction} submitLabel="Tạo công thức" className="space-y-4">
          <Field label="Tên công thức">
            <input name="name" required minLength={2} className="field min-h-11" placeholder="Dầu gội bưởi chuẩn" />
          </Field>
          <Field label="Sản phẩm" hint="Bỏ trống nếu là công thức bán thành phẩm">
            <select name="productId" className="field min-h-11" defaultValue="">
              <option value="">Không gắn sản phẩm</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </Field>
          <VersionParamFields />
          <Field label="Ghi chú">
            <input name="note" className="field min-h-11" />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
