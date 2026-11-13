import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listWarehouses } from "@/modules/inventory/admin";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, PageHeader } from "../../_components/ui";
import { createLocationAction, createWarehouseAction, toggleLocationAction, toggleWarehouseAction } from "../actions";
import { WAREHOUSE_KIND_LABEL } from "../_lib/labels";

export const metadata: Metadata = { title: "Cài đặt kho" };

export default async function WarehouseSettingsPage() {
  const [staff, db] = await Promise.all([requireStaff(), getDb()]);
  // Chỉ người có inventory.approve tạo, sửa kho và vị trí (R-KHO-4)
  if (!can(staff.role, "inventory.approve")) redirect("/admin/kho");
  const whs = await listWarehouses(db);

  return (
    <>
      <PageHeader title="Cài đặt kho" description="Kho và vị trí. Mỗi kho có sẵn vị trí CHUNG. Kho hoặc vị trí còn hàng thì không ngừng dùng được." />
      <div className="space-y-4">
        {whs.map((w) => (
          <Card
            key={w.id}
            title={`${w.code} · ${w.name}`}
            actions={
              <span className="flex flex-wrap gap-1">
                <Badge>{WAREHOUSE_KIND_LABEL[w.kind]}</Badge>
                {!w.isActive && <Badge tone="red">Ngừng dùng</Badge>}
                {w.hasStock && <Badge tone="green">Có hàng</Badge>}
              </span>
            }
          >
            <ul className="mb-4 divide-y divide-line text-sm">
              {w.locations.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-mono">{l.code}</span>
                    {l.name ? ` · ${l.name}` : ""}
                    {l.isDefault && <span className="text-ink-soft"> (mặc định)</span>}
                    {!l.isActive && <span className="text-danger"> · ngừng dùng</span>}
                    {l.hasStock && <span className="text-ink-soft"> · có hàng</span>}
                  </span>
                  {!l.isDefault && (
                    <ActionForm action={toggleLocationAction} submitLabel={l.isActive ? "Ngừng dùng" : "Dùng lại"} submitClassName="btn btn-outline" inline>
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="on" value={l.isActive ? "0" : "1"} />
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-4">
              {w.isActive && (
                <ActionForm action={createLocationAction} submitLabel="Thêm vị trí" submitClassName="btn btn-outline" className="flex flex-wrap items-end gap-3" resetOnSuccess>
                  <input type="hidden" name="warehouseId" value={w.id} />
                  <label className="block">
                    <span className="field-label">Mã vị trí</span>
                    <input name="code" required placeholder="KE-A1" className="field" />
                  </label>
                  <label className="block">
                    <span className="field-label">Tên</span>
                    <input name="name" className="field" />
                  </label>
                </ActionForm>
              )}
              <ActionForm action={toggleWarehouseAction} submitLabel={w.isActive ? "Ngừng dùng kho" : "Dùng lại kho"} submitClassName="btn btn-outline" confirm={w.isActive ? `Ngừng dùng kho ${w.code}?` : undefined} inline>
                <input type="hidden" name="id" value={w.id} />
                <input type="hidden" name="on" value={w.isActive ? "0" : "1"} />
              </ActionForm>
            </div>
          </Card>
        ))}
      </div>

      <Card title="Thêm kho" className="mt-8 max-w-3xl">
        <ActionForm action={createWarehouseAction} submitLabel="Thêm kho" resetOnSuccess>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="field-label">Mã (2–10 chữ, số)</span>
              <input name="code" required className="field" />
            </label>
            <label className="block">
              <span className="field-label">Tên</span>
              <input name="name" required className="field" />
            </label>
            <label className="block">
              <span className="field-label">Loại</span>
              <select name="kind" className="field">
                {Object.entries(WAREHOUSE_KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-3">
              <span className="field-label">Địa chỉ</span>
              <input name="address" className="field" />
            </label>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
