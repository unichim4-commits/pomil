"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { slugify } from "@/lib/format";
import { requirePermission } from "@/modules/auth/service";
import { initialStockProblem, parseStockAdjustment, parseStockDelta, stockReasonProblem } from "@/modules/catalog/rules";
import { adjustStock, createProduct, findConflicts, getProduct, updateProduct } from "@/modules/catalog/service";
import { checkClaims, describeViolations } from "@/modules/content/rules";
import { saveImage } from "@/modules/files/service";
import { fail, guard, ok, str, type ActionResult } from "../_lib/result";

const schema = z.object({
  name: z.string().trim().min(2, "Nhập tên sản phẩm").max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/, "Mã sản phẩm 2–5 chữ cái in hoa, dùng trong số lô (ví dụ PST)"),
  slug: z.string().trim().max(80),
  subtitle: z.string().trim().max(160),
  size: z.string().trim().max(40),
  price: z.coerce.number().int("Giá là số nguyên").min(0).max(100_000_000),
  status: z.enum(["draft", "coming_soon", "active", "archived"]),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  tone: z.enum(["graphite", "bone", "rind"]),
  description: z.string().max(20_000),
  highlights: z.string().max(4000),
  ingredients: z.string().max(10_000),
  howToUse: z.string().max(4000),
  notDo: z.string().max(4000),
  seoTitle: z.string().trim().max(120),
  seoDescription: z.string().trim().max(300),
});

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

// Mỗi dòng "Tên INCI | công dụng"
function parseIngredients(text: string) {
  return lines(text).map((line) => {
    const [name, ...rest] = line.split("|");
    return { name: (name ?? "").trim(), purpose: rest.join("|").trim() };
  });
}

export async function saveProductAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("products.write");
    const id = str(formData, "id") || null;
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ");
    const d = parsed.data;
    const slug = slugify(d.slug || d.name);
    if (!slug) return fail("Đường dẫn không hợp lệ");

    const highlights = lines(d.highlights);
    const notDo = lines(d.notDo);
    const ingredients = parseIngredients(d.ingredients);
    if (ingredients.some((i) => !i.name)) return fail("Mỗi dòng thành phần cần có tên trước dấu |");

    // Bộ lọc công dụng (T-1): chặn câu hứa như thuốc trên mọi chữ khách nhìn thấy
    const violations = [d.name, d.subtitle, d.description, d.howToUse, d.seoTitle, d.seoDescription, ...highlights, ...notDo, ...ingredients.map((i) => i.purpose)].flatMap(
      checkClaims,
    );
    if (violations.length > 0) return fail(`Chưa lưu vì có câu công dụng không được phép:\n${describeViolations(violations)}`);

    const conflicts = await findConflicts({ slug, code: d.code }, id ?? undefined);
    if (conflicts.code) return fail(`Mã ${d.code} đã dùng cho sản phẩm khác`);
    if (conflicts.slug) return fail(`Đường dẫn /${slug} đã dùng cho sản phẩm khác`);

    // Ảnh: giữ ảnh cũ còn tích, thêm ảnh mới tải lên; ảnh đầu tiên là ảnh chính
    const existing = id ? ((await getProduct(id))?.imageFileIds ?? []) : [];
    const keep = formData.getAll("keepImage").map(String);
    const mainImage = str(formData, "mainImage");
    let images = existing.filter((x) => keep.includes(x));
    if (mainImage && images.includes(mainImage)) images = [mainImage, ...images.filter((x) => x !== mainImage)];
    for (const file of formData.getAll("images")) {
      if (file instanceof File && file.size > 0) images.push(await saveImage(file, staff.id));
    }

    const values = {
      name: d.name,
      code: d.code,
      slug,
      subtitle: d.subtitle,
      size: d.size,
      price: d.price,
      status: d.status,
      featured: formData.get("featured") === "on",
      sortOrder: d.sortOrder,
      tone: d.tone,
      description: d.description.trim(),
      highlights,
      ingredients,
      howToUse: d.howToUse.trim(),
      notDo,
      imageFileIds: images.slice(0, 8),
      seoTitle: d.seoTitle || null,
      seoDescription: d.seoDescription || null,
    };

    // Tồn kho không đi theo form sửa (tránh ghi đè số đã bán trong lúc mở form).
    // Sửa tồn dùng "Điều chỉnh tồn kho" (adjustStockAction). Chỉ sản phẩm mới mới nhập tồn ban đầu.
    if (id) {
      await updateProduct(id, values, staff.id);
      revalidatePath(`/admin/san-pham/${id}`);
      revalidatePath(`/san-pham/${slug}`);
      return ok("Đã lưu sản phẩm.");
    }
    const initialStock = Number(str(formData, "initialStock") || "0");
    const stockProblem = initialStockProblem(initialStock);
    if (stockProblem) return fail(stockProblem);
    createdId = await createProduct({ ...values, stock: initialStock }, staff.id);
    return ok("Đã tạo sản phẩm.");
  });
  if (createdId) redirect(`/admin/san-pham/${createdId}?moi=1`);
  return result;
}

// Điều chỉnh tồn kho: chọn "Nhập thêm"/"Bớt đi" + số chai dương + lý do, không ghi đè số tồn.
// Vẫn nhận ô "delta" có dấu (+50/-2) cho trang quản trị cũ còn mở trong lúc deploy.
export async function adjustStockAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("products.write");
    const id = str(formData, "id");
    const parsed = formData.has("delta") && !formData.has("amount") ? parseStockDelta(str(formData, "delta")) : parseStockAdjustment(str(formData, "direction"), str(formData, "amount"));
    if (!parsed.ok) return fail(parsed.message);
    const reason = str(formData, "reason");
    const reasonProblem = stockReasonProblem(reason);
    if (reasonProblem) return fail(reasonProblem);
    const result = await adjustStock(id, parsed.delta, reason, staff.id);
    if (!result.ok) return fail(result.message);
    revalidatePath("/admin/san-pham");
    revalidatePath(`/admin/san-pham/${id}`);
    return ok(`Đã ${parsed.delta > 0 ? "nhập thêm" : "bớt"} ${Math.abs(parsed.delta)} chai, còn ${result.stock} chai.`);
  });
}
