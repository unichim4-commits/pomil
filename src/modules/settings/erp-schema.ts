import { z } from "zod";

// Cài đặt 5 phân hệ ERP, khóa "erp" trong bảng settings (00-tong-quan.md mục 10).
// Mặc định là giả định, chủ sửa ở /admin/cai-dat.
export const erpSettingsSchema = z.object({
  // Cảnh báo lô sắp hết hạn trước N ngày (R-KHO-21)
  expiryWarnDays: z.number().int().min(0).max(3650).default(90),
  // Hàng không có biến động trong N ngày là tồn lâu (R-KHO-22)
  slowMovingDays: z.number().int().min(0).max(3650).default(90),
  // Xuất NVL vượt định mức quá N bp thì cảnh báo (R-SX-18)
  overIssueWarnBp: z.number().int().min(0).max(10_000).default(500),
  // Ngân sách dùng tới N bp thì cảnh báo (R-TC-16)
  budgetWarnBp: z.number().int().min(0).max(10_000).default(8000),
  // Công nợ sắp đến hạn trong N ngày (R-TC-14)
  debtDueSoonDays: z.number().int().min(0).max(365).default(7),
  // Tổng tiền dưới mức này thì cảnh báo thiếu tiền (R-TC-26)
  minCashAlert: z.number().int().min(0).max(100_000_000_000).default(0),
  // Số tuần dự báo dòng tiền (R-TC-26)
  forecastWeeks: z.number().int().min(1).max(52).default(8),
  // Chiết khấu tay tối đa không cần sales.pricing (R-BH-6)
  manualDiscountMaxBp: z.number().int().min(0).max(10_000).default(1000),
  // Số ngày sau giao còn được đổi trả; 0 = không giới hạn (R-BH-19)
  returnWindowDays: z.number().int().min(0).max(3650).default(0),
  // Lần cuối chạy refreshExpiredStock, ISO (R-KHO-27)
  lastExpiryRefreshAt: z.string().nullable().default(null),
});

export type ErpSettings = z.infer<typeof erpSettingsSchema>;

export const ERP_SETTINGS_KEY = "erp";

export function parseErpSettings(raw: unknown): ErpSettings {
  const result = erpSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : erpSettingsSchema.parse({});
}
