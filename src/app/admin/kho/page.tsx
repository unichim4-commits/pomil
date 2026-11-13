import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatVnd } from "@/lib/format";
import { logError } from "@/lib/log";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { stockOverview, listWarehouses } from "@/modules/inventory/admin";
import { getAlerts } from "@/modules/inventory/alerts";
import { refreshExpiredStock } from "@/modules/inventory/ledger";
import { Badge, PageHeader } from "../_components/ui";
import { DataList, TapLink } from "./_components/data-list";
import { q } from "./_lib/fmt";
import { ITEM_KIND_LABEL } from "./_lib/labels";

export const metadata: Metadata = { title: "Tồn kho" };

const LEVEL_TONE = { info: "neutral", warn: "amber", danger: "red" } as const;

export default async function StockPage({ searchParams }: { searchParams: Promise<{ kho?: string; nhom?: string; canhbao?: string }> }) {
  const [sp, staff, db] = await Promise.all([searchParams, requireStaff(), getDb()]);
  // Lô hết hạn tự rời số bán được (R-KHO-27): chạy tối đa mỗi giờ một lần
  try {
    await refreshExpiredStock(db);
  } catch (error) {
    logError("refreshExpiredStock", error);
  }
  const whs = await listWarehouses(db);
  const warehouseId = whs.some((w) => w.id === sp.kho) ? sp.kho! : null;
  const kind = sp.nhom && sp.nhom in ITEM_KIND_LABEL ? sp.nhom : null;
  const alertsOnly = sp.canhbao === "1";
  const [rows, alerts] = await Promise.all([stockOverview(db, { warehouseId, kind }), getAlerts(staff.role).catch(() => [])]);
  const shown = rows.filter((r) => (r.item.isActive || r.stock.onHand > 0) && (!alertsOnly || r.belowMin || r.expiring || r.expired || r.pendingQc || r.stock.available - r.stock.committed < 0));
  const showValue = can(staff.role, "finance.view");
  const canWrite = can(staff.role, "inventory.write");

  return (
    <>
      <PageHeader
        title="Tồn kho"
        description="Số theo đơn vị hiển thị của từng hàng. Khả dụng là hàng đã đạt kiểm và còn hạn."
        actions={
          <>
            {canWrite && (
              <>
                <Link href="/admin/kho/nhap/moi" className="btn btn-primary">
                  Nhập kho
                </Link>
                <Link href="/admin/kho/xuat/moi" className="btn btn-outline">
                  Xuất kho
                </Link>
                <Link href="/admin/kho/kiem-ke" className="btn btn-outline">
                  Kiểm kê
                </Link>
              </>
            )}
            <Link href="/admin/kho/bao-cao" className="btn btn-outline">
              Báo cáo
            </Link>
          </>
        }
      />

      {alerts.length > 0 && (
        <ul className="mb-6 grid gap-2 sm:grid-cols-2">
          {alerts.map((a, i) => (
            <li key={i}>
              <Link href={a.href} className="flex min-h-11 items-center justify-between gap-3 border border-line bg-paper px-4 py-2 text-sm hover:border-graphite">
                <span>{a.text}</span>
                <Badge tone={LEVEL_TONE[a.level]}>{a.level === "danger" ? "Gấp" : a.level === "warn" ? "Chú ý" : "Tin"}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="block">
          <span className="field-label">Kho</span>
          <select name="kho" defaultValue={warehouseId ?? ""} className="field">
            <option value="">Mọi kho</option>
            {whs.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Nhóm hàng</span>
          <select name="nhom" defaultValue={kind ?? ""} className="field">
            <option value="">Mọi nhóm</option>
            {Object.entries(ITEM_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="canhbao" value="1" defaultChecked={alertsOnly} className="accent-graphite" /> Chỉ hàng có cảnh báo
        </label>
        <button type="submit" className="btn btn-outline">
          Lọc
        </button>
      </form>

      <DataList
        rows={shown}
        rowKey={(r) => r.item.id}
        empty={alertsOnly ? "Không có hàng nào cần chú ý." : "Chưa có hàng hóa. Thêm ở mục Hàng hóa."}
        cols={[
          {
            label: "Hàng",
            cell: (r) => (
              <TapLink href={`/admin/kho/hang-hoa/${r.item.id}`}>
                <span className="font-mono">{r.item.code}</span>&nbsp;{r.item.name}
              </TapLink>
            ),
          },
          { label: "Nhóm", cell: (r) => ITEM_KIND_LABEL[r.item.kind] },
          { label: "Khả dụng", cell: (r) => q(r.stock.available, r.item), className: "tabular-nums" },
          { label: "Cách ly", cell: (r) => (r.stock.quarantine ? q(r.stock.quarantine, r.item) : "–"), className: "tabular-nums" },
          { label: "Không đạt", cell: (r) => (r.stock.rejected ? q(r.stock.rejected, r.item) : "–"), className: "tabular-nums" },
          { label: "Hết hạn", cell: (r) => (r.stock.expired ? q(r.stock.expired, r.item) : "–"), className: "tabular-nums" },
          {
            label: "Đã giữ / cam kết",
            className: "tabular-nums",
            cell: (r) =>
              r.item.kind === "finished" ? (r.stock.reserved ? q(r.stock.reserved, r.item) : "–") : r.stock.committed ? (
                <span className={r.stock.available - r.stock.committed < 0 ? "text-danger" : ""}>{q(r.stock.committed, r.item)}</span>
              ) : (
                "–"
              ),
          },
          { label: "Tối thiểu", cell: (r) => (r.item.minStock !== null ? q(r.item.minStock, r.item) : "–"), className: "tabular-nums" },
          ...(showValue ? [{ label: "Giá trị", cell: (r: (typeof shown)[number]) => formatVnd(r.value), className: "tabular-nums" }] : []),
          {
            label: "Cảnh báo",
            cell: (r) => (
              <span className="flex flex-wrap gap-1">
                {r.belowMin && <Badge tone="amber">Dưới tối thiểu</Badge>}
                {r.pendingQc && <Badge tone="amber">Chờ kiểm</Badge>}
                {r.expiring > 0 && <Badge tone="amber">Sắp hết hạn</Badge>}
                {r.expired > 0 && <Badge tone="red">Hết hạn</Badge>}
                {r.item.kind !== "finished" && r.stock.available - r.stock.committed < 0 && <Badge tone="red">Thiếu cho lệnh SX</Badge>}
                {!r.item.isActive && <Badge>Ngừng dùng</Badge>}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
