// Đọc form của phân hệ Sản xuất (chạy ở máy chủ, dùng trong actions.ts). Lỗi nhập → UserError để guard() báo nguyên câu.
import { UserError } from "@/lib/errors";
import { DISPLAY_UOM, parseQty, parseVnNumber, type DisplayUom } from "@/modules/inventory/rules";
import { parsePercent } from "@/modules/production/rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export function optText(fd: FormData, key: string): string | null {
  const v = text(fd, key);
  return v === "" ? null : v;
}

export function idOf(fd: FormData, key = "id", label = "Lựa chọn"): string {
  const v = text(fd, key);
  if (!UUID.test(v)) throw new UserError(`${label} chưa chọn hoặc không hợp lệ`);
  return v;
}

export function optIdOf(fd: FormData, key: string): string | null {
  const v = text(fd, key);
  if (!v) return null;
  if (!UUID.test(v)) throw new UserError("Lựa chọn không hợp lệ");
  return v;
}

export function optDateOf(fd: FormData, key: string): string | null {
  const v = text(fd, key);
  if (!v) return null;
  if (!DATE.test(v)) throw new UserError("Ngày chưa đúng");
  return v;
}

export function dateOf(fd: FormData, key: string, label: string): string {
  const v = optDateOf(fd, key);
  if (!v) throw new UserError(`Nhập ${label}`);
  return v;
}

// Số nguyên ≥ 0, cho phép "1.000"
export function intOf(raw: string, label: string, opts: { min?: number; allowEmpty?: boolean } = {}): number | null {
  if (!raw.trim()) {
    if (opts.allowEmpty) return null;
    throw new UserError(`Nhập ${label}`);
  }
  const n = parseVnNumber(raw);
  if (!n || n.frac !== "") throw new UserError(`${label} phải là số nguyên`);
  const v = Number(n.int);
  if (!Number.isSafeInteger(v) || v > 2_000_000_000) throw new UserError(`${label} quá lớn`);
  if (opts.min !== undefined && v < opts.min) throw new UserError(`${label} phải từ ${opts.min} trở lên`);
  return v;
}

// Tiền nguyên đồng; trống = 0
export function moneyOf(fd: FormData, key: string, label: string): number {
  return intOf(text(fd, key), label, { allowEmpty: true }) ?? 0;
}

export function optMoneyOf(fd: FormData, key: string, label: string): number | null {
  return intOf(text(fd, key), label, { allowEmpty: true });
}

// Số lượng theo đơn vị hiển thị (R-CHUNG-1)
export function qtyOf(raw: string, uom: string, label: string): number {
  if (!DISPLAY_UOM[uom as DisplayUom]) throw new UserError(`Đơn vị ${uom} không hợp lệ`);
  const r = parseQty(raw, uom as DisplayUom);
  if (!r.ok) throw new UserError(`${label}: ${r.message}`);
  if (r.qty <= 0) throw new UserError(`${label} phải lớn hơn 0`);
  return r.qty;
}

export function percentOf(raw: string, label: string): number {
  const r = parsePercent(raw);
  if (!r.ok) throw new UserError(`${label}: ${r.message}`);
  return r.ppm;
}

// Phần trăm → điểm cơ bản (98% → 9.800)
export function bpOf(raw: string, label: string): number {
  return Math.round(percentOf(raw, label) / 100);
}
