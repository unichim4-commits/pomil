// Đọc form nhiều dòng của phiếu Kho (chạy ở máy chủ, dùng trong actions.ts)
import { UserError } from "@/lib/errors";
import { DISPLAY_UOM, lineCostOf, parseQty, parseVnNumber, type DisplayUom } from "@/modules/inventory/rules";

export const LINE_ROWS = 6;

export function field(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export function optField(fd: FormData, key: string): string | null {
  const v = field(fd, key);
  return v === "" ? null : v;
}

export function optDate(fd: FormData, key: string): string | null {
  const v = field(fd, key);
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError("Ngày chưa đúng");
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function optId(fd: FormData, key: string): string | null {
  const v = field(fd, key);
  if (!v) return null;
  if (!UUID.test(v)) throw new UserError("Lựa chọn không hợp lệ");
  return v;
}

// Số lượng theo đơn vị hiển thị của hàng (R-CHUNG-1). label để báo lỗi đúng dòng.
export function qtyOf(raw: string, displayUom: string, label: string): number {
  const r = parseQty(raw, displayUom as DisplayUom);
  if (!r.ok) throw new UserError(`${label}: ${r.message}`);
  if (r.qty <= 0) throw new UserError(`${label}: số lượng phải lớn hơn 0`);
  return r.qty;
}

// Số tiền nguyên đồng, cho phép "1.800.000"
export function moneyOf(raw: string, label: string): number | null {
  if (!raw) return null;
  const n = parseVnNumber(raw);
  if (!n || n.frac !== "") throw new UserError(`${label}: số tiền không hợp lệ`);
  const v = Number(n.int);
  if (!Number.isSafeInteger(v) || v > 2_147_483_647) throw new UserError(`${label}: số tiền quá lớn`);
  return v;
}

// Thành tiền dòng: ưu tiên ô thành tiền; không có thì đơn giá × số lượng (R-KHO-14)
export function lineCostFrom(lineCostRaw: string, unitPriceRaw: string, qty: number, purchaseUom: string, label: string): number {
  const cost = moneyOf(lineCostRaw, label);
  if (cost !== null) return cost;
  const price = moneyOf(unitPriceRaw, label);
  if (price === null) return 0;
  const factor = DISPLAY_UOM[purchaseUom as DisplayUom]?.factor ?? 1;
  return lineCostOf(price, qty, factor);
}
