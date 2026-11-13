import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { requireStaff } from "@/modules/auth/service";
import { listItems, listStockLots } from "@/modules/inventory/admin";
import { expiryFlag } from "@/modules/inventory/rules";
import { vnToday } from "@/modules/numbering/rules";
import { getErpSettings } from "@/modules/settings/service";
import { Badge, PageHeader } from "../../_components/ui";
import { DataList, TapLink } from "../_components/data-list";
import { q, viDate } from "../_lib/fmt";
import { LOT_STATUS_LABEL, LOT_STATUS_TONE } from "../_lib/labels";

export const metadata: Metadata = { title: "Lô" };

export default async function StockLotsPage({ searchParams }: { searchParams: Promise<{ hang?: string; tt?: string; q?: string; het?: string }> }) {
  const [sp, , db] = await Promise.all([searchParams, requireStaff(), getDb()]);
  const today = vnToday();
  const status = sp.tt && sp.tt in LOT_STATUS_LABEL ? sp.tt : null;
  const items = await listItems(db);
  const itemId = items.some((i) => i.id === sp.hang) ? sp.hang! : null;
  const search = (sp.q ?? "").trim().slice(0, 40) || null;
  const allLots = sp.het === "1";
  const [rows, erp] = await Promise.all([listStockLots(db, { itemId, status, q: search, withStockOnly: !allLots, today }), getErpSettings()]);

  return (
    <>
      <PageHeader title="Lô" description="Lô vật tư và thành phẩm trong kho: trạng thái kiểm, HSD, số dư. Mặc định chỉ hiện lô còn hàng." />
      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-5 sm:items-end">
        <label className="block">
          <span className="field-label">Mã lô</span>
          <input name="q" defaultValue={search ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Hàng</span>
          <select name="hang" defaultValue={itemId ?? ""} className="field">
            <option value="">Mọi hàng</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} · {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Trạng thái</span>
          <select name="tt" defaultValue={status ?? ""} className="field">
            <option value="">Mọi trạng thái</option>
            {Object.entries(LOT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="het" value="1" defaultChecked={allLots} className="accent-graphite" /> Gồm lô đã hết hàng
        </label>
        <button className="btn btn-outline">Lọc</button>
      </form>
      <DataList
        rows={rows}
        rowKey={(r) => r.id}
        empty="Không có lô phù hợp."
        cols={[
          {
            label: "Lô",
            cell: (r) => (
              <TapLink href={`/admin/kho/lo/${r.id}`} className="font-mono">
                {r.code}
              </TapLink>
            ),
          },
          { label: "Hàng", cell: (r) => `${r.itemCode} · ${r.itemName}` },
          { label: "Số dư", cell: (r) => q(r.qty, r), className: "tabular-nums" },
          { label: "Trạng thái", cell: (r) => <Badge tone={LOT_STATUS_TONE[r.status]}>{LOT_STATUS_LABEL[r.status] ?? r.status}</Badge> },
          {
            label: "HSD",
            cell: (r) => {
              const f = r.qty > 0 ? expiryFlag(r.expiresOn, today, erp.expiryWarnDays) : null;
              return (
                <span className="flex flex-wrap items-center gap-1">
                  {viDate(r.expiresOn) || "–"}
                  {f && <Badge tone={f.kind === "expired" ? "red" : "amber"}>{f.kind === "expired" ? "Đã hết hạn" : `Còn ${f.days} ngày`}</Badge>}
                </span>
              );
            },
          },
        ]}
      />
    </>
  );
}
