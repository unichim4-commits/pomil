import { auditLog } from "@/db/schema";
import type { Db, Tx } from "@/db/client";

export async function writeAudit(
  tx: Db | Tx,
  entry: {
    actorId: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
