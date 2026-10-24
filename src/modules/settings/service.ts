import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { parseSettings, SETTINGS_KEY, type StoreSettings } from "./schema";

export const getSettings = cache(async (): Promise<StoreSettings> => {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY));
  return parseSettings(row?.value);
});

// Chế độ dữ liệu ban đầu ("demo" khi chạy thử bằng dữ liệu mẫu), null nếu DB nạp tay.
export const getSeedMode = cache(async (): Promise<"demo" | "production" | null> => {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, "seed_mode"));
  const mode = (row?.value as { mode?: string } | undefined)?.mode;
  return mode === "demo" || mode === "production" ? mode : null;
});

export async function saveSettings(next: StoreSettings, actorId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(settings).where(eq(settings.key, SETTINGS_KEY));
    await tx
      .insert(settings)
      .values({ key: SETTINGS_KEY, value: next })
      .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
    await writeAudit(tx, {
      actorId,
      action: "settings.updated",
      entity: "settings",
      before: (before?.value as Record<string, unknown>) ?? null,
      after: next,
    });
  });
}
