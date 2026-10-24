import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import { emailHtml, ZALO_TOKEN_ERRORS, zaloText, type Message } from "./rules";

export type SendResult = { ok: true } | { ok: false; error: string; skipped?: boolean };

const TIMEOUT_MS = 10_000;

// ---------- Email qua Resend (https://resend.com) ----------
// Chưa có tên miền riêng: dùng người gửi onboarding@resend.dev, chỉ gửi được tới email chủ tài khoản Resend.

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(to: string, message: Message): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true, error: "Chưa cấu hình RESEND_API_KEY" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_EMAIL_FROM || "Pomil OS <onboarding@resend.dev>",
        to: [to],
        subject: message.subject,
        text: message.text,
        html: emailHtml(message),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const body = await res.text();
    return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
  } catch (error) {
    return { ok: false, error: `Không gọi được Resend: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ---------- Zalo Official Account ----------
// Gửi "tin tư vấn" tới người đã quan tâm OA. Access token sống khoảng 25 giờ; refresh token chỉ
// dùng được một lần, mỗi lần làm mới Zalo trả refresh token mới nên phải lưu lại vào DB.

const ZALO_TOKEN_KEY = "zalo_oa_token";
type ZaloToken = { accessToken: string; refreshToken: string; expiresAt: string };

export function zaloConfigured(): boolean {
  return !!(process.env.ZALO_OA_APP_ID && process.env.ZALO_OA_SECRET_KEY && process.env.ZALO_OA_REFRESH_TOKEN);
}

async function readToken(): Promise<ZaloToken | null> {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, ZALO_TOKEN_KEY));
  return (row?.value as ZaloToken | undefined) ?? null;
}

async function saveToken(token: ZaloToken): Promise<void> {
  const db = await getDb();
  await db
    .insert(settings)
    .values({ key: ZALO_TOKEN_KEY, value: token })
    .onConflictDoUpdate({ target: settings.key, set: { value: token, updatedAt: new Date() } });
}

// Một lần làm mới tại một thời điểm: hai lần cùng lúc sẽ dùng chung refresh token và lần sau bị từ chối.
let refreshing: Promise<string> | null = null;

async function refreshToken(): Promise<string> {
  refreshing ??= (async () => {
    try {
      const stored = await readToken();
      const refresh = stored?.refreshToken || process.env.ZALO_OA_REFRESH_TOKEN;
      if (!refresh) throw new Error("Chưa có ZALO_OA_REFRESH_TOKEN");
      const res = await fetch("https://oauth.zaloapp.com/v4/oa/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", secret_key: process.env.ZALO_OA_SECRET_KEY ?? "" },
        body: new URLSearchParams({ refresh_token: refresh, app_id: process.env.ZALO_OA_APP_ID ?? "", grant_type: "refresh_token" }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: string | number; error?: number; error_description?: string };
      if (!data.access_token || !data.refresh_token) {
        throw new Error(`Zalo từ chối làm mới token: ${data.error_description ?? data.error ?? res.status}. Có thể refresh token đã dùng hoặc hết hạn (3 tháng): lấy refresh token mới và cập nhật ZALO_OA_REFRESH_TOKEN.`);
      }
      // Trừ 5 phút cho chắc
      const expiresAt = new Date(Date.now() + (Number(data.expires_in ?? 90000) - 300) * 1000).toISOString();
      await saveToken({ accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt });
      return data.access_token;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function accessToken(force = false): Promise<string> {
  const stored = await readToken();
  if (!force && stored && new Date(stored.expiresAt).getTime() > Date.now()) return stored.accessToken;
  return refreshToken();
}

type ZaloResponse = { error?: number; message?: string; data?: unknown };

async function zaloCall(method: "GET" | "POST", path: string, payload: Record<string, unknown>, retried = false): Promise<ZaloResponse> {
  const token = await accessToken(retried);
  const url = new URL(`https://openapi.zalo.me${path}`);
  if (method === "GET") url.searchParams.set("data", JSON.stringify(payload));
  const res = await fetch(url, {
    method,
    headers: { access_token: token, "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json()) as ZaloResponse;
  if (!retried && typeof data.error === "number" && ZALO_TOKEN_ERRORS.includes(data.error)) return zaloCall(method, path, payload, true);
  return data;
}

export async function sendZalo(userId: string, message: Message): Promise<SendResult> {
  if (!zaloConfigured()) return { ok: false, skipped: true, error: "Chưa cấu hình ZALO_OA_APP_ID, ZALO_OA_SECRET_KEY, ZALO_OA_REFRESH_TOKEN" };
  try {
    const data = await zaloCall("POST", "/v3.0/oa/message/cs", { recipient: { user_id: userId }, message: { text: zaloText(message) } });
    if (data.error === 0) return { ok: true };
    return { ok: false, error: `Zalo lỗi ${data.error}: ${data.message ?? "không rõ"}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Giúp chủ cửa hàng tìm user_id của mình: liệt kê người vừa tương tác với OA kèm tên hiển thị.
export async function listRecentZaloUsers(): Promise<{ ok: true; users: { userId: string; name: string }[] } | { ok: false; error: string }> {
  if (!zaloConfigured()) return { ok: false, error: "Chưa cấu hình Zalo OA" };
  try {
    const list = await zaloCall("GET", "/v3.0/oa/user/getlist", { offset: 0, count: 20, last_interaction_period: "L30D" });
    if (list.error !== 0) return { ok: false, error: `Zalo lỗi ${list.error}: ${list.message ?? ""}` };
    const ids = ((list.data as { users?: { user_id?: string }[] } | undefined)?.users ?? []).map((u) => u.user_id).filter((x): x is string => !!x);
    const users = await Promise.all(
      ids.slice(0, 20).map(async (userId) => {
        const detail = await zaloCall("GET", "/v3.0/oa/user/detail", { user_id: userId }).catch(() => null);
        const name = (detail?.data as { display_name?: string } | undefined)?.display_name ?? "";
        return { userId, name };
      }),
    );
    return { ok: true, users };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
