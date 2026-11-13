// Chất lượng (QMS): quy tắc thuần (03-chat-luong.md R-CL-1…R-CL-27). Service trong qms/* gọi lại, không lặp logic.
import type { StaffRole } from "@/modules/auth/rules";
import { can, type Permission } from "@/modules/auth/rules";
import { parseVnNumber } from "@/modules/inventory/rules";

export const QMS_DISCLAIMER =
  "Phần mềm chỉ lưu trữ và kiểm soát hồ sơ. Chỉ tiêu và giới hạn do người có chuyên môn xác định. Phần mềm không tự xác nhận sản phẩm an toàn và không thay nghĩa vụ công bố, đánh giá an toàn, kiểm nghiệm, điều kiện sản xuất mỹ phẩm.";

export const PERMISSION_DENIED = "Tài khoản của bạn không có quyền làm việc này.";
export const INSPECTION_STALE = "Phiếu vừa được người khác cập nhật, tải lại trang.";
export const DOC_STALE = "Chứng từ vừa được người khác cập nhật, tải lại trang.";

export type Actor = { id: string; role: StaffRole };

export function actorCan(actor: Actor, permission: Permission): boolean {
  return can(actor.role, permission);
}

// ---------------------------------------------------------------------------------------------
// R-CL-3: giá trị đo × 1000, gõ kiểu Việt Nam ("5,5" → 5.500; "1.000" → 1.000.000)

export function parseMeasure(raw: string): { ok: true; milli: number } | { ok: false; message: string } {
  let s = raw.trim();
  let negative = false;
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = true;
    s = s.slice(1).trim();
  }
  const n = parseVnNumber(s);
  if (!n) return { ok: false, message: `"${raw.trim()}" không phải số. Gõ kiểu 5,5 hoặc 1.000` };
  // Làm tròn tới 3 chữ số sau dấu phẩy (nửa lên)
  const frac = (n.frac + "0000").slice(0, 4);
  let milli = BigInt(n.int) * 1000n + BigInt(frac.slice(0, 3));
  if (Number(frac[3]) >= 5) milli += 1n;
  if (milli > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, message: "Số quá lớn" };
  const v = Number(milli);
  return { ok: true, milli: negative ? -v : v };
}

export function formatMilli(milli: number | null | undefined): string {
  if (milli === null || milli === undefined) return "";
  return (milli / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}

export function formatLimits(minMilli: number | null, maxMilli: number | null, unit = ""): string {
  const u = unit ? ` ${unit}` : "";
  if (minMilli !== null && maxMilli !== null) return `${formatMilli(minMilli)}–${formatMilli(maxMilli)}${u}`;
  if (minMilli !== null) return `≥ ${formatMilli(minMilli)}${u}`;
  if (maxMilli !== null) return `≤ ${formatMilli(maxMilli)}${u}`;
  return "Không giới hạn";
}

// ---------------------------------------------------------------------------------------------
// R-CL-4: đánh giá từng chỉ tiêu

export type ParamKind = "range" | "pass_fail" | "text";
export type ParamGroupKey = "origin" | "sensory" | "physicochemical" | "composition" | "microbial" | "heavy_metal" | "stability" | "packaging" | "label" | "other";

export const PARAM_GROUP_LABEL: Record<ParamGroupKey, string> = {
  origin: "Nguồn gốc",
  sensory: "Cảm quan",
  physicochemical: "Lý hóa",
  composition: "Thành phần",
  microbial: "Vi sinh",
  heavy_metal: "Kim loại nặng",
  stability: "Độ ổn định",
  packaging: "Bao bì",
  label: "Nhãn",
  other: "Khác",
};

export const PARAM_KIND_LABEL: Record<ParamKind, string> = { range: "Khoảng giá trị", pass_fail: "Đạt / không đạt", text: "Ghi nhận" };
export type LotTestKind = "microbial" | "heavy_metals" | "stability" | "gc_ms" | "irritation" | "sensory";

export function rangeHasLimits(p: { minMilli: number | null; maxMilli: number | null }): boolean {
  return p.minMilli !== null || p.maxMilli !== null;
}

// range: đạt khi trong giới hạn; không giới hạn → null. pass_fail: theo người kiểm. text: null.
export function evaluateParam(p: { kind: ParamKind; minMilli: number | null; maxMilli: number | null; valueMilli: number | null; passFail?: boolean | null }): boolean | null {
  if (p.kind === "text") return null;
  if (p.kind === "pass_fail") return p.passFail ?? null;
  if (p.valueMilli === null || !rangeHasLimits(p)) return null;
  if (p.minMilli !== null && p.valueMilli < p.minMilli) return false;
  if (p.maxMilli !== null && p.valueMilli > p.maxMilli) return false;
  return true;
}

// Chỉ tiêu nối lot_tests (FQC): có phiếu fail → không đạt; có pass, không fail → đạt; còn lại → chưa có.
export function evaluateFromLotTests(type: LotTestKind, tests: { type: string; result: "pass" | "fail" | "pending" }[]): boolean | null {
  const same = tests.filter((t) => t.type === type);
  if (same.some((t) => t.result === "fail")) return false;
  if (same.some((t) => t.result === "pass")) return true;
  return null;
}

// ---------------------------------------------------------------------------------------------
// R-CL-5: kết luận gợi ý

export type Verdict = "pass" | "incomplete" | "review" | "fail";

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "Đạt",
  incomplete: "Chưa đủ kết quả",
  review: "Cần xem xét",
  fail: "Không đạt",
};

