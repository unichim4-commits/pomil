import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { formatDateTime } from "@/lib/format";
import { requireStaff } from "@/modules/auth/service";
import { docHref, listItems, listMovements, listWarehouses } from "@/modules/inventory/admin";
import { PageHeader } from "../../_components/ui";
import { DataList, TapLink } from "../_components/data-list";
import { q } from "../_lib/fmt";
import { MOVE_TYPE_LABEL } from "../_lib/labels";
import { ledgerQueryString, parseLedgerQuery, type LedgerQuery } from "./filter";

export const metadata: Metadata = { title: "Sổ kho" };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<LedgerQuery> }) {
  const [sp, , db] = await Promise.all([searchParams, requireStaff(), getDb()]);
  const f = parseLedgerQuery(sp);
  const [rows, items, whs] = await Promise.all([listMovements(db, f, 300), listItems(db), listWarehouses(db)]);
  const qs = ledgerQueryString(f);

  return (
    <>
      <PageHeader
        title="Sổ kho"
        description="Mọi biến động nhập, xuất, chuyển, kiểm kê. Sổ chỉ thêm, không sửa; sai thì đảo bằng chứng từ."
        actions={
          <a href={`/admin/kho/so-kho/csv${qs ? `?${qs}` : ""}`} className="btn btn-outline">
            Tải CSV
          </a>
        }
      />
      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-7 xl:items-end">
        <label className="block">
          <span className="field-label">Hàng</span>
          <select name="hang" defaultValue={f.itemId ?? ""} className="field">
            <option value="">Mọi hàng</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} · {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Mã lô</span>
          <input name="lo" defaultValue={f.lotCode ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Kho</span>
          <select name="kho" defaultValue={f.warehouseId ?? ""} className="field">
            <option value="">Mọi kho</option>
            {whs.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Loại</span>
          <select name="loai" defaultValue={f.type ?? ""} className="field">
            <option value="">Mọi loại</option>
            {Object.entries(MOVE_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Từ ngày</span>
          <input type="date" name="tu" defaultValue={f.from ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Đến ngày</span>
          <input type="date" name="den" defaultValue={f.to ?? ""} className="field" />
        </label>
        <button className="btn btn-outline">Lọc</button>
      </form>
      {rows.length === 300 && <p className="mb-3 text-sm text-ink-soft">Hiện 300 dòng mới nhất. Thu hẹp bộ lọc hoặc tải CSV để xem đủ.</p>}
      <DataList
        rows={rows}
        rowKey={(m) => m.id}
        empty="Không có biến động phù hợp."
        cols={[
          { label: "Lúc", cell: (m) => formatDateTime(m.occurredAt) },
          { label: "Loại", cell: (m) => MOVE_TYPE_LABEL[m.type] },
          {
            label: "Chứng từ",
            cell: (m) => {
              const href = docHref(m.docType, m.docId);
              return href ? (
                <TapLink href={href} className="font-mono">
                  {m.docCode}
                </TapLink>
              ) : (
                m.docCode
              );
            },
          },
          { label: "Hàng", cell: (m) => `${m.itemCode} · ${m.itemName}` },
          {
            label: "Lô",
            cell: (m) => (
              <TapLink href={`/admin/kho/lo/${m.stockLotId}`} className="font-mono">
                {m.lotCode}
              </TapLink>
            ),
          },
          { label: "Vị trí", cell: (m) => `${m.warehouseCode}/${m.locationCode}` },
          {
            label: "±",
            cell: (m) => (
              <span className={m.qty < 0 ? "text-danger" : ""}>
                {m.qty > 0 ? "+" : ""}
                {q(m.qty, m)}
              </span>
            ),
            className: "tabular-nums",
          },
          { label: "Số dư sau", cell: (m) => q(m.balanceAfter, m), className: "tabular-nums" },
          { label: "Người ghi", cell: (m) => m.actorName || "–", hideOnCard: true },
          { label: "Ghi chú", cell: (m) => m.note || "–", hideOnCard: true },
        ]}
      />
    </>
  );
}
