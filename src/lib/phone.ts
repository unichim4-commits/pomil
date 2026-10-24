// Chuẩn hóa số di động Việt Nam về dạng 84xxxxxxxxx (không dấu +).
// Trả về null nếu không phải số di động hợp lệ.
const MOBILE_PREFIXES = new Set(["3", "5", "7", "8", "9"]);

export function normalizeVnPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "").replace(/^\+/, "");
  let national: string;
  if (digits.startsWith("84")) national = digits.slice(2);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;

  if (national.length !== 9) return null;
  if (!MOBILE_PREFIXES.has(national[0] ?? "")) return null;
  return `84${national}`;
}

// Che số khi hiển thị cho cộng tác viên: 84901***567
export function maskPhone(phoneE164: string): string {
  if (phoneE164.length < 8) return "***";
  return `${phoneE164.slice(0, 5)}***${phoneE164.slice(-3)}`;
}

// Số dạng 0xxxxxxxxx để làm link zalo.me. Nhận +84, khoảng trắng, dấu chấm, gạch. Không hợp lệ thì null.
export function toLocalMobile(input: string): string | null {
  const e164 = normalizeVnPhone(input);
  return e164 ? `0${e164.slice(2)}` : null;
}

// Số cho link tel:. Nhận di động, số bàn 0xxxxxxxxx và tổng đài 1800/1900. Không hợp lệ thì null.
export function toTelNumber(input: string): string | null {
  const mobile = toLocalMobile(input);
  if (mobile) return mobile;
  let digits = input.replace(/[\s.\-()]/g, "");
  if (digits.startsWith("+84")) digits = `0${digits.slice(3)}`;
  if (!/^\d+$/.test(digits)) return null;
  if (/^(1800|1900)\d{4,6}$/.test(digits)) return digits;
  if (/^0\d{9,10}$/.test(digits)) return digits;
  return null;
}
