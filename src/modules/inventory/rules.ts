// Kho: kiểu và hàm thuần (00-tong-quan.md mục 8.2). Chữ ký do T-14a chốt; thân hàm T-14b-A.
import type { stockMoveType } from "@/db/schema";

export type BaseUom = "mg" | "ul" | "pcs";
export type DisplayUom = "kg" | "g" | "mg" | "l" | "ml" | "cái" | "chai" | "lọ" | "hộp" | "nắp" | "nhãn" | "cuộn" | "tờ" | "gói";
export type WarehouseKind = "raw" | "extract" | "packaging" | "wip" | "finished" | "rejected";
export type StockLotQcStatus = "pending" | "released" | "rejected" | "on_hold";
export type StockMoveType = (typeof stockMoveType.enumValues)[number];
export type StockDocType = "receipt" | "issue" | "transfer" | "count" | "order";
export type StockDocRef = { docType: StockDocType; docId: string; docCode: string; actorId: string | null; at?: Date };
export type StockMoveInput = {
  type: StockMoveType;
  stockLotId: string;
  locationId: string;
  qty: number;
  orderItemId?: string | null;
  productionOrderId?: string | null;
  extractionRunId?: string | null;
  reversalOf?: string | null;
  note?: string | null;
};
export type FefoCandidate = {
  stockLotId: string;
  locationId: string;
  warehouseId: string;
  qty: number;
  code: string;
  expiresOn: string | null;
  manufacturedOn: string | null;
  usable: boolean;
  // Câu lỗi khi không dùng được (unusableLotMessage), để báo đúng nguyên nhân khi chọn lô tay
  unusableMessage?: string | null;
};
export type FefoPick = { stockLotId: string; locationId: string; warehouseId: string; qty: number };
export type ItemStock = { onHand: number; available: number; quarantine: number; rejected: number; expired: number; reserved: number; committed: number };
export type NewStockLot = {
  itemId: string;
  prefix?: "VT" | "EX";
  code?: string;
  productLotId?: string | null;
  supplierId?: string | null;
  supplierLotNo?: string | null;
  manufacturedOn?: string | null;
  expiresOn?: string | null;
  receivedQty: number;
  receivedCost: number;
  qcStatus?: StockLotQcStatus | null;
  source: { docType: StockDocType; docId: string };
  productionOrderId?: string | null;
  extractionRunId?: string | null;
};
export type ReceiptLineInput = {
  itemId: string;
  qty: number;
  lineCost: number;
  locationId?: string | null;
  stockLotId?: string | null;
  productLotId?: string | null;
  supplierLotNo?: string | null;
  manufacturedOn?: string | null;
  expiresOn?: string | null;
  qcRequired?: boolean;
  note?: string | null;
};
export type ReceiptInput = {
  kind: "purchase" | "production" | "extraction" | "customer_return" | "production_return" | "opening" | "other";
  warehouseId: string;
  supplierId?: string | null;
  receivedOn: string;
  invoiceNo?: string | null;
  fileIds?: string[];
  source?: { type: string; id: string } | null;
  paymentMode?: "payable" | "paid_now" | "none";
  payAccountId?: string | null;
  note?: string | null;
  lines: ReceiptLineInput[];
};
export type IssueInput = {
  kind: "production" | "extraction" | "sample" | "qc_sample" | "scrap" | "research" | "supplier_return" | "other";
  warehouseId?: string | null;
  productionOrderId?: string | null;
  extractionRunId?: string | null;
  purpose?: string | null;
  note?: string | null;
  fileIds?: string[];
  lines: { itemId: string; qty: number; stockLotId?: string | null; locationId?: string | null; note?: string | null }[];
};

// Bảng đơn vị hiển thị → cơ sở (R-CHUNG-1)
export const DISPLAY_UOM: Record<DisplayUom, { base: BaseUom; factor: number }> = {
  kg: { base: "mg", factor: 1_000_000 },
  g: { base: "mg", factor: 1_000 },
  mg: { base: "mg", factor: 1 },
  l: { base: "ul", factor: 1_000_000 },
  ml: { base: "ul", factor: 1_000 },
  "cái": { base: "pcs", factor: 1 },
  chai: { base: "pcs", factor: 1 },
  "lọ": { base: "pcs", factor: 1 },
  "hộp": { base: "pcs", factor: 1 },
  "nắp": { base: "pcs", factor: 1 },
  "nhãn": { base: "pcs", factor: 1 },
  "cuộn": { base: "pcs", factor: 1 },
  "tờ": { base: "pcs", factor: 1 },
  "gói": { base: "pcs", factor: 1 },
};

