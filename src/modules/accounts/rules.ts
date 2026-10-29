// Quy tắc tài khoản khách. Hàm thuần để test được.

export const CUSTOMER_SESSION_DAYS = 30;
export const CUSTOMER_SESSION_COOKIE = "pomil_khach";
// Khách chỉ cần mật khẩu ngắn hơn nhân viên, nhưng không quá dễ đoán
export const CUSTOMER_MIN_PASSWORD = 8;

export function customerPasswordProblem(password: string, phoneDigits?: string): string | null {
  if (password.length < CUSTOMER_MIN_PASSWORD) return `Mật khẩu cần ít nhất ${CUSTOMER_MIN_PASSWORD} ký tự.`;
  if (password.length > 200) return "Mật khẩu quá dài.";
  if (/^(\d)\1+$/.test(password) || ["12345678", "123456789", "87654321", "password", "matkhau1"].includes(password.toLowerCase())) {
    return "Mật khẩu này quá dễ đoán, bạn chọn mật khẩu khác nhé.";
  }
  // So phần số của mật khẩu (bỏ số 0 hoặc 84 đầu) với đuôi số điện thoại
  const digits = password.replace(/\D/g, "").replace(/^(84|0)/, "");
  if (phoneDigits && digits.length >= 8 && phoneDigits.endsWith(digits)) {
    return "Đừng dùng số điện thoại làm mật khẩu.";
  }
  return null;
}

// Chỉ cho chuyển về đường dẫn trong website sau khi đăng nhập (chặn //evil.com, https://…).
export function safeNextPath(next: string | null | undefined, fallback = "/tai-khoan"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.startsWith("/admin") || next.startsWith("/tai-khoan/dang-")) return fallback;
  return next.slice(0, 300);
}
