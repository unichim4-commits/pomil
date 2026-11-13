import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listPriceLists } from "@/modules/sales/catalog";
import { ActionForm } from "../../../_components/action-form";
import { Card, Empty, PageHeader } from "../../../_components/ui";
import { saveDealerAction } from "../../actions";
import { DealerFields } from "../dealer-form";

export const metadata: Metadata = { title: "Thêm đại lý" };

export default async function NewDealerPage() {
  const [staff, lists] = await Promise.all([requireStaff(), listPriceLists()]);
  if (!can(staff.role, "sales.write")) return <Empty>Tài khoản của bạn không có quyền thêm đại lý.</Empty>;
  return (
    <>
      <Link href="/admin/ban-hang/dai-ly" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Đại lý
      </Link>
      <PageHeader title="Thêm đại lý" />
      <Card>
        <ActionForm action={saveDealerAction} submitLabel="Tạo đại lý">
          <DealerFields priceLists={lists.filter((l) => l.isActive)} pricing={can(staff.role, "sales.pricing")} />
        </ActionForm>
      </Card>
    </>
  );
}
