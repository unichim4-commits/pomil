// 229000 → "229.000đ"
export function formatVnd(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const digits = String(Math.abs(Math.round(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${digits}đ`;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Hiển thị theo giờ Việt Nam bất kể máy chủ đặt ở đâu: "22/10/2026 14:05"
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(new Date(date).getTime() + VN_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function formatDate(date: Date | string | null | undefined): string {
  return formatDateTime(date).slice(0, 10);
}

// "Bưởi Da Xanh đẹp" → "buoi-da-xanh-dep"
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Hiển thị 84901234567 thành 0901 234 567
export function displayPhone(phoneE164: string): string {
  if (!phoneE164.startsWith("84") || phoneE164.length !== 11) return phoneE164;
  const n = `0${phoneE164.slice(2)}`;
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
}
