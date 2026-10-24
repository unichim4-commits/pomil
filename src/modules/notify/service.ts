import "server-only";
import { count, desc, eq } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db/client";
import { logError } from "@/lib/log";
import { notificationLog } from "@/db/schema";
import { getSettings } from "@/modules/settings/service";
import { sendEmail, sendZalo, type SendResult } from "./channels";
import { composeMessage, eventEntityId, recipientsFor, type Message, type NotifyEvent } from "./rules";

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

async function sendOne(channel: "email" | "zalo", recipient: string, message: Message): Promise<SendResult> {
  return channel === "email" ? sendEmail(recipient, message) : sendZalo(recipient, message);
}

export type DeliverySummary = { sent: number; failed: number; skipped: number; noRecipients: boolean };

// Gửi tới mọi người nhận, ghi từng lần gửi vào notification_log. Không bao giờ ném lỗi ra ngoài.
export async function deliver(event: NotifyEvent): Promise<DeliverySummary> {
  const summary: DeliverySummary = { sent: 0, failed: 0, skipped: 0, noRecipients: false };
  try {
    const prefs = await getSettings();
    const message = composeMessage(event, siteUrl());
    const { emails, zaloIds } = recipientsFor(event, prefs, process.env.ALERT_EMAIL);
    const targets = [...emails.map((r) => ({ channel: "email" as const, r })), ...zaloIds.map((r) => ({ channel: "zalo" as const, r }))];
    if (targets.length === 0) {
      summary.noRecipients = true;
      return summary;
    }

    const db = await getDb();
    const results = await Promise.all(targets.map(async (t) => ({ ...t, result: await sendOne(t.channel, t.r, message) })));
    for (const { channel, r, result } of results) {
      const status = result.ok ? "sent" : result.skipped ? "skipped" : "failed";
      summary[status === "sent" ? "sent" : status === "skipped" ? "skipped" : "failed"]++;
      await db.insert(notificationLog).values({
        event: event.kind,
        entityId: eventEntityId(event),
        channel,
        recipient: r,
        status,
        error: result.ok ? null : result.error,
        subject: message.subject,
        body: message.text,
        sentAt: result.ok ? new Date() : null,
      });
      if (!result.ok && !result.skipped) logError(`notify ${event.kind} via ${channel}`, result.error);
    }
  } catch (error) {
    logError("notify deliver", error);
  }
  return summary;
}

// Gửi sau khi đã trả trang cho khách: thông báo chậm hay lỗi cũng không làm hỏng việc đặt đơn.
export function notifyInBackground(event: NotifyEvent): void {
  after(() => deliver(event));
}

export async function retryNotification(id: string): Promise<SendResult> {
  const db = await getDb();
  const [row] = await db.select().from(notificationLog).where(eq(notificationLog.id, id));
  if (!row) return { ok: false, error: "Không tìm thấy" };
  if (row.status === "sent") return { ok: true };
  const channel = row.channel === "zalo" ? "zalo" : "email";
  const result = await sendOne(channel, row.recipient, { subject: row.subject, text: row.body, urgent: row.subject.includes("KHẨN") });
  await db
    .update(notificationLog)
    .set({
      status: result.ok ? "sent" : result.skipped ? "skipped" : "failed",
      error: result.ok ? null : result.error,
      attempts: row.attempts + 1,
      sentAt: result.ok ? new Date() : null,
    })
    .where(eq(notificationLog.id, id));
  return result;
}

export const NOTIFY_PAGE_SIZE = 50;

export async function listNotifications(page = 1) {
  const db = await getDb();
  return db
    .select()
    .from(notificationLog)
    .orderBy(desc(notificationLog.createdAt))
    .limit(NOTIFY_PAGE_SIZE)
    .offset((Math.max(1, page) - 1) * NOTIFY_PAGE_SIZE);
}

export async function countFailedNotifications(): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(notificationLog).where(eq(notificationLog.status, "failed"));
  return row?.n ?? 0;
}
