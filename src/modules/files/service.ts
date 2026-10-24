import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { files } from "@/db/schema";
import { UserError } from "@/lib/errors";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export async function saveImage(file: File, uploadedBy: string): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number])) throw new UserError("Chỉ nhận ảnh JPG, PNG, WebP hoặc AVIF.");
  if (file.size > MAX_IMAGE_BYTES) throw new UserError("Ảnh tối đa 3 MB. Hãy nén ảnh trước khi tải lên.");
  const data = Buffer.from(await file.arrayBuffer());
  const db = await getDb();
  const [row] = await db
    .insert(files)
    .values({
      data,
      size: data.length,
      originalName: file.name.slice(0, 200),
      sha256: createHash("sha256").update(data).digest("hex"),
      contentType: file.type,
      uploadedBy,
    })
    .returning({ id: files.id });
  return row!.id;
}

export async function readFile(id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ data: files.data, contentType: files.contentType, sha256: files.sha256 })
    .from(files)
    .where(eq(files.id, id));
  return row ?? null;
}

export function fileUrl(id: string): string {
  return `/api/files/${id}`;
}
