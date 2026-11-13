// Đọc form "Vận hành" (cài đặt erp, 00-tong-quan mục 10). Hàm thuần, không phải "use server".
import { erpSettingsSchema, type ErpSettings } from "@/modules/settings/erp-schema";
import { parseVnNumber } from "@/modules/inventory/rules";

type Field = { key: Exclude<keyof ErpSettings, "lastExpiryRefreshAt">; label: string; unit: "days" | "weeks" | "percent" | "vnd"; hint: string };

export const ERP_FIELDS: Field[] = [
  { key: "expiryWarnDays", label: "Cảnh báo lô sắp hết hạn trước", unit: "days", hint: "Kho: lô còn ít ngày hơn số này hiện cảnh báo." },
  { key: "slowMovingDays", label: "Tồn lâu khi không xuất trong", unit: "days", hint: "Kho: báo cáo tồn lâu." },
  { key: "overIssueWarnBp", label: "Cảnh báo xuất vượt định mức quá", unit: "percent", hint: "Sản xuất: xuất nguyên liệu vượt công thức." },
  { key: "budgetWarnBp", label: "Cảnh báo ngân sách khi đã dùng", unit: "percent", hint: "Tài chính: ngân sách tháng." },
  { key: "debtDueSoonDays", label: "Công nợ sắp đến hạn trong", unit: "days", hint: "Tài chính: phải thu, phải trả." },
  { key: "minCashAlert", label: "Cảnh báo khi tổng tiền dưới", unit: "vnd", hint: "Tài chính: 0 là không cảnh báo." },
  { key: "forecastWeeks", label: "Dự báo dòng tiền", unit: "weeks", hint: "Tài chính: số tuần nhìn trước." },
  { key: "manualDiscountMaxBp", label: "Chiết khấu tay tối đa (không cần quyền giá)", unit: "percent", hint: "Bán hàng: vượt mức cần người có quyền giá." },
  { key: "returnWindowDays", label: "Nhận đổi trả trong", unit: "days", hint: "Bán hàng: tính từ ngày giao, 0 là không giới hạn." },
];

export const UNIT_LABEL: Record<Field["unit"], string> = { days: "ngày", weeks: "tuần", percent: "%", vnd: "đồng" };

// Giá trị hiển thị trong ô: phần trăm từ bp (500 → "5"), tiền có dấu chấm nhóm nghìn
export function erpFieldValue(s: ErpSettings, f: Field): string {
  const v = s[f.key];
  if (f.unit === "percent") {
    const whole = Math.trunc(v / 100);
    const frac = v % 100;
    return frac ? `${whole},${String(frac).padStart(2, "0").replace(/0$/, "")}` : String(whole);
  }
  if (f.unit === "vnd") return v.toLocaleString("vi-VN");
  return String(v);
}

// Chuyển chữ người dùng nhập thành số nguyên đúng đơn vị lưu (bp cho %, đồng cho tiền)
function toStored(raw: string, unit: Field["unit"]): number | null {
  const n = parseVnNumber(raw);
  if (!n) return null;
  if (unit === "percent") {
    if (n.frac.length > 2) return null;
    return Number(n.int) * 100 + Number((n.frac + "00").slice(0, 2));
  }
  if (n.frac && /[1-9]/.test(n.frac)) return null;
  return Number(n.int);
}

// Ghép cài đặt mới: giữ lastExpiryRefreshAt của bản hiện tại (người dùng không sửa mốc này)
export function parseErpForm(get: (key: string) => string, current: ErpSettings): { ok: true; value: ErpSettings } | { ok: false; message: string } {
  const next: Record<string, unknown> = { lastExpiryRefreshAt: current.lastExpiryRefreshAt };
  for (const f of ERP_FIELDS) {
    const raw = get(f.key).trim();
    const v = raw === "" ? null : toStored(raw, f.unit);
    if (v === null) return { ok: false, message: `${f.label}: nhập số hợp lệ` };
    next[f.key] = v;
  }
  const parsed = erpSettingsSchema.safeParse(next);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.path[0];
    const f = ERP_FIELDS.find((x) => x.key === key);
    return { ok: false, message: `${f?.label ?? String(key)}: ngoài khoảng cho phép` };
  }
  return { ok: true, value: parsed.data };
}
