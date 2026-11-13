import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listItems } from "@/modules/inventory/admin";
import { Badge, FilterTabs, PageHeader } from "../../_components/ui";
import { DataList, TapLink } from "../_components/data-list";
import { q } from "../_lib/fmt";
import { ITEM_KIND_LABEL } from "../_lib/labels";

export const metadata: Metadata = { title: "Hàng hóa" };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ nhom?: string; q?: string }> }) {
  const [sp, staff, db] = await Promise.all([searchParams, requireStaff(), getDb()]);
  const kind = sp.nhom && sp.nhom in ITEM_KIND_LABEL ? sp.nhom : null;
  const items = await listItems(db, { kind, q: sp.q?.trim().slice(0, 40) || null });
  return (
    <>
      <PageHeader
        title="Hàng hóa"
        description="Nguyên liệu, tinh dầu, bao bì, bán thành phẩm và thành phẩm. Hàng thành phẩm tự tạo theo sản phẩm."
        actions={
          can(staff.role, "inventory.write") && (
            <Link href="/admin/kho/hang-hoa/moi" className="btn btn-primary">
              Thêm hàng
            </Link>
          )
        }
      />
      <FilterTabs
        active={kind ?? "all"}
        items={[{ key: "all", href: "/admin/kho/hang-hoa", label: "Tất cả" }, ...Object.entries(ITEM_KIND_LABEL).map(([k, v]) => ({ key: k, href: `/admin/kho/hang-hoa?nhom=${k}`, label: v }))]}
      />
      <form method="get" className="mb-4 flex gap-2">
        {kind && <input type="hidden" name="nhom" value={kind} />}
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Tìm mã hoặc tên" className="field" />
        <button className="btn btn-outline">Tìm</button>
      </form>
      <DataList
        rows={items}
        rowKey={(i) => i.id}
        empty="Chưa có hàng nào."
        cols={[
          {
            label: "Hàng",
            cell: (i) => (
              <TapLink href={`/admin/kho/hang-hoa/${i.id}`}>
                <span className="font-mono">{i.code}</span>&nbsp;{i.name}
              </TapLink>
            ),
          },
          { label: "Nhóm", cell: (i) => `${ITEM_KIND_LABEL[i.kind]}${i.groupName ? ` · ${i.groupName}` : ""}` },
          { label: "Đơn vị", cell: (i) => i.displayUom },
          { label: "Tối thiểu", cell: (i) => (i.minStock !== null ? q(i.minStock, i) : "–") },
          { label: "IQC", cell: (i) => (i.requiresIqc ? "Cần kiểm" : "Không") },
          { label: "Trạng thái", cell: (i) => (i.isActive ? <Badge tone="green">Đang dùng</Badge> : <Badge>Ngừng dùng</Badge>) },
        ]}
      />
    </>
  );
}
