// Quy tắc tồn kho. Hàm thuần để test được.
// Tồn kho không bao giờ bị ghi đè bằng số trên form: chỉ cộng/trừ một lượng (+50 nhập hàng, -2 hỏng).

export const STOCK_MAX = 1_000_000;
export const STOCK_ADJUST_MAX = 100_000;
export const STOCK_REASON_MAX = 200;

export type StockDeltaResult = { ok: true; delta: number } | { ok: false; message: string };

// Đọc ô "điều chỉnh": nhận "+50", "-2", "50", "− 3" (dấu trừ Unicode), bỏ khoảng trắng.
export function parseStockDelta(raw: string): StockDeltaResult {
  const text = raw.replace(/\s+/g, "").replace(/[−–]/g, "-");
  if (!/^[+-]?\d+$/.test(text)) return { ok: false, message: "Nhập số chai cộng hoặc trừ, ví dụ +50 hoặc -2." };
  const delta = Number(text);
  if (delta === 0) return { ok: false, message: "Số điều chỉnh phải khác 0." };
  if (Math.abs(delta) > STOCK_ADJUST_MAX) return { ok: false, message: `Mỗi lần điều chỉnh tối đa ${STOCK_ADJUST_MAX.toLocaleString("vi-VN")} chai.` };
  return { ok: true, delta };
}

export const STOCK_DIRECTIONS = ["in", "out"] as const;
export type StockDirection = (typeof STOCK_DIRECTIONS)[number];

// Form điều chỉnh trên điện thoại: chọn chiều ("Nhập thêm" = in, "Bớt đi" = out) và gõ số chai dương.
// Bàn phím số của iPhone không có dấu trừ, nên không bắt người dùng gõ "-2".
export function parseStockAdjustment(direction: string, amount: string): StockDeltaResult {
  if (direction !== "in" && direction !== "out") return { ok: false, message: "Chọn Nhập thêm hoặc Bớt đi." };
  const text = amount.replace(/\s+/g, "");
  if (!/^\d+$/.test(text)) return { ok: false, message: "Nhập số chai là số nguyên dương, ví dụ 50." };
  const n = Number(text);
  if (n === 0) return { ok: false, message: "Số chai phải lớn hơn 0." };
  if (n > STOCK_ADJUST_MAX) return { ok: false, message: `Mỗi lần điều chỉnh tối đa ${STOCK_ADJUST_MAX.toLocaleString("vi-VN")} chai.` };
  return { ok: true, delta: direction === "in" ? n : -n };
}

export function stockReasonProblem(reason: string): string | null {
  const r = reason.trim();
  if (r.length < 2) return "Ghi lý do điều chỉnh, ví dụ “Nhập lô PST-…” hoặc “Vỡ 2 chai”.";
  if (r.length > STOCK_REASON_MAX) return `Lý do tối đa ${STOCK_REASON_MAX} ký tự.`;
  return null;
}

export type ApplyStockResult = { ok: true; next: number } | { ok: false; message: string };

// Tồn sau điều chỉnh: không âm, không vượt STOCK_MAX.
export function applyStockDelta(current: number, delta: number): ApplyStockResult {
  const next = current + delta;
  if (next < 0) return { ok: false, message: `Tồn kho chỉ còn ${current} chai, không trừ được ${-delta}.` };
  if (next > STOCK_MAX) return { ok: false, message: `Tồn kho tối đa ${STOCK_MAX.toLocaleString("vi-VN")} chai.` };
  return { ok: true, next };
}

// Tồn ban đầu khi tạo sản phẩm mới.
export function initialStockProblem(value: number): string | null {
  if (!Number.isInteger(value) || value < 0) return "Tồn kho ban đầu là số nguyên từ 0.";
  if (value > STOCK_MAX) return `Tồn kho tối đa ${STOCK_MAX.toLocaleString("vi-VN")} chai.`;
  return null;
}
