import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// draft: chỉ thấy trong quản trị · coming_soon: hiện trên web, nhận đăng ký chờ
// active: đang bán · archived: ngừng bán, ẩn khỏi web
export const productStatus = pgEnum("product_status", ["draft", "coming_soon", "active", "archived"]);

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_status_idx").on(t.status, t.sortOrder)],
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
