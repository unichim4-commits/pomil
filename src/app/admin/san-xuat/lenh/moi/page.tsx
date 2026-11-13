import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listUsableVersions } from "@/modules/production/formulas";
import { ActionForm } from "../../../_components/action-form";
import { Card, PageHeader } from "../../../_components/ui";
import { createOrderAction } from "../../actions";
import { OrderFields } from "../../_components/order-fields";
import { productOptions, supplierOptions } from "../../_lib/data";

export const metadata: Metadata = { title: "Tạo lệnh sản xuất" };

export default async function NewOrderPage() {
  const staff = await requireStaff();
  if (!can(staff.role, "production.write")) notFound();
  const db = await getDb();
  const [products, versions, factories] = await Promise.all([productOptions(db), listUsableVersions(db), supplierOptions(db, ["factory"])]);
  return (
    <>
      <PageHeader title="Tạo lệnh sản xuất" description="Lệnh mới ở dạng nháp. Lên kế hoạch để sinh định mức và công đoạn, rồi gửi duyệt." />
      <Card className="max-w-3xl">
        <ActionForm action={createOrderAction} submitLabel="Tạo lệnh">
          <OrderFields
            products={products.map((p) => ({ id: p.id, label: `${p.name} (${p.code})` }))}
            versions={versions.map((v) => ({ id: v.id, label: `${v.label}${v.status === "trial" ? " (thử)" : ""}` }))}
            factories={factories.map((s) => ({ id: s.id, label: s.name }))}
            showMoney={can(staff.role, "finance.view")}
          />
        </ActionForm>
      </Card>
    </>
  );
}
