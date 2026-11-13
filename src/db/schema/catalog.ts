import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseUom } from "./enums";

// draft: chỉ thấy trong quản trị · coming_soon: hiện trên web, nhận đăng ký chờ
// active: đang bán · archived: ngừng bán, ẩn khỏi web
export const productStatus = pgEnum("product_status", ["draft", "coming_soon", "active", "archived"]);

// Giai đoạn phát triển sản phẩm (00 mục 3.2)
export const productDevStage = pgEnum("product_dev_stage", ["developing", "testing", "commercial", "discontinued"]);

// Nhóm sản phẩm; '' = chưa phân loại
export const PRODUCT_CATEGORIES = ["tonic", "shampoo", "conditioner", "hair_serum", "skincare", "essential_oil", "other"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export type ProductIngredient = { name: string; purpose: string };

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Mã sản phẩm dùng trong số lô, ví dụ PST (Pomelo Scalp Tonic)
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    // Dòng mô tả ngắn dưới tên, ví dụ "Nước dưỡng da đầu vỏ bưởi"
    subtitle: text("subtitle").notNull().default(""),
    size: text("size").notNull().default(""),
    // Giá bán lẻ, đơn vị đồng. Giá như nhau ở mọi kênh, không giảm giá thường trực.
    price: integer("price").notNull().default(0),
    stock: integer("stock").notNull().default(0),
    status: productStatus("status").notNull().default("draft"),
    featured: boolean("featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    // Màu chai khi chưa có ảnh: graphite, bone, rind
    tone: text("tone").notNull().default("graphite"),
    description: text("description").notNull().default(""),
    highlights: jsonb("highlights").$type<string[]>().notNull().default([]),
    ingredients: jsonb("ingredients").$type<ProductIngredient[]>().notNull().default([]),
    howToUse: text("how_to_use").notNull().default(""),
    // Điều sản phẩm không làm, in thẳng trên trang sản phẩm
    notDo: jsonb("not_do").$type<string[]>().notNull().default([]),
    imageFileIds: jsonb("image_file_ids").$type<string[]>().notNull().default([]),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    // Mở rộng cho Sản xuất và Kho (00 mục 3.2). Mặc định an toàn để dữ liệu cũ không đổi.
    category: text("category").notNull().default(""),
    devStage: productDevStage("dev_stage").notNull().default("developing"),
    productVersion: text("product_version").notNull().default("v1"),
    // Dung tích/khối lượng tịnh theo đơn vị cơ sở (100 ml = 100.000 ul)
    netQty: bigint("net_qty", { mode: "number" }),
    netUom: baseUom("net_uom"),
    packSpec: text("pack_spec").notNull().default(""),
    unitsPerCarton: integer("units_per_carton"),
    // GTIN-13
    barcode: text("barcode"),
    // Bật: products.stock do Kho tính (R-KHO-23). Tắt: hành xử như cũ.
    trackInventory: boolean("track_inventory").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("products_status_idx").on(t.status, t.sortOrder),
    uniqueIndex("products_barcode_uq").on(t.barcode).where(sql`${t.barcode} is not null`),
    check("products_net_qty_uom_chk", sql`(${t.netQty} is null) = (${t.netUom} is null)`),
    check("products_net_uom_chk", sql`${t.netUom} is null or ${t.netUom} <> 'pcs'`),
    check("products_units_per_carton_chk", sql`${t.unitsPerCarton} is null or ${t.unitsPerCarton} > 0`),
  ],
);

export const contentKind = pgEnum("content_kind", ["page", "post"]);
export const contentStatus = pgEnum("content_status", ["draft", "published"]);

// Trang tĩnh (câu chuyện, chính sách, hỏi đáp) và bài viết (nhật ký, da đầu 101)
export const contentPages = pgTable(
  "content_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: contentKind("kind").notNull().default("page"),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    // Markdown rút gọn: tiêu đề ##, danh sách -, **đậm**, [liên kết](url)
    body: text("body").notNull().default(""),
    coverFileId: uuid("cover_file_id"),
    status: contentStatus("status").notNull().default("draft"),
    // Hiện ở chân trang (chỉ áp cho kind = page)
    showInFooter: boolean("show_in_footer").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    seoDescription: text("seo_description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("content_kind_status_idx").on(t.kind, t.status, t.publishedAt)],
);

// Cài đặt cửa hàng dạng khóa → giá trị. Kiểu và mặc định ở src/modules/settings.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
