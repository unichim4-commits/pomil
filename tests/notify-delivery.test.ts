import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-notify-"));
process.env.PGLITE_DIR = dir;
process.env.NEXT_PUBLIC_SITE_URL = "https://pomil.vn";

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { notificationLog, settings } from "@/db/schema";
import { deliver, retryNotification } from "@/modules/notify/service";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let zaloSendError = 0;

function fakeFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const u = String(url);
  calls.push({ url: u, init });
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  if (u === "https://api.resend.com/emails") return json({ id: "email_1" });
  if (u === "https://oauth.zaloapp.com/v4/oa/access_token") {
    const n = calls.filter((c) => c.url.includes("oauth.zaloapp.com")).length;
    return json({ access_token: `AT${n}`, refresh_token: `RT${n}`, expires_in: "90000" });
  }
  if (u.startsWith("https://openapi.zalo.me/v3.0/oa/message/cs")) {
    if (zaloSendError) {
      const code = zaloSendError;
      zaloSendError = 0;
      return json({ error: code, message: "Access token is invalid" });
    }
    return json({ error: 0, message: "Success", data: { message_id: "m1" } });
  }
  return json({ error: "unexpected" }, 500);
}

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  const db = await getDb();
  await db
    .update(settings)
    .set({ value: { notifyEmails: "chu@pomil.vn", notifyZaloUserIds: "1234567890", notifyOnOrder: true, notifyOnComplaint: false } })
    .where(eq(settings.key, "store"));
}, 120_000);

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  process.env.RESEND_API_KEY = "re_test";
  process.env.ZALO_OA_APP_ID = "app1";
  process.env.ZALO_OA_SECRET_KEY = "secret1";
  process.env.ZALO_OA_REFRESH_TOKEN = "RT0";
});

const order = {
  kind: "order_created" as const,
  orderId: "11111111-1111-4111-8111-111111111111",
  code: "WEB-2711-0001",
  total: 254_000,
  items: [{ name: "Pomelo Scalp Tonic", quantity: 1 }],
  recipientName: "Lan",
  phoneE164: "84901234567",
  province: "Hà Nội",
  paymentMethod: "cod" as const,
  customerNote: null,
};

describe("notification delivery", () => {
  it("sends email and Zalo, refreshes the Zalo token once and stores the rotated one", async () => {
    const r = await deliver(order);
    expect(r).toEqual({ sent: 2, failed: 0, skipped: 0, noRecipients: false });

    const email = calls.find((c) => c.url.includes("resend"))!;
    expect((email.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const emailBody = JSON.parse(String(email.init.body));
    expect(emailBody.to).toEqual(["chu@pomil.vn"]);
    expect(emailBody.subject).toBe("[Pomil] Đơn mới WEB-2711-0001 · 254.000đ");

    const refresh = calls.find((c) => c.url.includes("oauth.zaloapp.com"))!;
    expect((refresh.init.headers as Record<string, string>).secret_key).toBe("secret1");
    expect(String(refresh.init.body)).toBe("refresh_token=RT0&app_id=app1&grant_type=refresh_token");

    const send = calls.find((c) => c.url.includes("message/cs"))!;
    expect((send.init.headers as Record<string, string>).access_token).toBe("AT1");
    expect(JSON.parse(String(send.init.body))).toMatchObject({ recipient: { user_id: "1234567890" }, message: { text: expect.stringContaining("WEB-2711-0001") } });

    const db = await getDb();
    const [token] = await db.select().from(settings).where(eq(settings.key, "zalo_oa_token"));
    expect(token?.value).toMatchObject({ accessToken: "AT1", refreshToken: "RT1" });
    const logs = await db.select().from(notificationLog);
    expect(logs.map((l) => l.status).sort()).toEqual(["sent", "sent"]);
  });

  it("reuses a valid token, and on a token error refreshes with the stored token and retries", async () => {
    await deliver(order);
    expect(calls.filter((c) => c.url.includes("oauth")).length).toBe(0);

    calls = [];
    zaloSendError = -216;
    const r = await deliver(order);
    expect(r.sent).toBe(2);
    const refresh = calls.find((c) => c.url.includes("oauth"))!;
    expect(String(refresh.init.body)).toContain("refresh_token=RT1");
    expect(calls.filter((c) => c.url.includes("message/cs")).length).toBe(2);
  });

  it("skips mild complaints when turned off but always sends urgent ones", async () => {
    const mild = { kind: "complaint_created" as const, complaintId: "22222222-2222-4222-8222-222222222222", lotNo: "PST-271101-01", sampleCode: null, severity: "mild" as const, symptoms: "ngứa nhẹ", contactPhone: null, lotHeld: false };
    expect((await deliver(mild)).noRecipients).toBe(true);
    const urgent = await deliver({ ...mild, lotHeld: true });
    expect(urgent.sent).toBe(2);
  });

  it("logs a skipped channel when keys are missing and retries it later", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await deliver({ kind: "test", requestedBy: "chu@pomil.vn" });
    expect(r.skipped).toBe(1);
    const db = await getDb();
    const [skipped] = await db.select().from(notificationLog).where(eq(notificationLog.status, "skipped"));
    expect(skipped?.error).toContain("RESEND_API_KEY");

    process.env.RESEND_API_KEY = "re_test";
    expect((await retryNotification(skipped!.id)).ok).toBe(true);
    const [after] = await db.select().from(notificationLog).where(eq(notificationLog.id, skipped!.id));
    expect(after).toMatchObject({ status: "sent", attempts: 2 });
  });
});
