// Khởi tạo tài khoản chủ cửa hàng đầu tiên. Hàm thuần để test được.
// Không import vào component phía khách (dùng node:crypto).
import { createHash, timingSafeEqual } from "node:crypto";

export const SETUP_TOKEN_MIN = 24;

export type SetupMode = "open" | "token" | "disabled";

// open: máy dev không đặt mã, cho tạo luôn.
// token: phải nhập đúng SETUP_TOKEN.
// disabled: bản chạy thật chưa đặt SETUP_TOKEN đủ dài, không cho tạo.
export function setupMode(env: { nodeEnv: string | undefined; setupToken: string | undefined }): SetupMode {
  const token = env.setupToken?.trim() ?? "";
  if (token.length >= SETUP_TOKEN_MIN) return "token";
  return env.nodeEnv === "production" ? "disabled" : "open";
}

// So sánh thời gian cố định: băm hai bên về cùng độ dài rồi timingSafeEqual.
export function setupTokenMatches(expected: string, given: string): boolean {
  const e = expected.trim();
  const g = given.trim();
  if (!e || !g) return false;
  const a = createHash("sha256").update(e).digest();
  const b = createHash("sha256").update(g).digest();
  return timingSafeEqual(a, b);
}
