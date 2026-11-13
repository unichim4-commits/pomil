import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listItems, listSuppliers, listWarehouses } from "@/modules/inventory/admin";
import { suggestItemCode, type ItemKind } from "@/modules/inventory/rules";
import { Card, PageHeader } from "../../../_components/ui";
import { ITEM_KIND_LABEL } from "../../_lib/labels";
import { ItemForm } from "../item-form";

export const metadata: Metadata = { title: "Thêm hàng hóa" };

const KINDS = ["raw_material", "extract", "packaging", "wip"] as const;

export default async function NewItemPage({ searchParams }: { searchParams: Promise<{ nhom?: string }> }) {
  const [sp, staff, db] = await Promise.all([searchParams, requireStaff(), getDb()]);
  if (!can(staff.role, "inventory.write")) redirect("/admin/kho/hang-hoa");
  const [items, sups, whs] = await Promise.all([listItems(db), listSuppliers(db, { activeOnly: true }), listWarehouses(db)]);
  const kind = (KINDS as readonly string[]).includes(sp.nhom ?? "") ? (sp.nhom as ItemKind) : "raw_material";
  const codes = items.map((i) => i.code);
  return (
    <>
      <Link href="/admin/kho/hang-hoa" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Hàng hóa
      </Link>
      <PageHeader title="Thêm hàng hóa" description="Mã gợi ý theo nhóm, sửa được. Chọn nhóm bên dưới để lấy mã gợi ý của nhóm đó." />
      <p className="mb-4 flex flex-wrap gap-2 text-sm">
        {KINDS.map((k) => (
          <Link key={k} href={`/admin/kho/hang-hoa/moi?nhom=${k}`} className={`inline-flex min-h-11 items-center border px-3 ${k === kind ? "border-graphite" : "border-line hover:border-graphite"}`}>
            {ITEM_KIND_LABEL[k]}: {suggestItemCode(k, codes)}
          </Link>
        ))}
      </p>
      <Card>
        <ItemForm key={kind} suggestedCode={suggestItemCode(kind, codes)} defaultKind={kind} supplierList={sups} warehouseList={whs} canWrite />
      </Card>
    </>
  );
}
