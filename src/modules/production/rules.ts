// Sản xuất: hàm thuần (02-san-xuat.md R-SX-4…R-SX-30). Service gọi lại các hàm này, không lặp logic.
import { formatLotNo, parseLotNo } from "@/lib/lot-no";
import { addDays, convertQty, DISPLAY_UOM, lineCostOf, parseVnNumber, type BaseUom, type DisplayUom } from "@/modules/inventory/rules";

export const PPM_FULL = 1_000_000;
const BP_FULL = 10_000;

export type ProductionKind = "in_house" | "outsourced";
export type ProductionStatus = "draft" | "planned" | "approved" | "in_progress" | "qc" | "completed" | "cancelled";
export type FormulaVersionStatus = "draft" | "trial" | "approved" | "archived";
export type PlanStatus = "draft" | "confirmed" | "closed" | "cancelled";
export type StepStatus = "pending" | "in_progress" | "done" | "skipped";
export type ExtractionStatus = "draft" | "in_progress" | "completed" | "cancelled";
export type MaterialSource = "pomil" | "factory";

// ---------------------------------------------------------------------------------------------
// Số học BigInt

function big(n: number): bigint {
  return BigInt(Math.trunc(n));
}

// Chia làm tròn nửa lên (số không âm)
function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den === BigInt(0)) return BigInt(0);
  return (num * BigInt(2) + den) / (BigInt(2) * den);
}

function divCeil(num: bigint, den: bigint): bigint {
  if (den === BigInt(0)) return BigInt(0);
  return (num + den - BigInt(1)) / den;
}

// ---------------------------------------------------------------------------------------------
// Tỷ lệ phần triệu (R-CHUNG-3)

// "15" hoặc "15%" → 150.000; "0,5" → 5.000; "0,0001" → 1; "0,00005" → lỗi
export function parsePercent(raw: string): { ok: true; ppm: number } | { ok: false; message: string } {
  const s = raw.trim().replace(/%$/, "").trim();
  const n = parseVnNumber(s);
  if (!n) return { ok: false, message: "Tỷ lệ không hợp lệ" };
  if (n.frac.length > 4) return { ok: false, message: "Tỷ lệ nhỏ nhất 0,0001%" };
  const ppm = BigInt(n.int) * BigInt(10_000) + BigInt(n.frac.padEnd(4, "0") || "0");
  if (ppm > BigInt(PPM_FULL)) return { ok: false, message: "Tỷ lệ tối đa 100%" };
  return { ok: true, ppm: Number(ppm) };
}

// 150.000 → "15%"; 5.000 → "0,5%"; 1 → "0,0001%"
export function formatPercent(ppm: number): string {
  const neg = ppm < 0;
  const abs = Math.abs(Math.trunc(ppm));
  const int = Math.floor(abs / 10_000);
  const frac = String(abs % 10_000)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return `${neg ? "-" : ""}${int.toLocaleString("vi-VN")}${frac ? "," + frac : ""}%`;
}

// Điểm cơ bản → "0,68%"; 9.800 → "98%"
export function formatBp(bp: number): string {
  return formatPercent(bp * 100);
}

// ---------------------------------------------------------------------------------------------
// R-SX-4 · Nhãn phiên bản công thức

export function formulaVersionLabel(productCode: string | null, formulaCode: string, version: number): string {
  return `${productCode ? productCode.toUpperCase() : formulaCode}-v${version}`;
}

// ---------------------------------------------------------------------------------------------
// R-SX-5 · Tổng tỷ lệ

export type FormulaLineLite = { itemId: string; itemCode?: string; ppm: number; isBalance: boolean; sort?: number };

export function checkFormulaTotals(lines: FormulaLineLite[]): { ok: true; balancePpm: number | null } | { ok: false; message: string } {
  if (lines.length === 0) return { ok: false, message: "Công thức chưa có dòng nào" };
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.itemId)) return { ok: false, message: `Hàng ${l.itemCode ?? ""} có hai dòng, mỗi hàng chỉ một dòng`.replace("  ", " ") };
    seen.add(l.itemId);
    if (!Number.isInteger(l.ppm) || l.ppm < 0 || l.ppm > PPM_FULL) return { ok: false, message: "Tỷ lệ mỗi dòng từ 0 đến 100%" };
  }
  const balances = lines.filter((l) => l.isBalance);
  if (balances.length > 1) return { ok: false, message: "Chỉ một dòng cân bằng (vừa đủ)" };
  const others = lines.filter((l) => !l.isBalance).reduce((s, l) => s + l.ppm, 0);
  if (balances.length === 0) {
    if (others !== PPM_FULL) return { ok: false, message: `Tổng tỷ lệ ${formatPercent(others)}, cần đúng 100%` };
    return { ok: true, balancePpm: null };
  }
  if (others > PPM_FULL) return { ok: false, message: `Các dòng khác đã ${formatPercent(others)}, vượt 100%` };
  return { ok: true, balancePpm: PPM_FULL - others };
}

