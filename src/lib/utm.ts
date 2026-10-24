// Quy ước UTM thống nhất (xem Briefing triển khai, mục 4.2).
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>> & { ref?: string; landedAt?: string };

export const UTM_COOKIE = "pomil_utm";

// Lấy UTM và mã giới thiệu từ query string; null nếu không có gì.
export function parseUtm(params: URLSearchParams, now = new Date()): Utm | null {
  const utm: Utm = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim().toLowerCase();
    if (value) utm[key] = value.slice(0, 100);
  }
  const ref = params.get("ref")?.trim().toUpperCase();
  if (ref) utm.ref = ref.slice(0, 20);
  if (Object.keys(utm).length === 0) return null;
  utm.landedAt = now.toISOString();
  return utm;
}

export function encodeUtmCookie(utm: Utm): string {
  return encodeURIComponent(JSON.stringify(utm));
}

export function decodeUtmCookie(raw: string | undefined): Utm | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (parsed && typeof parsed === "object") return parsed as Utm;
  } catch {
    // cookie hỏng thì bỏ qua
  }
  return null;
}
