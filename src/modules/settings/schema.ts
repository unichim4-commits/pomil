import { z } from "zod";

// Cài đặt cửa hàng. Mặc định lấy từ kế hoạch (mục 4.3, 4.6): giá như nhau mọi kênh,
// ưu đãi bằng phí giao và quà, không giảm giá thường trực. Số tiền là đề xuất, sửa trong /admin/cai-dat.
export const storeSettingsSchema = z.object({
  storeName: z.string().trim().min(1).max(60).default("Pomil"),
  tagline: z.string().trim().max(160).default("Chăm da đầu trước, tóc khỏe theo sau."),
  hotline: z.string().trim().max(20).default(""),
  zalo: z.string().trim().max(20).default(""),
  email: z.string().trim().max(120).default(""),
  address: z.string().trim().max(200).default(""),
  businessInfo: z.string().trim().max(300).default(""),
  tiktok: z.string().trim().max(200).default(""),
  instagram: z.string().trim().max(200).default(""),
  facebook: z.string().trim().max(200).default(""),
  shopee: z.string().trim().max(200).default(""),
  // Dòng thông báo đầu trang, để trống thì ẩn
  announcement: z.string().trim().max(160).default(""),
  // Tắt: nút mua đổi thành "Giữ chỗ khi mở bán" cho mọi sản phẩm.
  // Mặc định TẮT: DB mới không nhận đơn cho tới khi chủ cửa hàng tự bật trong /admin/cai-dat.
  salesOpen: z.boolean().default(false),
  // Dòng "dự kiến mở bán": chỉ hiện khi đang tắt bán (launchNoteToShow trong rules.ts)
  launchNote: z.string().trim().max(120).default(""),
  shippingFlatFee: z.number().int().min(0).max(1_000_000).default(25_000),
  shippingFreeThreshold: z.number().int().min(0).max(100_000_000).default(450_000),
  shippingNote: z.string().trim().max(200).default("Giao toàn quốc trong 2–5 ngày làm việc."),
  maxQtyPerItem: z.number().int().min(1).max(50).default(5),
  codEnabled: z.boolean().default(true),
  bankTransferEnabled: z.boolean().default(true),
  bankBin: z.string().trim().max(6).default(""),
  bankName: z.string().trim().max(80).default(""),
  bankAccountNo: z.string().trim().max(30).default(""),
  bankAccountName: z.string().trim().max(80).default(""),
  // Thông báo cho chủ cửa hàng. Khóa API nằm trong biến môi trường, không lưu ở đây.
  notifyEmails: z.string().trim().max(500).default(""),
  notifyZaloUserIds: z.string().trim().max(500).default(""),
  notifyOnOrder: z.boolean().default(true),
  notifyOnComplaint: z.boolean().default(true),
});

export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const SETTINGS_KEY = "store";

export function parseSettings(raw: unknown): StoreSettings {
  const result = storeSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : storeSettingsSchema.parse({});
}