// Tỷ lệ hiệu lực của từng dòng (dòng cân bằng = phần còn lại) để hiển thị và so sánh
export function effectivePpm(lines: FormulaLineLite[]): number[] {
  const others = lines.filter((l) => !l.isBalance).reduce((s, l) => s + l.ppm, 0);
  return lines.map((l) => (l.isBalance ? Math.max(0, PPM_FULL - others) : l.ppm));
}

// ---------------------------------------------------------------------------------------------
// R-SX-6 · Hàng trong công thức

export type ItemLite = { id: string; code: string; kind: string; baseUom: BaseUom; densityMgPerMl: number | null };

export function checkFormulaItem(item: { code: string; kind: string; baseUom: BaseUom }): string | null {
  if (item.kind === "packaging") return "Bao bì khai ở định mức bao bì";
  if (item.kind !== "raw_material" && item.kind !== "extract" && item.kind !== "wip") return "Dòng công thức chỉ dùng nguyên liệu, tinh dầu, dịch chiết hoặc bán thành phẩm";
  if (item.baseUom === "pcs") return `Hàng ${item.code} đo theo cái, không dùng trong tỷ lệ công thức`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// R-SX-7 · Tính lượng theo mẻ

export function scaleFormula(bulk: number, lines: { ppm: number; isBalance: boolean; sort?: number }[]): number[] {
  const b = big(bulk);
  const out = lines.map((l) => (l.isBalance ? BigInt(0) : divRoundHalfUp(b * big(l.ppm), BigInt(PPM_FULL))));
  const sumNormal = out.reduce((s, q) => s + q, BigInt(0));
  const balanceIdx = lines.findIndex((l) => l.isBalance);
  if (balanceIdx >= 0) {
    out[balanceIdx] = b - sumNormal;
  } else if (lines.length > 0) {
    // Phần chênh do làm tròn vào dòng có ppm lớn nhất; bằng nhau thì dòng sort nhỏ nhất
    let pick = 0;
    lines.forEach((l, i) => {
      const p = lines[pick]!;
      const sortI = l.sort ?? i;
      const sortP = p.sort ?? pick;
      if (l.ppm > p.ppm || (l.ppm === p.ppm && sortI < sortP)) pick = i;
    });
    out[pick] = out[pick]! + (b - sumNormal);
  }
  return out.map((q) => Number(q));
}

// ---------------------------------------------------------------------------------------------
// R-SX-8 · Đổi chiều đơn vị theo khối lượng riêng của chính hàng

export function convertForItem(
  q: number,
  batchUom: BaseUom,
  item: { code: string; baseUom: BaseUom; densityMgPerMl: number | null },
): { ok: true; qty: number } | { ok: false; message: string } {
  if (item.baseUom === batchUom) return { ok: true, qty: q };
  if (item.baseUom === "pcs") return { ok: false, message: `Hàng ${item.code} đo theo cái, không dùng trong tỷ lệ công thức` };
  if (!item.densityMgPerMl) return { ok: false, message: `Thiếu khối lượng riêng của ${item.code} để đổi đơn vị` };
  const r = convertQty(q, batchUom, item.baseUom, item.densityMgPerMl);
  return r.ok ? { ok: true, qty: r.qty } : { ok: false, message: r.message };
}

export type FormulaLineWithItem = { ppm: number; isBalance: boolean; sort?: number; item: ItemLite };

// Lượng từng dòng (theo đơn vị cơ sở của hàng) cho một lượng mẻ
export function formulaRequirement(
  bulk: number,
  batchUom: BaseUom,
  lines: FormulaLineWithItem[],
): { ok: true; lines: { itemId: string; qtyBatchUom: number; qty: number }[] } | { ok: false; message: string } {
  const scaled = scaleFormula(bulk, lines);
  const out: { itemId: string; qtyBatchUom: number; qty: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const conv = convertForItem(scaled[i]!, batchUom, line.item);
    if (!conv.ok) return conv;
    out.push({ itemId: line.item.id, qtyBatchUom: scaled[i]!, qty: conv.qty });
  }
  return { ok: true, lines: out };
}

// ---------------------------------------------------------------------------------------------
// R-SX-9 · Lệnh dùng phiên bản nào

export function checkOrderVersion(kind: ProductionKind, versionStatus: FormulaVersionStatus | null, formulaLabel: string | null): string | null {
  if (versionStatus === null) {
    if (kind === "in_house") return "Lệnh tự làm cần chọn phiên bản công thức";
    if (!formulaLabel?.trim()) return "Chọn phiên bản công thức hoặc ghi nhãn công thức của nhà máy";
    return null;
  }
  if (versionStatus === "draft") return "Phiên bản công thức còn nháp, chuyển thử nghiệm hoặc duyệt trước";
  if (versionStatus === "archived") return "Phiên bản công thức đã lưu trữ, chọn bản đang dùng";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Vòng đời phiên bản công thức

const VERSION_TRANSITIONS: Record<FormulaVersionStatus, FormulaVersionStatus[]> = {
  draft: ["trial", "approved"],
  trial: ["approved", "archived"],
  approved: ["archived"],
  archived: [],
};

export function canChangeVersionStatus(from: FormulaVersionStatus, to: FormulaVersionStatus): boolean {
  return VERSION_TRANSITIONS[from].includes(to);
}

export const VERSION_STATUS_LABEL: Record<FormulaVersionStatus, string> = {
  draft: "Nháp",
  trial: "Thử nghiệm",
  approved: "Thương mại",
  archived: "Lưu trữ",
};

// ---------------------------------------------------------------------------------------------
// R-SX-11 · So sánh phiên bản

export type VersionSnapshot = {
  batchSize: number;
  batchUom: BaseUom;
  lines: { itemId: string; itemCode: string; ppm: number; isBalance: boolean }[];
  packaging: { itemId: string; itemCode: string; qtyPerUnit: number }[];
};

export function diffVersions(a: VersionSnapshot, b: VersionSnapshot, fmtBatch?: (qty: number, uom: BaseUom) => string): string[] {
  const out: string[] = [];
  const fb = fmtBatch ?? ((q: number, u: BaseUom) => `${q.toLocaleString("vi-VN")} ${u}`);
  if (a.batchSize !== b.batchSize || a.batchUom !== b.batchUom) out.push(`Cỡ mẻ: ${fb(a.batchSize, a.batchUom)} → ${fb(b.batchSize, b.batchUom)}`);
  const ea = effectivePpm(a.lines);
  const eb = effectivePpm(b.lines);
  const mapA = new Map(a.lines.map((l, i) => [l.itemId, { ...l, eff: ea[i]! }]));
  const mapB = new Map(b.lines.map((l, i) => [l.itemId, { ...l, eff: eb[i]! }]));
  for (const l of a.lines) {
    const nb = mapB.get(l.itemId);
    const la = mapA.get(l.itemId)!;
    if (!nb) out.push(`Bỏ ${l.itemCode}: ${formatPercent(la.eff)}`);
    else if (nb.eff !== la.eff) out.push(`${l.itemCode}: ${formatPercent(la.eff)} → ${formatPercent(nb.eff)}`);
  }
  for (const l of b.lines) if (!mapA.has(l.itemId)) out.push(`Thêm ${l.itemCode}: ${formatPercent(mapB.get(l.itemId)!.eff)}`);
  const pa = new Map(a.packaging.map((p) => [p.itemId, p]));
  const pb = new Map(b.packaging.map((p) => [p.itemId, p]));
  for (const p of a.packaging) {
    const q = pb.get(p.itemId);
    if (!q) out.push(`Bỏ bao bì ${p.itemCode}`);
    else if (q.qtyPerUnit !== p.qtyPerUnit) out.push(`Bao bì ${p.itemCode}: ${p.qtyPerUnit.toLocaleString("vi-VN")} → ${q.qtyPerUnit.toLocaleString("vi-VN")} mỗi chai`);
  }
  for (const p of b.packaging) if (!pa.has(p.itemId)) out.push(`Thêm bao bì ${p.itemCode}: ${p.qtyPerUnit.toLocaleString("vi-VN")} mỗi chai`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// R-SX-12 · Nhu cầu của dòng kế hoạch

export const NEED_NET_QTY = "Nhập dung tích sản phẩm trước khi lập kế hoạch";

export function bulkForUnits(input: {
  targetUnits: number;
  netQty: number | null;
  netUom: BaseUom | null;
  batchUom: BaseUom;
  bulkDensityMgPerMl: number | null;
  expectedYieldBp: number;
}): { ok: true; bulk: number } | { ok: false; message: string } {
  if (!input.netQty || !input.netUom) return { ok: false, message: NEED_NET_QTY };
  if (!(input.targetUnits > 0)) return { ok: false, message: "Số chai phải lớn hơn 0" };
  const yieldBp = input.expectedYieldBp > 0 ? input.expectedYieldBp : BP_FULL;
  let num = big(input.targetUnits) * big(input.netQty) * BigInt(BP_FULL);
  let den = big(yieldBp);
  if (input.netUom !== input.batchUom) {
    if (!input.bulkDensityMgPerMl) return { ok: false, message: "Thiếu khối lượng riêng của bán thành phẩm để đổi dung tích sang cỡ mẻ" };
    // ul → mg: × d / 1000; mg → ul: × 1000 / d
    if (input.netUom === "ul") {
      num *= big(input.bulkDensityMgPerMl);
      den *= BigInt(1000);
    } else {
      num *= BigInt(1000);
      den *= big(input.bulkDensityMgPerMl);
    }
  }
  return { ok: true, bulk: Number(divCeil(num, den)) };
}

export function batchesFor(bulk: number, batchSize: number): number {
  if (!(batchSize > 0)) return 1;
  return Math.max(1, Number(divCeil(big(bulk), big(batchSize))));
}

// Gộp nhu cầu theo hàng trên cả kế hoạch
export function sumByItem(rows: { itemId: string; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.itemId, (m.get(r.itemId) ?? 0) + r.qty);
  return m;
}

// ---------------------------------------------------------------------------------------------
// R-SX-13 · Thiếu

export function shortageOf(need: number, available: number, committedOthers: number): number {
  return Math.max(0, need - (available - committedOthers));
}

// ---------------------------------------------------------------------------------------------
// R-SX-14 · Ước tính thời gian

export function hoursPerBatch(history: { startedAt: Date; finishedAt: Date; batchCount: number | null }[]): number | null {
  let ms = 0;
  let batches = 0;
  for (const h of history) {
    const n = h.batchCount && h.batchCount > 0 ? h.batchCount : 1;
    ms += h.finishedAt.getTime() - h.startedAt.getTime();
    batches += n;
  }
  if (batches === 0) return null;
  return ms / 3_600_000 / batches;
}

export function avgDays(history: { from: Date; to: Date }[]): number | null {
  if (history.length === 0) return null;
  const ms = history.reduce((s, h) => s + (h.to.getTime() - h.from.getTime()), 0);
  return ms / 86_400_000 / history.length;
}

export const NO_HISTORY = "Chưa có dữ liệu";

// "khoảng 10,7 giờ"
export function formatHours(h: number): string {
  return `khoảng ${(Math.round(h * 10) / 10).toLocaleString("vi-VN")} giờ`;
}

export function formatDays(d: number): string {
  return `khoảng ${(Math.round(d * 10) / 10).toLocaleString("vi-VN")} ngày`;
}

// ---------------------------------------------------------------------------------------------
// R-SX-15 · Đủ trường để lên kế hoạch lệnh

export function checkOrderReady(o: {
  kind: ProductionKind;
  productId: string | null;
  plannedUnits: number;
  versionStatus: FormulaVersionStatus | null;
  formulaLabel: string | null;
  supplierId: string | null;
  supplierKind: string | null;
}): string | null {
  if (!o.productId) return "Chọn sản phẩm";
  if (!(o.plannedUnits > 0)) return "Số chai kế hoạch phải lớn hơn 0";
  if (o.kind === "outsourced" && (!o.supplierId || o.supplierKind !== "factory")) return "Lệnh gia công cần chọn nhà máy";
  return checkOrderVersion(o.kind, o.versionStatus, o.formulaLabel);
}

// ---------------------------------------------------------------------------------------------
// Chuyển trạng thái lệnh

export type OrderPermission = "production.write" | "production.approve";

const ORDER_MOVES: Record<string, OrderPermission> = {
  "draft>planned": "production.write",
  "planned>draft": "production.write",
  "planned>approved": "production.approve",
  "approved>in_progress": "production.write",
  "in_progress>qc": "production.write",
  "qc>completed": "production.write",
  "draft>cancelled": "production.write",
  "planned>cancelled": "production.write",
  "approved>cancelled": "production.approve",
  "in_progress>cancelled": "production.approve",
};

// Quyền cần cho một bước chuyển, hoặc null nếu bước không hợp lệ
export function orderMovePermission(from: ProductionStatus, to: ProductionStatus): OrderPermission | null {
  return ORDER_MOVES[`${from}>${to}`] ?? null;
}

export const ORDER_STATUS_LABEL: Record<ProductionStatus, string> = {
  draft: "Nháp",
  planned: "Đã lên kế hoạch",
  approved: "Đã duyệt",
  in_progress: "Đang sản xuất",
  qc: "Chờ FQC",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

export const KIND_LABEL: Record<ProductionKind, string> = { in_house: "Tự làm", outsourced: "Gia công" };

// ---------------------------------------------------------------------------------------------
// R-SX-16 · Tiến độ kế hoạch

export function planLineProgress(targetUnits: number, orders: { status: ProductionStatus; plannedUnits: number; goodUnits: number | null }[]) {
  const live = orders.filter((o) => o.status !== "cancelled");
  const ordered = live.reduce((s, o) => s + o.plannedUnits, 0);
  const good = live.reduce((s, o) => s + (o.goodUnits ?? 0), 0);
  const pctBp = targetUnits > 0 ? Math.round((good * BP_FULL) / targetUnits) : 0;
  return { ordered, good, pctBp };
}

const PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
};

export function canChangePlanStatus(from: PlanStatus, to: PlanStatus): boolean {
  return PLAN_TRANSITIONS[from].includes(to);
}

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = { draft: "Nháp", confirmed: "Đã xác nhận", closed: "Đã đóng", cancelled: "Đã hủy" };

// ---------------------------------------------------------------------------------------------
// R-SX-17 · Định mức vật tư của lệnh

export type OrderMaterialDraft = { itemId: string; role: "formula" | "packaging" | "extra"; plannedQty: number; suppliedBy: MaterialSource; sort: number };

export function buildOrderMaterials(input: {
  kind: ProductionKind;
  plannedUnits: number;
  plannedBulk: number | null;
  batchUom: BaseUom | null;
  lines: FormulaLineWithItem[];
  packaging: { itemId: string; qtyPerUnit: number }[];
}): { ok: true; materials: OrderMaterialDraft[] } | { ok: false; message: string } {
  const supplied: MaterialSource = input.kind === "in_house" ? "pomil" : "factory";
  const out: OrderMaterialDraft[] = [];
  const byItem = new Map<string, OrderMaterialDraft>();
  const push = (m: OrderMaterialDraft) => {
    const had = byItem.get(m.itemId);
    if (had) had.plannedQty += m.plannedQty;
    else {
      byItem.set(m.itemId, m);
      out.push(m);
    }
  };
  if (input.lines.length > 0) {
    if (!input.plannedBulk || !input.batchUom) return { ok: false, message: "Nhập lượng mẻ kế hoạch (hoặc dung tích sản phẩm) để tính định mức" };
    const req = formulaRequirement(input.plannedBulk, input.batchUom, input.lines);
    if (!req.ok) return req;
    req.lines.forEach((l, i) => push({ itemId: l.itemId, role: "formula", plannedQty: l.qty, suppliedBy: supplied, sort: i }));
  }
  input.packaging.forEach((p, i) =>
    push({ itemId: p.itemId, role: "packaging", plannedQty: Number(big(input.plannedUnits) * big(p.qtyPerUnit)), suppliedBy: supplied, sort: 1000 + i }),
  );
  return { ok: true, materials: out };
}

// ---------------------------------------------------------------------------------------------
// R-SX-18 · Xuất, trả NVL cho lệnh

export const FACTORY_SUPPLIES = "Nhà máy tự cấp hàng này";

export function checkIssue(input: {
  orderStatus: ProductionStatus;
  material: { role: string; plannedQty: number; suppliedBy: MaterialSource } | null;
  netIssued: number;
  qty: number;
  overIssueWarnBp: number;
  reason: string | null;
}): string | null {
  if (input.orderStatus !== "approved" && input.orderStatus !== "in_progress") return "Chỉ xuất NVL cho lệnh đã duyệt hoặc đang sản xuất";
  if (!input.material) return "Hàng này chưa có trong định mức, thêm dòng phát sinh trước";
  if (input.material.suppliedBy === "factory") return FACTORY_SUPPLIES;
  if (!(input.qty > 0)) return "Số lượng xuất phải lớn hơn 0";
  if (input.material.role === "extra") return null;
  const after = big(input.netIssued + input.qty);
  const limit = big(input.material.plannedQty) * big(BP_FULL + input.overIssueWarnBp);
  if (after * BigInt(BP_FULL) > limit && !input.reason?.trim()) {
    const overBp = input.material.plannedQty > 0 ? Number(divRoundHalfUp((after - big(input.material.plannedQty)) * BigInt(BP_FULL), big(input.material.plannedQty))) : 0;
    return `Xuất vượt kế hoạch ${overBp > 0 ? formatBp(overBp) : ""}, ghi lý do`.replace("  ", " ");
  }
  return null;
}

export function checkReturn(qty: number, netIssuedFromLot: number, lotCode: string): string | null {
  if (!(qty > 0)) return "Số lượng trả phải lớn hơn 0";
  if (qty > netIssuedFromLot) return `Trả vượt số đã xuất từ lô ${lotCode}`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// R-SX-19, R-SX-30 · Ghi sản lượng

export type OutputInput = {
  kind: ProductionKind;
  goodUnits: number;
  rejectedUnits: number;
  manufacturedOn: string | null;
  expiresOn: string | null;
  actualBulk: number | null;
  outsourcingUnitPrice: number | null;
  outsourcingCost: number | null;
};

export function resolveOutput(
  input: OutputInput,
  today: string,
  shelfLifeDays: number | null,
): { ok: true; manufacturedOn: string; expiresOn: string; outsourcingCost: number; actualBulk: number | null } | { ok: false; message: string } {
  if (!Number.isInteger(input.goodUnits) || input.goodUnits < 1) return { ok: false, message: "Số chai đạt phải từ 1" };
  if (!Number.isInteger(input.rejectedUnits) || input.rejectedUnits < 0) return { ok: false, message: "Số chai lỗi không âm" };
  const mfg = input.manufacturedOn || today;
  if (mfg > today) return { ok: false, message: "Ngày sản xuất không được sau hôm nay" };
  const exp = input.expiresOn || (shelfLifeDays ? addDays(mfg, shelfLifeDays) : null);
  if (!exp) return { ok: false, message: "Nhập hạn dùng (hàng thành phẩm chưa có hạn dùng mặc định)" };
  if (exp <= mfg) return { ok: false, message: "Hạn dùng phải sau ngày sản xuất" };
  let cost = 0;
  if (input.kind === "outsourced") {
    if (input.outsourcingUnitPrice === null || input.outsourcingUnitPrice === undefined) return { ok: false, message: "Nhập đơn giá gia công trước" };
    cost = input.outsourcingCost ?? input.outsourcingUnitPrice * (input.goodUnits + input.rejectedUnits);
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > 2_147_483_647) return { ok: false, message: "Chi phí gia công không hợp lệ" };
  } else if (!input.actualBulk || input.actualBulk <= 0) {
    return { ok: false, message: "Nhập lượng bán thành phẩm thực tế" };
  }
  return { ok: true, manufacturedOn: mfg, expiresOn: exp, outsourcingCost: cost, actualBulk: input.kind === "in_house" ? input.actualBulk : (input.actualBulk ?? null) };
}

// Số lô MÃSP-YYMMDD-NN: n = số lô đã có cùng sản phẩm cùng ngày + 1, bỏ qua số đã dùng
export function nextLotNo(productCode: string, manufacturedOn: string, existing: string[]): string {
  const used = new Set(existing.map((x) => x.toUpperCase()));
  const date = new Date(`${manufacturedOn}T00:00:00Z`);
  let n = existing.length + 1;
  let lotNo = formatLotNo(productCode, date, n);
  while (used.has(lotNo) && n < 99) lotNo = formatLotNo(productCode, date, ++n);
  return lotNo;
}

// Số lô nhập tay (nhà máy đã in số khác): đúng dạng, đúng mã sản phẩm
export function checkCustomLotNo(lotNo: string, productCode: string): string | null {
  const p = parseLotNo(lotNo);
  if (!p) return "Số lô phải có dạng MÃ-YYMMDD-NN, ví dụ PST-271120-01";
  if (p.productCode !== productCode.toUpperCase()) return `Số lô phải bắt đầu bằng mã sản phẩm ${productCode}`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// R-SX-20 · Kết quả QC khi hoàn thành

export function qcResultFromLot(
  releaseStatus: "quarantine" | "released" | "on_hold" | "recalled" | "rejected",
  releasedAt: Date | null,
): { ok: true; result: "pass" | "fail" } | { ok: false; message: string } {
  if (releaseStatus === "released") return { ok: true, result: "pass" };
  if (releaseStatus === "rejected") return { ok: true, result: "fail" };
  // Lô đã từng released rồi bị giữ/thu hồi: vẫn tính đạt
  if ((releaseStatus === "on_hold" || releaseStatus === "recalled") && releasedAt) return { ok: true, result: "pass" };
  return { ok: false, message: "Lô chưa có kết luận FQC" };
}

// ---------------------------------------------------------------------------------------------
// R-SX-21 · Hủy lệnh

export function cancelPermission(status: ProductionStatus): OrderPermission | { error: string } {
  if (status === "qc" || status === "completed") return { error: "Lệnh đã ghi sản lượng, không hủy được" };
  if (status === "cancelled") return { error: "Lệnh đã hủy" };
  return orderMovePermission(status, "cancelled")!;
}

// ---------------------------------------------------------------------------------------------
// R-SX-22 · Công đoạn

export const DEFAULT_STEPS: Record<ProductionKind, { name: string; needsQc: boolean }[]> = {
  in_house: [
    { name: "Cân nguyên liệu", needsQc: false },
    { name: "Phối trộn", needsQc: true },
    { name: "Chiết rót", needsQc: false },
    { name: "Dán nhãn, đóng hộp", needsQc: false },
  ],
  outsourced: [
    { name: "Giao vật tư cho nhà máy", needsQc: false },
    { name: "Nhà máy sản xuất", needsQc: false },
    { name: "Nhận hàng, kiểm ngoại quan", needsQc: true },
  ],
};

export const DEVIATION_BLOCK = "Tạm dừng do sai lệch IPQC";

export function checkStartStep(steps: { seq: number; status: StepStatus }[], seq: number, blocked: boolean): string | null {
  const step = steps.find((s) => s.seq === seq);
  if (!step) return "Không tìm thấy công đoạn";
  if (step.status !== "pending") return "Công đoạn đã bắt đầu";
  if (blocked) return DEVIATION_BLOCK;
  const prev = steps.filter((s) => s.seq < seq && s.status !== "done" && s.status !== "skipped");
  if (prev.length > 0) return `Làm xong công đoạn ${prev[0]!.seq} trước`;
  return null;
}

export function checkFinishStep(step: { status: StepStatus; needsQc: boolean }, latestIpqc: "pending" | "passed" | "failed" | "cancelled" | null): string | null {
  if (step.status !== "in_progress") return "Công đoạn chưa bắt đầu";
  if (step.needsQc && latestIpqc !== "passed") return "Công đoạn cần phiếu IPQC đạt trước khi xong";
  return null;
}

// ---------------------------------------------------------------------------------------------
// R-SX-24 · Tỷ lệ thu hồi

export type Recovery = { kind: "percent"; bp: number } | { kind: "ml_per_kg"; value: number };

export function recoveryOf(inputMg: number, outputQty: number, outputUom: BaseUom, densityMgPerMl: number | null): Recovery | null {
  if (!(inputMg > 0) || !(outputQty > 0)) return null;
  let outMg: number | null = null;
  if (outputUom === "mg") outMg = outputQty;
  else if (outputUom === "ul" && densityMgPerMl) outMg = Number(divRoundHalfUp(big(outputQty) * big(densityMgPerMl), BigInt(1000)));
  if (outMg !== null) return { kind: "percent", bp: Number(divRoundHalfUp(big(outMg) * BigInt(BP_FULL), big(inputMg))) };
  if (outputUom !== "ul") return null;
  return { kind: "ml_per_kg", value: outputQty / 1000 / (inputMg / 1_000_000) };
}

export function formatRecovery(r: Recovery | null): string {
  if (!r) return "—";
  if (r.kind === "percent") return formatBp(r.bp);
  return `${(Math.round(r.value * 100) / 100).toLocaleString("vi-VN")} ml/kg`;
}

// ---------------------------------------------------------------------------------------------
// R-SX-25 · Giá thành mẻ chiết

export function extractionTotalCost(peelCost: number, serviceFee: number, otherCost: number): number {
  return peelCost + serviceFee + otherCost;
}

const EXTRACTION_TRANSITIONS: Record<ExtractionStatus, ExtractionStatus[]> = {
  draft: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canChangeExtractionStatus(from: ExtractionStatus, to: ExtractionStatus): boolean {
  return EXTRACTION_TRANSITIONS[from].includes(to);
}

export const EXTRACTION_STATUS_LABEL: Record<ExtractionStatus, string> = { draft: "Nháp", in_progress: "Đang chạy", completed: "Hoàn thành", cancelled: "Đã hủy" };
export const EXTRACTION_METHOD_LABEL = { steam_distillation: "Chưng cất hơi nước", cold_press: "Ép lạnh", maceration: "Ngâm chiết", other: "Khác" } as const;

// Thông số: "Nhiệt độ | 100,5 | °C" → valueMilli 100.500
export function parseParams(text: string): { ok: true; params: { name: string; valueMilli: number; unit: string }[] } | { ok: false; message: string } {
  const params: { name: string; valueMilli: number; unit: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [name, value, unit] = line.split("|").map((s) => s.trim());
    if (!name || !value) return { ok: false, message: `Dòng thông số "${line}" cần dạng: tên | giá trị | đơn vị` };
    const neg = value.startsWith("-");
    const n = parseVnNumber(neg ? value.slice(1) : value);
    if (!n || n.frac.length > 3) return { ok: false, message: `Giá trị "${value}" không hợp lệ (tối đa 3 chữ số lẻ)` };
    const milli = Number(BigInt(n.int) * BigInt(1000) + BigInt(n.frac.padEnd(3, "0") || "0"));
    params.push({ name, valueMilli: neg ? -milli : milli, unit: unit ?? "" });
  }
  return { ok: true, params };
}

export function formatMilli(v: number): string {
  const neg = v < 0;
  const a = Math.abs(v);
  const frac = String(a % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${neg ? "-" : ""}${Math.floor(a / 1000).toLocaleString("vi-VN")}${frac ? "," + frac : ""}`;
}

// ---------------------------------------------------------------------------------------------
// R-SX-27 · Giá thành kế hoạch

export function plannedCostOf(input: {
  kind: ProductionKind;
  plannedUnits: number;
  outsourcingUnitPrice: number | null;
  labor: number;
  overhead: number;
  materials: { itemCode: string; plannedQty: number; suppliedBy: MaterialSource; refUnitPrice: number | null; purchaseUom: string }[];
}): { total: number; missing: string[] } {
  let total = 0;
  const missing: string[] = [];
  for (const m of input.materials) {
    if (m.suppliedBy !== "pomil" || m.plannedQty <= 0) continue;
    if (m.refUnitPrice === null || m.refUnitPrice === undefined) {
      missing.push(m.itemCode);
      continue;
    }
    const factor = DISPLAY_UOM[m.purchaseUom as DisplayUom]?.factor ?? 1;
    total += lineCostOf(m.refUnitPrice, m.plannedQty, factor);
  }
  total += (input.outsourcingUnitPrice ?? 0) * input.plannedUnits;
  if (input.kind === "in_house") total += input.labor + input.overhead;
  return { total, missing };
}

// Chênh lệch giá thành: tổng và theo chai (làm tròn đồng), bp so với kế hoạch/chai
export function costVariance(input: { totalCost: number; goodUnits: number; plannedCost: number; plannedUnits: number }) {
  const actualUnit = input.goodUnits > 0 ? Math.round(input.totalCost / input.goodUnits) : null;
  const plannedUnit = input.plannedUnits > 0 ? Math.round(input.plannedCost / input.plannedUnits) : null;
  const unitDiff = actualUnit !== null && plannedUnit !== null ? actualUnit - plannedUnit : null;
  const unitDiffBp = unitDiff !== null && plannedUnit ? Math.round((unitDiff * BP_FULL) / plannedUnit) : null;
  return { total: input.totalCost - input.plannedCost, actualUnit, plannedUnit, unitDiff, unitDiffBp };
}

// ---------------------------------------------------------------------------------------------
// R-SX-28 · Hiệu suất

export type PerfOrder = {
  kind: ProductionKind;
  plannedUnits: number;
  goodUnits: number;
  rejectedUnits: number;
  actualBulk: number | null;
  netQty: number | null;
  totalCost: number;
  batchCount: number | null;
  qcResult: "pending" | "pass" | "fail";
  startedAt: Date | null;
  approvedAt: Date | null;
  finishedAt: Date | null;
};

function ratioBp(num: number, den: number): number | null {
  if (!(den > 0)) return null;
  return Math.round((num * BP_FULL) / den);
}

export function orderMetrics(o: PerfOrder) {
  const units = o.goodUnits + o.rejectedUnits;
  const lossBp = o.kind === "in_house" && o.actualBulk && o.netQty ? ratioBp(o.actualBulk - units * o.netQty, o.actualBulk) : null;
  return {
    goodVsPlanBp: ratioBp(o.goodUnits, o.plannedUnits),
    rejectBp: ratioBp(o.rejectedUnits, units),
    bulkLossBp: lossBp,
    costPerBatch: Math.round(o.totalCost / Math.max(1, o.batchCount ?? 1)),
    unitCost: o.goodUnits > 0 ? Math.round(o.totalCost / o.goodUnits) : null,
  };
}

export function performanceSummary(orders: PerfOrder[]) {
  const sum = (f: (o: PerfOrder) => number) => orders.reduce((s, o) => s + f(o), 0);
  const inHouse = orders.filter((o) => o.kind === "in_house" && o.startedAt && o.finishedAt);
  const outsourced = orders.filter((o) => o.kind === "outsourced" && o.approvedAt && o.finishedAt);
  const totalBatches = sum((o) => Math.max(1, o.batchCount ?? 1));
  const bulkOrders = orders.filter((o) => o.kind === "in_house" && o.actualBulk && o.netQty);
  const bulkIn = bulkOrders.reduce((s, o) => s + (o.actualBulk ?? 0), 0);
  const bulkOut = bulkOrders.reduce((s, o) => s + (o.goodUnits + o.rejectedUnits) * (o.netQty ?? 0), 0);
  return {
    count: orders.length,
    goodVsPlanBp: ratioBp(sum((o) => o.goodUnits), sum((o) => o.plannedUnits)),
    rejectBp: ratioBp(sum((o) => o.rejectedUnits), sum((o) => o.goodUnits + o.rejectedUnits)),
    bulkLossBp: bulkIn > 0 ? ratioBp(bulkIn - bulkOut, bulkIn) : null,
    hoursPerBatch: hoursPerBatch(inHouse.map((o) => ({ startedAt: o.startedAt!, finishedAt: o.finishedAt!, batchCount: o.batchCount }))),
    daysPerOrder: avgDays(outsourced.map((o) => ({ from: o.approvedAt!, to: o.finishedAt! }))),
    costPerBatch: totalBatches > 0 && orders.length > 0 ? Math.round(sum((o) => o.totalCost) / totalBatches) : null,
    unitCost: sum((o) => o.goodUnits) > 0 ? Math.round(sum((o) => o.totalCost) / sum((o) => o.goodUnits)) : null,
    passRateBp: ratioBp(orders.filter((o) => o.qcResult === "pass").length, orders.length),
  };
}

// Chênh lệch NVL theo hàng: (xuất ròng − kế hoạch) / kế hoạch
export function materialVarianceBp(netIssued: number, planned: number): number | null {
  return ratioBp(netIssued - planned, planned);
}

export function equipmentSummary(runs: { equipment: string; startedAt: Date | null; endedAt: Date | null; recovery: Recovery | null }[]) {
  const groups = new Map<string, { equipment: string; runs: number; hours: number; recoveryBpSum: number; recoveryCount: number }>();
  for (const r of runs) {
    const key = r.equipment.trim() || "(chưa ghi thiết bị)";
    const g = groups.get(key) ?? { equipment: key, runs: 0, hours: 0, recoveryBpSum: 0, recoveryCount: 0 };
    g.runs += 1;
    if (r.startedAt && r.endedAt) g.hours += (r.endedAt.getTime() - r.startedAt.getTime()) / 3_600_000;
    if (r.recovery?.kind === "percent") {
      g.recoveryBpSum += r.recovery.bp;
      g.recoveryCount += 1;
    }
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ equipment: g.equipment, runs: g.runs, hours: g.hours, avgRecoveryBp: g.recoveryCount ? Math.round(g.recoveryBpSum / g.recoveryCount) : null }));
}
