// Đánh số chứng từ (00-tong-quan.md mục 4, R-CHUNG-6, R-CHUNG-7). Hàm thuần để test được.
import { vnYearMonth } from "@/modules/orders/rules";

export type DocPrefix =
  | "PN" | "PX" | "DCK" | "KK" | "VT" | "EX"
  | "KH" | "LSX" | "CX" | "FORM"
  | "TC" | "IQC" | "IPQC" | "FQC" | "KTL" | "NCR" | "CAPA" | "TH"
  | "DT" | "PT" | "PC" | "CQ" | "CNT" | "CNP" | "PB"
  | "NCC" | "DL" | "NL" | "TD" | "BB" | "BTP";

// Độ rộng số và có đánh số lại theo tháng hay không
const DOC_FORMAT: Record<DocPrefix, { width: number; monthly: boolean }> = {
  PN: { width: 4, monthly: true },
  PX: { width: 4, monthly: true },
  DCK: { width: 3, monthly: true },
  KK: { width: 3, monthly: true },
  VT: { width: 4, monthly: true },
  EX: { width: 3, monthly: true },
  KH: { width: 3, monthly: true },
  LSX: { width: 3, monthly: true },
  CX: { width: 3, monthly: true },
  FORM: { width: 3, monthly: false },
  TC: { width: 3, monthly: false },
  IQC: { width: 3, monthly: true },
  IPQC: { width: 3, monthly: true },
  FQC: { width: 3, monthly: true },
  KTL: { width: 3, monthly: true },
  NCR: { width: 3, monthly: true },
  CAPA: { width: 3, monthly: true },
  TH: { width: 2, monthly: true },
  DT: { width: 3, monthly: true },
  PT: { width: 4, monthly: true },
  PC: { width: 4, monthly: true },
  CQ: { width: 3, monthly: true },
  CNT: { width: 4, monthly: true },
  CNP: { width: 4, monthly: true },
  PB: { width: 2, monthly: true },
  NCC: { width: 3, monthly: false },
  DL: { width: 3, monthly: false },
  NL: { width: 3, monthly: false },
  TD: { width: 3, monthly: false },
  BB: { width: 3, monthly: false },
  BTP: { width: 3, monthly: false },
};

export const DOC_PREFIXES = Object.keys(DOC_FORMAT) as DocPrefix[];

export function isMonthlyPrefix(prefix: DocPrefix): boolean {
  return DOC_FORMAT[prefix].monthly;
}

// Khóa trong doc_sequences: "PN-2611" (theo tháng) hoặc "FORM" (không).
export function docSequenceKey(prefix: DocPrefix, at: Date): string {
  return DOC_FORMAT[prefix].monthly ? `${prefix}-${vnYearMonth(at)}` : prefix;
}

// PN + "2611" + 1 → "PN-2611-0001"; FORM + null + 7 → "FORM-007". Hết độ rộng thì số dài thêm (9999 → 10000).
export function formatDocCode(prefix: DocPrefix, yymm: string | null, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`Số thứ tự không hợp lệ: ${seq}`);
  const { width } = DOC_FORMAT[prefix];
  const n = String(seq).padStart(width, "0");
  return yymm ? `${prefix}-${yymm}-${n}` : `${prefix}-${n}`;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// "YYYY-MM-DD" theo giờ Việt Nam (UTC+7)
export function vnToday(now: Date = new Date()): string {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${vn.getUTCFullYear()}-${p(vn.getUTCMonth() + 1)}-${p(vn.getUTCDate())}`;
}
