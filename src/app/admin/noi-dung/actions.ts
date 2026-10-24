"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { slugify } from "@/lib/format";
import { requirePermission } from "@/modules/auth/service";
import { checkClaims, describeViolations } from "@/modules/content/rules";
import { deleteContent, getContent, saveContent, slugTaken } from "@/modules/content/service";
import { saveImage } from "@/modules/files/service";
import { fail, guard, ok, str, type ActionResult } from "../_lib/result";

// Đường dẫn trùng với trang có sẵn của web thì không dùng được cho trang nội dung
const RESERVED = new Set(["admin", "api", "san-pham", "gio-hang", "thanh-toan", "don-hang", "tra-cuu-don", "minh-bach", "nhat-ky", "phan-anh", "l", "dang-nhap", "sitemap.xml", "robots.txt"]);

const schema = z.object({
  kind: z.enum(["page", "post"]),
  title: z.string().trim().min(2, "Nhập tiêu đề").max(160),
  slug: z.string().trim().max(80),
  excerpt: z.string().trim().max(400),
  body: z.string().max(50_000),
  status: z.enum(["draft", "published"]),
  seoDescription: z.string().trim().max(300),
});

export async function saveContentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("content.write");
    const id = str(formData, "id") || null;
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ");
    const d = parsed.data;
    const slug = slugify(d.slug || d.title);
    if (!slug) return fail("Đường dẫn không hợp lệ");
    if (d.kind === "page" && RESERVED.has(slug)) return fail(`/${slug} là trang có sẵn của web, chọn đường dẫn khác`);
    if (await slugTaken(slug, id ?? undefined)) return fail(`Đường dẫn ${slug} đã được dùng`);

    const violations = [d.title, d.excerpt, d.body, d.seoDescription].flatMap(checkClaims);
    if (violations.length > 0) return fail(`Chưa lưu vì có câu công dụng không được phép:\n${describeViolations(violations)}`);

    let coverFileId = id ? ((await getContent(id))?.coverFileId ?? null) : null;
    if (formData.get("removeCover") === "on") coverFileId = null;
    const cover = formData.get("cover");
    if (cover instanceof File && cover.size > 0) coverFileId = await saveImage(cover, staff.id);

    const savedId = await saveContent(
      id,
      {
        kind: d.kind,
        title: d.title,
        slug,
        excerpt: d.excerpt,
        body: d.body.trim(),
        status: d.status,
        showInFooter: formData.get("showInFooter") === "on",
        seoDescription: d.seoDescription || null,
        coverFileId,
      },
      staff.id,
    );
    revalidatePath(d.kind === "post" ? `/nhat-ky/${slug}` : `/${slug}`);
    if (!id) {
      createdId = savedId;
      return ok("Đã tạo.");
    }
    revalidatePath(`/admin/noi-dung/${id}`);
    return ok(d.status === "published" ? "Đã lưu và đăng." : "Đã lưu bản nháp.");
  });
  if (createdId) redirect(`/admin/noi-dung/${createdId}`);
  return result;
}

export async function deleteContentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const result = await guard(async () => {
    const staff = await requirePermission("content.write");
    await deleteContent(str(formData, "id"), staff.id);
    return ok("Đã xóa");
  });
  if (result.status === "ok") redirect("/admin/noi-dung");
  return result;
}
