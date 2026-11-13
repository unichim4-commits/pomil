import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listReceipts, listSuppliers } from "@/modules/inventory/admin";
import { Badge, PageHeader } from "../../_components/ui";
import { DataList, TapLink } from "../_components/data-list";
import { viDate } from "../_lib/fmt";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE, RECEIPT_KIND_LABEL } from "../_lib/labels";

export const metadata: Metadata = { title: "Nhập kho" };

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ loai?: string; tt?: string; ncc?: string; thang?: string }> }) {
  const [sp, staff, db] = await Promise.all([searchParams, requireStaff(), getDb()]);
  const kind = sp.loai && sp.loai in RECEIPT_KIND_LABEL ? sp.loai : null;
  const status = sp.tt && sp.tt in DOC_STATUS_LABEL ? sp.tt : null;
  const month = sp.thang && /^\d{4}-\d{2}$/.test(sp.thang) ? sp.thang : null;
  const [rows, sups] = await Promise.all([listReceipts(db, { kind, status, supplierId: sp.ncc || null, month }), listSuppliers(db)]);
  const supplierId = sups.some((s) => s.id === sp.ncc) ? sp.ncc : "";
  const showValue = can(staff.role, "finance.view");
  type R = (typeof rows)[number];
  return (
    <>
      <PageHeader
        title="Nhập kho"
        description="Lưu nháp, kiểm lại rồi ghi sổ. Hàng cần kiểm vào trạng thái chờ kiểm; phiếu mua có NCC tự ghi công nợ."
        actions={
          can(staff.role, "inventory.write") && (
            <Link href="/admin/kho/nhap/moi" className="btn btn-primary">
              Lập phiếu nhập
            </Link>
          )
        }
      />
      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-5 sm:items-end">
        <label className="block">
          <span className="field-label">Loại</span>
          <select name="loai" defaultValue={kind ?? ""} className="field">
            <option value="">Mọi loại</option>
            {Object.entries(RECEIPT_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Trạng thái</span>
          <select name="tt" defaultValue={status ?? ""} className="field">
            <option value="">Mọi trạng thái</option>
            {Object.entries(DOC_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Nhà cung cấp</span>
          <select name="ncc" defaultValue={supplierId} className="field">
            <option value="">Mọi NCC</option>
            {sups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Tháng</span>
          <input type="month" name="thang" defaultValue={month ?? ""} className="field" />
        </label>
        <button className="btn btn-outline">Lọc</button>
      </form>
      <DataList
        rows={rows}
        rowKey={(r) => r.id}
        empty="Chưa có phiếu nhập."
        cols={[
          {
            label: "Phiếu",
            cell: (r) => (
              <TapLink href={`/admin/kho/nhap/${r.id}`} className="font-mono">
                {r.code}
              </TapLink>
            ),
          },
          { label: "Loại", cell: (r) => RECEIPT_KIND_LABEL[r.kind] },
          { label: "Ngày", cell: (r) => viDate(r.receivedOn) },
          { label: "Kho", cell: (r) => r.warehouseCode },
          { label: "NCC", cell: (r) => r.supplierName ?? "–" },
          { label: "Dòng", cell: (r) => r.lines, className: "tabular-nums" },
          ...(showValue ? [{ label: "Giá trị", cell: (r: R) => formatVnd(r.status === "posted" ? r.totalCost : r.lineCostSum), className: "tabular-nums" }] : []),
          { label: "Trạng thái", cell: (r) => <Badge tone={DOC_STATUS_TONE[r.status]}>{DOC_STATUS_LABEL[r.status]}</Badge> },
        ]}
      />
    </>
  );
}
