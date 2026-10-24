// Tạo chuỗi ngẫu nhiên dạng base64url (A–Z a–z 0–9 - _), chạy được cả trên trình duyệt lẫn Node.
// Dùng cho nút "Tạo chuỗi ngẫu nhiên" ở /dang-nhap: chuỗi tạo trên máy người dùng, không gửi đi đâu.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const RANDOM_TOKEN_BYTES = 24; // 24 byte = 192 bit = 32 ký tự base64url

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += ALPHABET[c & 63];
  }
  return out;
}

export function randomToken(
  bytes = RANDOM_TOKEN_BYTES,
  fill: (buf: Uint8Array) => Uint8Array = (buf) => globalThis.crypto.getRandomValues(buf),
): string {
  return toBase64Url(fill(new Uint8Array(bytes)));
}
