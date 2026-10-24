// Ghi lỗi mà không ghi dữ liệu khách.
// Lỗi truy vấn của Drizzle (DrizzleQueryError) có cả câu SQL và giá trị tham số (tên, SĐT, địa chỉ)
// trong message và stack. Ở đây chỉ giữ: tên lỗi, mã lỗi Postgres (SQLSTATE) và message gốc của
// Postgres đã cắt phần SQL/params và che số, email, giá trị trong ngoặc kép sau dấu hai chấm.
// Không bao giờ ghi stack, `params`, `query` hay `detail`.

export type SafeError = { name: string; code: string | null; message: string };

const MAX_MESSAGE = 200;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function sqlState(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
  }
  return null;
}

export function redact(text: string): string {
  return (
    text
      // Bỏ hết phần sau "Failed query" hoặc "params:" (SQL và giá trị tham số)
      .replace(/Failed query:[\s\S]*/i, "")
      .replace(/\bparams:[\s\S]*/i, "")
      .split(/\r?\n/)[0]!
      // Email
      .replace(/[^\s@"'()]+@[^\s@"'()]+\.[^\s@"'()]+/g, "[email]")
      // Giá trị đứng sau dấu hai chấm trong ngoặc kép/đơn, ví dụ: invalid input syntax for type uuid: "…"
      .replace(/(:\s*)(["'])[^"']*\2/g, "$1$2…$2")
      // Dãy số dài (số điện thoại, số tài khoản, mã)
      .replace(/\+?\d[\d\s.-]{5,}\d/g, "[số]")
      .trim()
      .slice(0, MAX_MESSAGE)
  );
}

export function describeError(error: unknown): SafeError {
  if (typeof error === "string") return { name: "Error", code: null, message: redact(error) };
  const e = asRecord(error);
  if (!e) return { name: typeof error, code: null, message: "" };
  const cause = asRecord(e.cause);
  const name = typeof e.name === "string" ? e.name : "Error";
  const code = sqlState(e.code, cause?.code);
  // Với lỗi truy vấn: dùng message của lỗi gốc từ Postgres (không chứa SQL), bỏ message của Drizzle.
  const raw = cause && typeof cause.message === "string" ? cause.message : typeof e.message === "string" ? e.message : "";
  return { name, code, message: redact(raw) };
}

export function formatSafeError(context: string, error: unknown): string {
  const d = describeError(error);
  return `[${context}] ${d.name}${d.code ? ` ${d.code}` : ""}${d.message ? `: ${d.message}` : ""}`;
}

export function logError(context: string, error: unknown): void {
  console.error(formatSafeError(context, error));
}