// Giới hạn một số lượng (R-CHUNG-1)
export const MAX_QTY = 9_000_000_000_000;

// ---------------------------------------------------------------------------------------------
// Số lượng (R-CHUNG-1, R-CHUNG-2)

const DIGITS = /^\d+$/;

// Tách phần nguyên và phần lẻ theo kiểu Việt Nam: dấu phẩy là thập phân, dấu chấm và khoảng trắng phân cách nghìn.
// Trả null nếu không phải số không âm hợp lệ. Nhóm nghìn phải đủ 3 chữ số ("1.5" là lỗi, tránh hiểu nhầm 1,5).
export function parseVnNumber(raw: string): { int: string; frac: string } | null {
  const s = raw.trim().replace(/[  ]/g, " ");
  if (s === "") return null;
  const parts = s.split(",");
  if (parts.length > 2) return null;
  const intRaw = parts[0]!;
  const fracRaw = parts[1] ?? "";
  if (parts.length === 2 && !DIGITS.test(fracRaw)) return null;
  const groups = intRaw.split(/[. ]/);
  if (groups.length > 1) {
    if (!/^\d{1,3}$/.test(groups[0]!)) return null;
    for (const g of groups.slice(1)) if (!/^\d{3}$/.test(g)) return null;
  } else if (!DIGITS.test(groups[0]!)) {
    // ",5" = 0,5
    if (!(groups[0] === "" && parts.length === 2)) return null;
  }
  const int = groups.join("").replace(/^0+(?=\d)/, "") || "0";
  return { int, frac: fracRaw.replace(/0+$/, "") };
}

function decimalsOf(factor: number): number {
  return Math.round(Math.log10(factor));
}

// "1,5" kg → 1.500.000 mg; "2,5" chai → lỗi; "0,0005" g → lỗi (R-CHUNG-1)
export function parseQty(raw: string, uom: DisplayUom): { ok: true; qty: number } | { ok: false; message: string } {
  const def = DISPLAY_UOM[uom];
  if (!def) return { ok: false, message: `Đơn vị ${uom} không hợp lệ` };
  const n = parseVnNumber(raw);
  if (!n) return { ok: false, message: "Số lượng không hợp lệ" };
  const decimals = decimalsOf(def.factor);
  if (n.frac.length > decimals) {
    return decimals === 0
      ? { ok: false, message: `Số ${uom} phải là số nguyên` }
      : { ok: false, message: `Số lẻ quá nhỏ, tối đa ${decimals} chữ số sau dấu phẩy với ${uom}` };
  }
  const fracPart = decimals > 0 ? BigInt(n.frac.padEnd(decimals, "0")) : BigInt(0);
  const qty = BigInt(n.int) * BigInt(def.factor) + fracPart;
  if (qty > BigInt(MAX_QTY)) return { ok: false, message: "Số lượng quá lớn" };
  return { ok: true, qty: Number(qty) };
}

