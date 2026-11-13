import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { Card, PageHeader } from "../../../_components/ui";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Thêm nhà cung cấp" };

export default async function NewSupplierPage() {
  const staff = await requireStaff();
  if (!can(staff.role, "inventory.write")) redirect("/admin/kho/nha-cung-cap");
  return (
    <>
      <Link href="/admin/kho/nha-cung-cap" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Nhà cung cấp
      </Link>
      <PageHeader title="Thêm nhà cung cấp" />
      <Card className="max-w-3xl">
        <SupplierForm />
      </Card>
    </>
  );
}
