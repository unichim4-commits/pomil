import { readFile } from "@/modules/files/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ảnh tải lên không bao giờ đổi nội dung (sửa ảnh là tạo tệp mới), nên cho trình duyệt giữ lâu.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });
  const file = await readFile(id);
  if (!file?.data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${file.sha256}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