const DEFAULT_DISPLAY: Record<BaseUom, DisplayUom[]> = { mg: ["kg", "g", "mg"], ul: ["l", "ml"], pcs: ["cái"] };

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// 1.500.000 mg + kg → "1,5 kg"; 80 pcs + cái → "80 cái". Không truyền đơn vị: chọn đơn vị lớn nhất mà số ≥ 1.
export function formatQty(qty: number, baseUom: BaseUom, displayUom?: DisplayUom): string {
  let uom: DisplayUom;
  if (displayUom && DISPLAY_UOM[displayUom]?.base === baseUom) uom = displayUom;
  else {
    const options = DEFAULT_DISPLAY[baseUom];
    uom = options.find((u) => Math.abs(qty) >= DISPLAY_UOM[u].factor) ?? options[options.length - 1]!;
  }
  const factor = BigInt(DISPLAY_UOM[uom].factor);
  const neg = qty < 0;
  const abs = BigInt(Math.abs(Math.trunc(qty)));
  const int = (abs / factor).toString();
  const decimals = decimalsOf(DISPLAY_UOM[uom].factor);
  const frac = decimals > 0 ? (abs % factor).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${groupThousands(int)}${frac ? "," + frac : ""} ${uom}`;
}

// Chia làm tròn nửa lên (xa 0) bằng BigInt
function divRound(num: bigint, den: bigint): bigint {
  const zero = BigInt(0);
  if (den === zero) return zero;
  const neg = num < zero !== den < zero;
  const a = num < zero ? -num : num;
  const b = den < zero ? -den : den;
  const q = (a * BigInt(2) + b) / (BigInt(2) * b);
  return neg ? -q : q;
}

// mg ↔ ul theo khối lượng riêng (mg/ml); 1 ml = 1.000 ul. Làm tròn nửa lên.
export function convertQty(qty: number, from: BaseUom, to: BaseUom, densityMgPerMl: number | null): { ok: true; qty: number } | { ok: false; message: string } {
  if (from === to) return { ok: true, qty };
  if (from === "pcs" || to === "pcs") return { ok: false, message: "Không đổi được giữa hàng đếm và hàng cân, đong" };
  if (!densityMgPerMl || densityMgPerMl <= 0) return { ok: false, message: "Hàng chưa có khối lượng riêng, không đổi được giữa khối lượng và thể tích" };
  const q = BigInt(Math.trunc(qty));
  const d = BigInt(densityMgPerMl);
  const out = from === "ul" ? divRound(q * d, BigInt(1000)) : divRound(q * BigInt(1000), d);
  return { ok: true, qty: Number(out) };
}

// round(qty × receivedCost / receivedQty) bằng BigInt, làm tròn nửa lên (R-CHUNG-5).
// qty âm cho kết quả âm cùng độ lớn. receivedQty ≤ 0 → 0.
export function costOfQty(qty: number, receivedQty: number, receivedCost: number): number {
  if (!(receivedQty > 0) || qty === 0 || receivedCost === 0) return 0;
  return Number(divRound(BigInt(Math.trunc(qty)) * BigInt(Math.trunc(receivedCost)), BigInt(Math.trunc(receivedQty))));
}

// ---------------------------------------------------------------------------------------------
// Lô (R-KHO-8, R-KHO-10)

export type ProductLotStatus = "quarantine" | "released" | "on_hold" | "recalled" | "rejected";

// Lô vật tư (qcStatus khác null): released và chưa hết hạn (HSD null = không hết hạn).
// Lô thành phẩm (qcStatus null): lots.release_status = released và chưa hết hạn. Hết hạn khi HSD ≤ hôm nay.
export function isLotUsable(
  lot: { qcStatus: StockLotQcStatus | null; productLotStatus: ProductLotStatus | null; expiresOn: string | null },
  today: string,
): boolean {
  if (isExpired(lot.expiresOn, today)) return false;
  if (lot.qcStatus !== null) return lot.qcStatus === "released";
  return lot.productLotStatus === "released";
}

export function isExpired(expiresOn: string | null, today: string): boolean {
  return expiresOn !== null && expiresOn <= today;
}

function cmpNullLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Thứ tự FEFO: HSD tăng (null cuối), NSX tăng (null cuối), mã lô. Cùng lô thì giữ thứ tự đầu vào
// (sắp xếp ổn định; người gọi đưa ứng viên theo mã vị trí).
export function compareFefo(a: FefoCandidate, b: FefoCandidate): number {
  return cmpNullLast(a.expiresOn, b.expiresOn) || cmpNullLast(a.manufacturedOn, b.manufacturedOn) || cmpStr(a.code, b.code);
}

export function planFefo(candidates: FefoCandidate[], qty: number, today: string): { ok: true; picks: FefoPick[] } | { ok: false; available: number } {
  const usable = candidates.filter((c) => c.usable && c.qty > 0 && !isExpired(c.expiresOn, today)).sort(compareFefo);
  const available = usable.reduce((s, c) => s + c.qty, 0);
  if (qty <= 0) return { ok: true, picks: [] };
  if (available < qty) return { ok: false, available };
  const picks: FefoPick[] = [];
  let need = qty;
  for (const c of usable) {
    if (need <= 0) break;
    const take = Math.min(need, c.qty);
    picks.push({ stockLotId: c.stockLotId, locationId: c.locationId, warehouseId: c.warehouseId, qty: take });
    need -= take;
  }
  return { ok: true, picks };
}

// max(0, khả dụng FG − đã giữ) (R-KHO-23)
export function sellableStock(availableFg: number, reserved: number): number {
  return Math.max(0, availableFg - reserved);
}

// ---------------------------------------------------------------------------------------------
// Loại biến động (R-KHO-6)

type MoveRule = { sign: 1 | -1 | 0; kinds: WarehouseKind[] | "all"; needsUsable: boolean };
const ALL_KINDS: WarehouseKind[] = ["raw", "extract", "packaging", "wip", "finished", "rejected"];
const ALL_BUT_REJ: WarehouseKind[] = ["raw", "extract", "packaging", "wip", "finished"];

export const MOVE_RULES: Record<StockMoveType, MoveRule> = {
  opening: { sign: 1, kinds: "all", needsUsable: false },
  purchase_receipt: { sign: 1, kinds: ["raw", "extract", "packaging", "wip", "rejected"], needsUsable: false },
  production_receipt: { sign: 1, kinds: ["finished", "wip"], needsUsable: false },
  extraction_receipt: { sign: 1, kinds: ["extract"], needsUsable: false },
  return_receipt: { sign: 1, kinds: ["finished", "rejected"], needsUsable: false },
  production_return: { sign: 1, kinds: ["raw", "extract", "packaging", "wip"], needsUsable: false },
  other_receipt: { sign: 1, kinds: "all", needsUsable: false },
  production_issue: { sign: -1, kinds: ["raw", "extract", "packaging", "wip"], needsUsable: true },
  extraction_issue: { sign: -1, kinds: ["raw"], needsUsable: true },
  sale_issue: { sign: -1, kinds: ["finished"], needsUsable: true },
  sample_issue: { sign: -1, kinds: ALL_BUT_REJ, needsUsable: true },
  qc_sample_issue: { sign: -1, kinds: "all", needsUsable: false },
  research_issue: { sign: -1, kinds: ALL_BUT_REJ, needsUsable: true },
  scrap_issue: { sign: -1, kinds: "all", needsUsable: false },
  supplier_return: { sign: -1, kinds: "all", needsUsable: false },
  other_issue: { sign: -1, kinds: "all", needsUsable: false },
  transfer_out: { sign: -1, kinds: "all", needsUsable: false },
  transfer_in: { sign: 1, kinds: "all", needsUsable: false },
  count_adjust: { sign: 0, kinds: "all", needsUsable: false },
  reversal: { sign: 0, kinds: "all", needsUsable: false },
};

// 0 = count_adjust, reversal: dấu theo dòng gốc
export function moveSign(type: StockMoveType): 1 | -1 | 0 {
  return MOVE_RULES[type].sign;
}

export function moveKinds(type: StockMoveType): WarehouseKind[] {
  const k = MOVE_RULES[type].kinds;
  return k === "all" ? ALL_KINDS : k;
}

export function moveNeedsUsableLot(type: StockMoveType): boolean {
  return MOVE_RULES[type].needsUsable;
}

const MOVE_LABEL: Record<StockMoveType, string> = {
  opening: "nhập tồn đầu kỳ",
  purchase_receipt: "nhập mua",
  production_receipt: "nhập sản xuất",
  extraction_receipt: "nhập dịch chiết",
  return_receipt: "nhập hàng trả",
  production_return: "nhập trả NVL thừa",
  other_receipt: "nhập khác",
  production_issue: "xuất sản xuất",
  extraction_issue: "xuất chiết",
  sale_issue: "xuất bán",
  sample_issue: "xuất mẫu",
  qc_sample_issue: "xuất mẫu lưu",
  research_issue: "xuất nghiên cứu",
  scrap_issue: "xuất hủy",
  supplier_return: "xuất trả NCC",
  other_issue: "xuất khác",
  transfer_out: "chuyển đi",
  transfer_in: "chuyển đến",
  count_adjust: "điều chỉnh kiểm kê",
  reversal: "đảo",
};

export const WAREHOUSE_LABEL: Record<WarehouseKind, string> = {
  raw: "kho nguyên liệu",
  extract: "kho tinh dầu và dịch chiết",
  packaging: "kho bao bì",
  wip: "kho bán thành phẩm",
  finished: "kho thành phẩm",
  rejected: "kho hàng lỗi, cách ly",
};

// R-KHO-4: thành phẩm chỉ ở kho finished/rejected; hàng khác ở mọi kho trừ finished.
export function checkItemWarehouse(itemIsFinished: boolean, warehouseKind: WarehouseKind): string | null {
  if (itemIsFinished && warehouseKind !== "finished" && warehouseKind !== "rejected") return `Hàng thành phẩm không để ở ${WAREHOUSE_LABEL[warehouseKind]}`;
  if (!itemIsFinished && warehouseKind === "finished") return "Kho thành phẩm chỉ chứa hàng thành phẩm";
  return null;
}

// Kiểm một dòng biến động theo bảng R-KHO-6 (không kiểm lô khả dụng, không kiểm dấu reversal). Trả câu lỗi hoặc null.
// Ví dụ: sale_issue +2 → "Sai dấu"; production_issue từ kho FG → "Không xuất sản xuất từ kho thành phẩm".
export function checkMoveRule(type: StockMoveType, qty: number, warehouseKind: WarehouseKind, itemIsFinished: boolean): string | null {
  const rule = MOVE_RULES[type];
  if (!Number.isSafeInteger(qty) || qty === 0) return "Số lượng biến động phải là số nguyên khác 0";
  if (Math.abs(qty) > MAX_QTY) return "Số lượng quá lớn";
  if (rule.sign !== 0 && Math.sign(qty) !== rule.sign) return "Sai dấu";
  if (rule.kinds !== "all" && !rule.kinds.includes(warehouseKind)) {
    const label = MOVE_LABEL[type];
    return rule.sign < 0 ? `Không ${label} từ ${WAREHOUSE_LABEL[warehouseKind]}` : `Không ${label} vào ${WAREHOUSE_LABEL[warehouseKind]}`;
  }
  // Hàng chỉ được đưa vào kho hợp loại (R-KHO-4); lấy ra thì luôn được để dọn hàng đặt sai.
  if (qty > 0) return checkItemWarehouse(itemIsFinished, warehouseKind);
  return null;
}

export const RECEIPT_MOVE: Record<ReceiptInput["kind"], StockMoveType> = {
  purchase: "purchase_receipt",
  production: "production_receipt",
  extraction: "extraction_receipt",
  customer_return: "return_receipt",
  production_return: "production_return",
  opening: "opening",
  other: "other_receipt",
};

export const ISSUE_MOVE: Record<IssueInput["kind"], StockMoveType> = {
  production: "production_issue",
  extraction: "extraction_issue",
  sample: "sample_issue",
  qc_sample: "qc_sample_issue",
  scrap: "scrap_issue",
  research: "research_issue",
  supplier_return: "supplier_return",
  other: "other_issue",
};

// ---------------------------------------------------------------------------------------------
// Hàng hóa (R-KHO-1, R-KHO-2)

export function normalizeItemCode(raw: string): { ok: true; code: string } | { ok: false; message: string } {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(code)) return { ok: false, message: "Mã chỉ gồm chữ, số và gạch ngang" };
  if (code.length < 2 || code.length > 20) return { ok: false, message: "Mã dài 2–20 ký tự" };
  return { ok: true, code };
}

const BASE_LABEL: Record<BaseUom, string> = { mg: "khối lượng", ul: "thể tích", pcs: "số đếm" };

export function checkUom(baseUom: BaseUom, uom: string): string | null {
  const def = DISPLAY_UOM[uom as DisplayUom];
  if (!def) return `Đơn vị ${uom} không hợp lệ`;
  if (def.base !== baseUom) return `Đơn vị ${uom} không hợp với hàng đo theo ${BASE_LABEL[baseUom]}`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Ngày (R-KHO-12, R-KHO-21, R-KHO-22)

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Ngày trên dòng nhập (R-KHO-12). newLot = tạo lô mới (khách trả vào lô có sẵn thì không chặn hết hạn).
export function resolveLineDates(
  line: { manufacturedOn: string | null; expiresOn: string | null },
  receivedOn: string,
  shelfLifeDays: number | null,
  opts: { newLot: boolean },
): { ok: true; manufacturedOn: string | null; expiresOn: string | null } | { ok: false; message: string } {
  const mfg = line.manufacturedOn;
  let exp = line.expiresOn;
  if (mfg && mfg > receivedOn) return { ok: false, message: "Ngày sản xuất không được sau ngày nhập" };
  if (!exp && shelfLifeDays) exp = addDays(mfg ?? receivedOn, shelfLifeDays);
  if (exp && mfg && exp <= mfg) return { ok: false, message: "Hạn dùng phải sau ngày sản xuất" };
  if (opts.newLot && exp && exp <= receivedOn) return { ok: false, message: "Hàng đã hết hạn khi nhập, không nhập vào kho" };
  return { ok: true, manufacturedOn: mfg, expiresOn: exp };
}

export type ExpiryFlag = { kind: "expiring"; days: number } | { kind: "expired"; days: number } | null;

// R-KHO-21: 0 < còn ≤ warnDays → sắp hết hạn; còn ≤ 0 → đã hết hạn
export function expiryFlag(expiresOn: string | null, today: string, warnDays: number): ExpiryFlag {
  if (!expiresOn) return null;
  const days = daysBetween(today, expiresOn);
  if (days <= 0) return { kind: "expired", days };
  if (days <= warnDays) return { kind: "expiring", days };
  return null;
}

// R-KHO-22: số ngày từ lần xuất gần nhất (hoặc ngày nhập). null nếu chưa tới ngưỡng.
export function slowMovingDays(receivedOn: string, lastIssueOn: string | null, today: string, threshold: number): number | null {
  const days = daysBetween(lastIssueOn ?? receivedOn, today);
  return days >= threshold ? days : null;
}

// ---------------------------------------------------------------------------------------------
// Giá nhập (R-KHO-14). purchaseFactor = hệ số của purchase_uom (l → 1.000.000).

export function unitPriceOf(lineCost: number, qty: number, purchaseFactor: number): number {
  if (qty <= 0) return 0;
  return Number(divRound(BigInt(lineCost) * BigInt(purchaseFactor), BigInt(qty)));
}

export function lineCostOf(unitPrice: number, qty: number, purchaseFactor: number): number {
  return Number(divRound(BigInt(unitPrice) * BigInt(qty), BigInt(purchaseFactor)));
}

// Khác giá tham chiếu quá 20% → cảnh báo (không chặn)
export function priceDeviates(unitPrice: number, refUnitPrice: number | null): boolean {
  if (!refUnitPrice) return false;
  return Math.abs(unitPrice - refUnitPrice) * 5 > refUnitPrice;
}

// ---------------------------------------------------------------------------------------------
// Phân loại tồn (R-KHO-9)

export type StockBucket = "available" | "quarantine" | "rejected" | "expired";

export function classifyBalance(
  b: { warehouseKind: WarehouseKind; qcStatus: StockLotQcStatus | null; productLotStatus: ProductLotStatus | null; expiresOn: string | null },
  today: string,
): StockBucket {
  if (b.warehouseKind === "rejected") return "rejected";
  const st = b.qcStatus ?? b.productLotStatus;
  if (st === "rejected" || st === "recalled") return "rejected";
  if (st !== "released") return "quarantine";
  if (isExpired(b.expiresOn, today)) return "expired";
  return "available";
}

// ---------------------------------------------------------------------------------------------
// Trạng thái lô vật tư (R-KHO-36)

const QC_TRANSITIONS: Record<StockLotQcStatus, StockLotQcStatus[]> = {
  pending: ["released", "rejected", "on_hold"],
  released: ["on_hold", "rejected"],
  on_hold: ["released", "rejected"],
  rejected: [],
};

export function canChangeQcStatus(from: StockLotQcStatus, to: StockLotQcStatus): boolean {
  return QC_TRANSITIONS[from].includes(to);
}

// Câu lỗi khi lô không khả dụng (R-KHO-11)
export function unusableLotMessage(
  code: string,
  lot: { qcStatus: StockLotQcStatus | null; productLotStatus: ProductLotStatus | null; expiresOn: string | null },
  today: string,
): string {
  if (isExpired(lot.expiresOn, today)) return `Lô ${code} đã hết hạn`;
  const st = lot.qcStatus ?? lot.productLotStatus;
  if (st === "on_hold") return `Lô ${code} đang bị giữ, không xuất được`;
  if (st === "rejected" || st === "recalled") return `Lô ${code} không đạt hoặc đang thu hồi, không xuất được`;
  return `Lô ${code} đang chờ kiểm, chưa xuất được`;
}

// ---------------------------------------------------------------------------------------------
// Màn hình Kho (T-14c): gợi ý mã, mã kho/vị trí, cảnh báo FEFO, CSV

export type ItemKind = "raw_material" | "extract" | "packaging" | "wip" | "finished" | "other";

const ITEM_CODE_PREFIX: Partial<Record<ItemKind, string>> = { raw_material: "NL", extract: "TD", packaging: "BB", wip: "BTP" };

// R-KHO-1: gợi ý mã kế tiếp theo nhóm (NL-NNN, TD-NNN, BB-NNN, BTP-NNN) từ các mã đang có.
// Chỉ gợi ý, không giữ số: người dùng sửa được, lúc lưu vẫn kiểm trùng.
export function suggestItemCode(kind: ItemKind, existingCodes: string[]): string | null {
  const prefix = ITEM_CODE_PREFIX[kind];
  if (!prefix) return null;
  const re = new RegExp(`^${prefix}-([0-9]+)$`);
  let max = 0;
  for (const c of existingCodes) {
    const m = re.exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

// R-KHO-4: kho tự tạo 2–10 ký tự hoa/số
export function normalizeWarehouseCode(raw: string): { ok: true; code: string } | { ok: false; message: string } {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(code)) return { ok: false, message: "Mã kho gồm 2–10 chữ hoa hoặc số, không dấu" };
  return { ok: true, code };
}

// Vị trí kệ/ngăn: "K1-N2"
export function normalizeLocationCode(raw: string): { ok: true; code: string } | { ok: false; message: string } {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,20}$/.test(code)) return { ok: false, message: "Mã vị trí gồm chữ, số, gạch ngang, tối đa 20 ký tự" };
  return { ok: true, code };
}

function viDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

// R-KHO-11: chọn tay một lô khác FEFO → "Không theo FEFO: lô A hết hạn sớm hơn (01/03/2028)". null khi đúng FEFO.
export function fefoWarning(chosenLotId: string, candidates: FefoCandidate[], today: string): string | null {
  const usable = candidates.filter((c) => c.usable && c.qty > 0 && !isExpired(c.expiresOn, today));
  const mine = usable.find((c) => c.stockLotId === chosenLotId);
  if (!mine) return null;
  const earlier = usable.filter((c) => c.stockLotId !== chosenLotId && compareFefo(c, mine) < 0).sort(compareFefo)[0];
  if (!earlier) return null;
  return earlier.expiresOn
    ? `Không theo FEFO: lô ${earlier.code} hết hạn sớm hơn (${viDate(earlier.expiresOn)})`
    : `Không theo FEFO: lô ${earlier.code} nhập trước`;
}

// R-KHO-37: giá mới của lô khi sửa thành tiền một dòng nhập.
// Lô do chính dòng tạo: bằng giá mới. Nhập thêm vào lô có sẵn: cộng phần chênh.
export function lotCostAfterLineEdit(lotReceivedCost: number, oldLineCost: number, newLineCost: number, lotCreatedByLine: boolean): number {
  return lotCreatedByLine ? newLineCost : lotReceivedCost + (newLineCost - oldLineCost);
}

// CSV cho Excel tiếng Việt: có BOM, dấu phẩy, bọc ngoặc kép khi cần
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (typeof v === "number") return String(v);
    // Chữ bắt đầu bằng = + - @ bị Excel hiểu là công thức: thêm dấu nháy đơn
    const s = v === null || v === undefined ? "" : /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
