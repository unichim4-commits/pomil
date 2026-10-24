// Số lô: MÃSẢNPHẨM-YYMMDD-NN, ví dụ PST-271020-01
const LOT_NO_RE = /^([A-Z]{2,5})-(\d{2})(\d{2})(\d{2})-(\d{2})$/;

export type ParsedLotNo = { productCode: string; manufacturedOn: Date; batch: number };

export function parseLotNo(lotNo: string): ParsedLotNo | null {
  const m = LOT_NO_RE.exec(lotNo.trim().toUpperCase());
  if (!m) return null;
  const [, code, yy, mm, dd, nn] = m;
  const year = 2000 + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const batch = Number(nn);
  if (batch < 1) return null;
  return { productCode: code!, manufacturedOn: date, batch };
}

export function formatLotNo(productCode: string, manufacturedOn: Date, batch: number): string {
  const yy = String(manufacturedOn.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(manufacturedOn.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(manufacturedOn.getUTCDate()).padStart(2, "0");
  return `${productCode.toUpperCase()}-${yy}${mm}${dd}-${String(batch).padStart(2, "0")}`;
}

export function lotPageUrl(siteUrl: string, lotNo: string): string {
  return `${siteUrl.replace(/\/$/, "")}/l/${encodeURIComponent(lotNo)}`;
}
