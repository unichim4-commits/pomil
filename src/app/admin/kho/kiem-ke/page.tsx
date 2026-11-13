import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listCounts, listWarehouses } from "@/modules/inventory/admin";
import { vnToday } from "@/modules/numbering/rules";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, PageHeader } from "../../_components/ui";
import { DataList, TapLink } from "../_components/data-list";
import { createCountAction } from "../actions";
import { viDate } from "../_lib/fmt";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE } from "../_lib/labels";

export const metadata: Metadata = { title: "Kiểm kê" };

export default async function CountsPage() {
  const [staff, db] = await Promise.all([requireStaff(), getDb()]);
  const [rows, whs] = await Promise.all([listCounts(db), listWarehouses(db)]);
  const canWrite = can(staff.role, "inventory.write");
  return (
    <>
      <PageHeader title="Kiểm kê" description="Tạo phiếu cho một kho: hệ thống chụp số dư từng lô, vị trí. Đếm thực tế, nhập số đếm rồi ghi sổ. Có chênh lệch thì chủ cửa hàng ghi sổ." />
      {canWrite && (
        <Card title="Tạo phiếu kiểm kê" className="mb-6 max-w-3xl">
          <ActionForm action={createCountAction} submitLabel="Tạo phiếu" className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <label className="block">
              <span className="field-label">Kho</span>
              <select name="warehouseId" className="field">
                {whs
                  .filter((w) => w.isActive)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Ngày đếm</span>
              <input type="date" name="countedOn" defaultValue={vnToday()} className="field" />
            </label>
            <label className="block">
              <span className="field-label">Ghi chú</span>
              <input name="note" className="field" />
            </label>
          </ActionForm>
        </Card>
      )}
      <DataList
        rows={rows}
        rowKey={(r) => r.id}
        empty="Chưa có phiếu kiểm kê."
        cols={[
          {
            label: "Phiếu",
            cell: (r) => (
              <TapLink href={`/admin/kho/kiem-ke/${r.id}`} className="font-mono">
                {r.code}
              </TapLink>
            ),
          },
          { label: "Kho", cell: (r) => r.warehouseCode },
          { label: "Ngày đếm", cell: (r) => viDate(r.countedOn) },
          { label: "Đã đếm", cell: (r) => `${r.counted}/${r.lines}`, className: "tabular-nums" },
          { label: "Trạng thái", cell: (r) => <Badge tone={DOC_STATUS_TONE[r.status]}>{DOC_STATUS_LABEL[r.status]}</Badge> },
        ]}
      />
    </>
  );
}
