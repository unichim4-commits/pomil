import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contentPages } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export type ContentPage = typeof contentPages.$inferSelect;
export type ContentInput = Omit<typeof contentPages.$inferInsert, "id" | "createdAt" | "updatedAt" | "publishedAt">;

export async function getPublishedPage(slug: string, kind: "page" | "post"): Promise<ContentPage | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(contentPages)
    .where(and(eq(contentPages.slug, slug), eq(contentPages.kind, kind), eq(contentPages.status, "published")));
  return row ?? null;
}

export async function listPublishedPosts(limit = 50): Promise<ContentPage[]> {
  const db = await getDb();
  return db
    .select()
    .from(contentPages)
    .where(and(eq(contentPages.kind, "post"), eq(contentPages.status, "published")))
    .orderBy(desc(contentPages.publishedAt))
    .limit(limit);
}

export async function listFooterPages(): Promise<{ slug: string; title: string }[]> {
  const db = await getDb();
  return db
    .select({ slug: contentPages.slug, title: contentPages.title })
    .from(contentPages)
    .where(and(eq(contentPages.kind, "page"), eq(contentPages.status, "published"), eq(contentPages.showInFooter, true)))
    .orderBy(contentPages.title);
}

export async function listAllContent(): Promise<ContentPage[]> {
  const db = await getDb();
  return db.select().from(contentPages).orderBy(contentPages.kind, desc(contentPages.updatedAt));
}

export async function getContent(id: string): Promise<ContentPage | null> {
  const db = await getDb();
  const [row] = await db.select().from(contentPages).where(eq(contentPages.id, id));
  return row ?? null;
}

export async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ id: contentPages.id })
    .from(contentPages)
    .where(and(eq(contentPages.slug, slug), exceptId ? ne(contentPages.id, exceptId) : undefined));
  return rows.length > 0;
}

export async function saveContent(id: string | null, input: ContentInput, actorId: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    if (!id) {
      const [row] = await tx
        .insert(contentPages)
        .values({ ...input, publishedAt: input.status === "published" ? new Date() : null })
        .returning({ id: contentPages.id });
      await writeAudit(tx, { actorId, action: "content.created", entity: "content_pages", entityId: row!.id, after: { title: input.title, status: input.status } });
      return row!.id;
    }
    const [before] = await tx.select().from(contentPages).where(eq(contentPages.id, id));
    if (!before) throw new UserError("Không tìm thấy trang");
    const publishedAt = input.status === "published" ? (before.publishedAt ?? new Date()) : before.publishedAt;
    await tx
      .update(contentPages)
      .set({ ...input, publishedAt, updatedAt: new Date() })
      .where(eq(contentPages.id, id));
    await writeAudit(tx, {
      actorId,
      action: "content.updated",
      entity: "content_pages",
      entityId: id,
      before: { title: before.title, status: before.status },
      after: { title: input.title, status: input.status },
    });
    return id;
  });
}

export async function deleteContent(id: string, actorId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.delete(contentPages).where(eq(contentPages.id, id)).returning();
    if (before) await writeAudit(tx, { actorId, action: "content.deleted", entity: "content_pages", entityId: id, before: { title: before.title, slug: before.slug } });
  });
}
