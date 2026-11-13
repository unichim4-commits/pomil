import type { MovementFilter } from "@/modules/inventory/admin";
import { MOVE_TYPE_LABEL } from "../_lib/labels";

export type LedgerQuery = { hang?: string; lo?: string; kho?: string; loai?: string; tu?: string; den?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Đọc bộ lọc sổ kho từ query (dùng chung cho trang và file CSV)
export function parseLedgerQuery(sp: LedgerQuery): MovementFilter {
  return {
    itemId: sp.hang && UUID.test(sp.hang) ? sp.hang : null,
    lotCode: sp.lo?.trim().slice(0, 40) || null,
    warehouseId: sp.kho && UUID.test(sp.kho) ? sp.kho : null,
    type: sp.loai && sp.loai in MOVE_TYPE_LABEL ? sp.loai : null,
    from: sp.tu && DAY.test(sp.tu) ? sp.tu : null,
    to: sp.den && DAY.test(sp.den) ? sp.den : null,
  };
}

export function ledgerQueryString(f: MovementFilter): string {
  const p = new URLSearchParams();
  if (f.itemId) p.set("hang", f.itemId);
  if (f.lotCode) p.set("lo", f.lotCode);
  if (f.warehouseId) p.set("kho", f.warehouseId);
  if (f.type) p.set("loai", f.type);
  if (f.from) p.set("tu", f.from);
  if (f.to) p.set("den", f.to);
  return p.toString();
}
