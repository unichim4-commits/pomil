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

// ---------------------------------------------------------------------------------------------
// Sản phẩm mở rộng (02-san-xuat.md R-SX-1, R-SX-2)

export const DEV_STAGES = ["developing", "testing", "commercial", "discontinued"] as const;
export type DevStage = (typeof DEV_STAGES)[number];

export const DEV_STAGE_LABEL: Record<DevStage, string> = {
  developing: "Đang phát triển",
  testing: "Thử nghiệm",
  commercial: "Thương mại",
  discontinued: "Ngừng sản xuất",
};

export const CATEGORY_LABEL: Record<string, string> = {
  tonic: "Nước dưỡng da đầu",
  shampoo: "Dầu gội",
  conditioner: "Dầu xả",
  hair_serum: "Serum tóc",
  skincare: "Chăm sóc da",
  essential_oil: "Tinh dầu",
  other: "Khác",
};

export const DISCONTINUED_ACTIVE = "Sản phẩm ngừng sản xuất không để ở trạng thái đang bán";

// R-SX-1: chặn ngừng sản xuất + đang bán; cảnh báo đang phát triển/thử nghiệm + đang bán
export function checkDevStage(devStage: DevStage, status: string): { error: string | null; warning: string | null } {
  if (status !== "active") return { error: null, warning: null };
  if (devStage === "discontinued") return { error: DISCONTINUED_ACTIVE, warning: null };
  if (devStage === "developing" || devStage === "testing") return { error: null, warning: `Sản phẩm đang ở giai đoạn ${DEV_STAGE_LABEL[devStage].toLowerCase()} mà để đang bán` };
  return { error: null, warning: null };
}

// R-SX-1: form không gửi dev_stage → giữ giá trị cũ; tạo mới → commercial nếu đang bán, ngược lại developing
export function resolveDevStage(sent: DevStage | null | undefined, existing: DevStage | null, status: string): DevStage {
  if (sent) return sent;
  if (existing) return existing;
  return status === "active" ? "commercial" : "developing";
}

export function isCategory(v: string): boolean {
  return v === "" || v in CATEGORY_LABEL;
}

// R-SX-2: GTIN-13, số kiểm tra theo trọng số 1-3 từ trái
export function checkGtin13(raw: string): string | null {
  const code = raw.trim();
  if (!/^\d{13}$/.test(code)) return "Mã vạch phải gồm đúng 13 chữ số";
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  if (check !== Number(code[12])) return "Mã vạch sai số kiểm tra";
  return null;
}

// Ô "size" trống thì gợi ý từ dung tích tịnh: 100.000 ul → "100 ml"; 50.000 mg → "50 g"
export function sizeLabelFromNet(netQty: number | null, netUom: "mg" | "ul" | null): string {
  if (!netQty || !netUom) return "";
  const unit = netUom === "ul" ? (netQty >= 1_000_000 ? "l" : "ml") : netQty >= 1_000_000 ? "kg" : "g";
  const factor = unit === "l" || unit === "kg" ? 1_000_000 : 1_000;
  const value = netQty / factor;
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 3 })} ${unit}`;
}
