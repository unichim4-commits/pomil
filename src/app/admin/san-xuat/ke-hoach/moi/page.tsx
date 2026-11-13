import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { ActionForm } from "../../../_components/action-form";
import { Card, PageHeader } from "../../../_components/ui";
import { createPlanAction } from "../../actions";
import { Field } from "../../_components/fields";
import { vnToday } from "../../_lib/view";

export const metadata: Metadata = { title: "Lập kế hoạch" };

export default async function NewPlanPage() {
  const staff = await requireStaff();
  if (!can(staff.role, "production.write")) notFound();
  const today = vnToday();
  return (
    <>
      <PageHeader title="Lập kế hoạch" description="Tạo kế hoạch, sau đó thêm từng sản phẩm và số chai cần làm." />
      <Card className="max-w-xl">
        <ActionForm action={createPlanAction} submitLabel="Tạo kế hoạch">
          <Field label="Kỳ">
            <select name="period" className="field min-h-11" defaultValue="month">
              <option value="day">Ngày</option>
              <option value="week">Tuần</option>
              <option value="month">Tháng</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Từ ngày">
              <input type="date" name="periodStart" required className="field min-h-11" defaultValue={today} />
            </Field>
            <Field label="Đến ngày">
              <input type="date" name="periodEnd" required className="field min-h-11" />
            </Field>
          </div>
          <Field label="Ghi chú">
            <input name="note" className="field min-h-11" />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