export type EvaluatedParam = { kind: ParamKind; minMilli: number | null; maxMilli: number | null; isCritical: boolean; passed: boolean | null; fromLotTest?: boolean };

export function suggestVerdict(params: EvaluatedParam[]): Verdict {
  if (params.some((p) => p.isCritical && p.passed === false)) return "fail";
  const needsResult = (p: EvaluatedParam) => p.fromLotTest || p.kind === "pass_fail" || (p.kind === "range" && rangeHasLimits(p));
  if (params.some((p) => needsResult(p) && p.passed === null)) return "incomplete";
  if (params.some((p) => p.passed === false)) return "review";
  return "pass";
}

// ---------------------------------------------------------------------------------------------
// R-CL-6: quyết định

export type InspectionStageKey = "iqc" | "ipqc" | "fqc" | "recheck";
export type Disposition = "accept" | "reject" | "use_as_is" | "return_to_supplier";

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  accept: "Đạt",
  use_as_is: "Chấp nhận có điều kiện",
  reject: "Không đạt",
  return_to_supplier: "Trả nhà cung cấp",
};

export function dispositionStatus(d: Disposition): "passed" | "failed" {
  return d === "accept" || d === "use_as_is" ? "passed" : "failed";
}

// Trả câu lỗi, hoặc null khi được phép
export function checkDisposition(input: { stage: InspectionStageKey; verdict: Verdict; disposition: Disposition; note: string | null | undefined; hasStockLot?: boolean }): string | null {
  const note = input.note?.trim() ?? "";
  switch (input.disposition) {
    case "accept":
      if (input.verdict !== "pass") return `Chỉ chọn Đạt khi kết luận gợi ý là Đạt (hiện: ${VERDICT_LABEL[input.verdict]})`;
      return null;
    case "use_as_is":
      if (input.stage !== "iqc" && input.stage !== "ipqc") return "Chấp nhận có điều kiện chỉ dùng cho IQC và IPQC";
      if (input.verdict === "fail") return "Có chỉ tiêu trọng yếu không đạt, không chấp nhận có điều kiện được";
      if (input.verdict === "incomplete") return "Còn chỉ tiêu chưa có kết quả";
      if (!note) return "Ghi lý do chấp nhận có điều kiện";
      return null;
    case "reject":
      if (!note) return "Ghi lý do không đạt";
      return null;
    case "return_to_supplier":
      if (input.stage !== "iqc") return "Trả nhà cung cấp chỉ dùng cho IQC";
      if (!note) return "Ghi lý do trả nhà cung cấp";
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// R-CL-8, R-CL-11, R-CL-13: NCR tự tạo khi không đạt

export type NcrCategory = "material" | "extract" | "process" | "product" | "packaging" | "supplier" | "customer_complaint" | "other";
export type NcrSeverity = "minor" | "major" | "critical";

export function ncrCategoryForItemKind(kind: string): NcrCategory {
  if (kind === "extract") return "extract";
  if (kind === "packaging") return "packaging";
  if (kind === "finished") return "product";
  return "material";
}

// R-CL-16: mức phản ánh → mức NCR
export function ncrSeverityFromComplaint(severity: "mild" | "moderate" | "severe"): NcrSeverity {
  return severity === "severe" ? "critical" : severity === "moderate" ? "major" : "minor";
}

// R-CL-12: câu hiện cho blocker của evaluateLotRelease
const TEST_NAME: Record<LotTestKind, string> = {
  microbial: "Vi sinh",
  heavy_metals: "Kim loại nặng",
  stability: "Độ ổn định",
  gc_ms: "Phân tích GC-MS",
  irritation: "Kích ứng da",
  sensory: "Cảm quan",
};

export type ReleaseBlockerLike =
  | { code: "missing_test"; test: LotTestKind }
  | { code: "failed_test"; test: LotTestKind }
  | { code: "pending_test"; test: LotTestKind }
  | { code: "no_notification" }
  | { code: "notification_expired" }
  | { code: "lot_expired" }
  | { code: "not_in_quarantine"; status: string };

export function releaseBlockerText(b: ReleaseBlockerLike): string {
  switch (b.code) {
    case "missing_test":
      return `Thiếu phiếu kiểm nghiệm ${TEST_NAME[b.test]}`;
    case "failed_test":
      return `Phiếu ${TEST_NAME[b.test]} không đạt`;
    case "pending_test":
      return `Phiếu ${TEST_NAME[b.test]} đang chờ kết quả`;
    case "no_notification":
      return "Chưa có phiếu công bố cho sản phẩm";
    case "notification_expired":
      return "Phiếu công bố đã hết hạn";
    case "lot_expired":
      return "Lô đã hết hạn";
    case "not_in_quarantine":
      return "Lô không ở trạng thái cách ly";
  }
}

// ---------------------------------------------------------------------------------------------
// Tiêu chuẩn (R-CL-1)

export type StandardStatus = "draft" | "active" | "archived";

export function canTransitionStandard(from: StandardStatus, to: StandardStatus): boolean {
  return (from === "draft" && to === "active") || (from === "active" && to === "archived") || (from === "draft" && to === "archived");
}

// ---------------------------------------------------------------------------------------------
// NCR (R-CL-15)

export type NcrStatus = "open" | "investigating" | "action" | "verifying" | "closed" | "cancelled";

export const NCR_STATUS_LABEL: Record<NcrStatus, string> = {
  open: "Mới",
  investigating: "Đang điều tra",
  action: "Đang khắc phục",
  verifying: "Đang xác nhận",
  closed: "Đã đóng",
  cancelled: "Đã hủy",
};

export const NCR_CATEGORY_LABEL: Record<NcrCategory, string> = {
  material: "Nguyên liệu",
  extract: "Tinh dầu, dịch chiết",
  process: "Quy trình",
  product: "Thành phẩm",
  packaging: "Bao bì",
  supplier: "Nhà cung cấp",
  customer_complaint: "Phản ánh của khách",
  other: "Khác",
};

export const SEVERITY_LABEL: Record<NcrSeverity, string> = { minor: "Nhẹ", major: "Nặng", critical: "Nghiêm trọng" };

const NCR_NEXT: Record<NcrStatus, NcrStatus[]> = {
  open: ["investigating", "cancelled"],
  investigating: ["action", "cancelled"],
  action: ["verifying"],
  verifying: ["closed", "action"],
  closed: [],
  cancelled: [],
};

export function canTransitionNcr(from: NcrStatus, to: NcrStatus): boolean {
  return NCR_NEXT[from].includes(to);
}

export function ncrNextStatuses(from: NcrStatus): NcrStatus[] {
  return NCR_NEXT[from];
}

// Đóng, hủy cần quality.approve; chuyển tới cần quality.write
export function ncrTransitionPermission(to: NcrStatus): Permission {
  return to === "closed" || to === "cancelled" ? "quality.approve" : "quality.write";
}

export function checkNcrClose(n: { severity: NcrSeverity; rootCause: string; correction: string; verificationNote: string; capaCount: number }): string | null {
  if (!n.rootCause.trim()) return "Ghi nguyên nhân trước khi đóng NCR";
  if (!n.correction.trim()) return "Ghi biện pháp khắc phục trước khi đóng NCR";
  if (!n.verificationNote.trim()) return "Ghi chú xác nhận trước khi đóng NCR";
  if (n.severity === "critical" && n.capaCount < 1) return "NCR nghiêm trọng cần CAPA trước khi đóng";
  return null;
}

// ---------------------------------------------------------------------------------------------
// CAPA (R-CL-17)

export type CapaStatus = "open" | "in_progress" | "verifying" | "closed" | "cancelled";

export const CAPA_STATUS_LABEL: Record<CapaStatus, string> = {
  open: "Mới",
  in_progress: "Đang làm",
  verifying: "Đánh giá hiệu quả",
  closed: "Đã đóng",
  cancelled: "Đã hủy",
};

const CAPA_NEXT: Record<CapaStatus, CapaStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["verifying", "cancelled"],
  verifying: ["in_progress", "closed"],
  closed: [],
  cancelled: [],
};

export function canTransitionCapa(from: CapaStatus, to: CapaStatus): boolean {
  return CAPA_NEXT[from].includes(to);
}

export function capaNextStatuses(from: CapaStatus): CapaStatus[] {
  return CAPA_NEXT[from];
}

export function checkCapaVerifying(actions: { doneAt: Date | null }[]): string | null {
  if (actions.length === 0) return "CAPA chưa có bước hành động";
  const left = actions.filter((a) => !a.doneAt).length;
  if (left > 0) return `Còn ${left} bước chưa xong`;
  return null;
}

export function checkCapaClose(c: { effectivenessResult: string; effective: boolean | null }): string | null {
  if (!c.effectivenessResult.trim()) return "Ghi kết quả đánh giá hiệu quả trước khi đóng";
  if (c.effective !== true) return "CAPA chưa hiệu quả, không đóng được. Thêm bước và làm lại.";
  return null;
}

// Gợi ý 7 bước khi tạo CAPA từ phản ánh (yêu cầu gốc)
export const CAPA_SUGGESTED_STEPS: readonly string[] = [
  "Xác định lô liên quan",
  "Kiểm mẫu lưu của lô (tạo phiếu kiểm lại)",
  "Phân tích nguyên nhân",
  "Biện pháp khắc phục",
  "Điều chỉnh quy trình",
  "Theo dõi các lô tiếp theo",
  "Đánh giá hiệu quả phòng ngừa",
];

// ---------------------------------------------------------------------------------------------
// R-CL-18: quá hạn

export function isOverdue(dueOn: string | null, today: string, done: boolean): boolean {
  return !done && dueOn !== null && dueOn < today;
}

// ---------------------------------------------------------------------------------------------
// R-CL-21: cân đối lô thành phẩm

export type LotMove = { type: string; qty: number; originalType?: string | null; warehouseKind?: string | null };

export type LotBalance = {
  received: number;
  sold: number;
  samples: number;
  scrap: number;
  returned: number;
  other: number;
  onHand: number;
  onHandByWarehouse: Record<string, number>;
  balanced: boolean;
};

const RECEIPT_TYPES = new Set(["opening", "purchase_receipt", "production_receipt", "extraction_receipt", "other_receipt", "production_return"]);
const SAMPLE_TYPES = new Set(["sample_issue", "qc_sample_issue"]);

// Dòng đảo tính vào loại của dòng gốc. Điều chuyển không đổi tổng.
export function computeLotBalance(moves: LotMove[]): LotBalance {
  const b = { received: 0, sold: 0, samples: 0, scrap: 0, returned: 0, other: 0 };
  const byWh: Record<string, number> = {};
  let onHand = 0;
  for (const m of moves) {
    const t = m.type === "reversal" ? (m.originalType ?? "other") : m.type;
    onHand += m.qty;
    if (m.warehouseKind) byWh[m.warehouseKind] = (byWh[m.warehouseKind] ?? 0) + m.qty;
    if (t === "transfer_in" || t === "transfer_out") continue;
    if (RECEIPT_TYPES.has(t)) b.received += m.qty;
    else if (t === "sale_issue") b.sold -= m.qty;
    else if (SAMPLE_TYPES.has(t)) b.samples -= m.qty;
    else if (t === "scrap_issue") b.scrap -= m.qty;
    else if (t === "return_receipt") b.returned += m.qty;
    else b.other -= m.qty;
  }
  for (const k of Object.keys(byWh)) if (byWh[k] === 0) delete byWh[k];
  const balanced = b.received - b.sold - b.samples - b.scrap + b.returned - b.other === onHand;
  return { ...b, onHand, onHandByWarehouse: byWh, balanced };
}

// ---------------------------------------------------------------------------------------------
// Thu hồi (R-CL-23, R-CL-24)

export type RecallContactStatus = "pending" | "contacted" | "returned" | "unreachable" | "refused";

export const RECALL_CONTACT_LABEL: Record<RecallContactStatus, string> = {
  pending: "Chưa liên hệ",
  contacted: "Đã liên hệ",
  returned: "Đã gửi hàng về",
  unreachable: "Không liên lạc được",
  refused: "Khách từ chối",
};

export function checkRecallClose(contacts: { status: RecallContactStatus }[]): string | null {
  const pending = contacts.filter((c) => c.status === "pending").length;
  return pending > 0 ? `Còn ${pending} liên hệ chưa xử lý, chưa đóng được hồ sơ` : null;
}

// Tỷ lệ thu về (%), làm tròn 1 chữ số; chưa bán → null
export function recallReturnRate(sold: number, returned: number): number | null {
  if (sold <= 0) return null;
  return Math.round((returned / sold) * 1000) / 10;
}

export const RECALLABLE_LOT_STATUSES = ["released", "on_hold"] as const;

// Độ sâu tối đa khi truy xuất (R-CL-19)
export const TRACE_MAX_DEPTH = 5;

// CSV: bọc ô có dấu phẩy, nháy, xuống dòng
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    // Chặn công thức khi mở bằng bảng tính (ô chữ bắt đầu bằng = + @)
    if (typeof v === "string" && /^[=+@\t]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
