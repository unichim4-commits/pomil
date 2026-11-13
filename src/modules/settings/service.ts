import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb, type Db, type Tx } from "@/db/client";
import { settings } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { ERP_SETTINGS_KEY, parseErpSettings, type ErpSettings } from "./erp-schema";
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

// Cài đặt ERP (khóa "erp"): thiếu khóa hay thiếu trường thì dùng mặc định.
export const getErpSettings = cache(async (): Promise<ErpSettings> => {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, ERP_SETTINGS_KEY));
  return parseErpSettings(row?.value);
});

// Ghi trong giao dịch của người gọi khi cần (ví dụ refreshExpiredStock cập nhật lastExpiryRefreshAt).
export async function saveErpSettings(next: ErpSettings, actorId: string | null, tx?: Tx): Promise<void> {
  const run = async (t: Db | Tx) => {
    const [before] = await t.select().from(settings).where(eq(settings.key, ERP_SETTINGS_KEY));
    await t
      .insert(settings)
      .values({ key: ERP_SETTINGS_KEY, value: next })
      .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
    await writeAudit(t, {
      actorId,
      action: "settings.erp_updated",
      entity: "settings",
      before: (before?.value as Record<string, unknown>) ?? null,
      after: next,
    });
  };
  if (tx) return run(tx);
  const db = await getDb();
  await db.transaction(run);
}

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
