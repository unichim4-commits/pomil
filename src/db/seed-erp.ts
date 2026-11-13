// Dữ liệu nền cho 5 phân hệ ERP (00-tong-quan.md mục 11.1): chạy mọi chế độ, kể cả bản chạy thật.
// Chạy nhiều lần được: mỗi nhóm kiểm có rồi thì bỏ qua. Chỉ insert trực tiếp, không qua sổ kho.
// Không import "server-only" để scripts/seed.ts dùng lại được.
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { erpSettingsSchema, ERP_SETTINGS_KEY } from "@/modules/settings/erp-schema";
import * as schema from "./schema";

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export const DEFAULT_WAREHOUSES: { code: string; name: string; kind: (typeof schema.warehouseKind.enumValues)[number] }[] = [
  { code: "RAW", name: "Kho nguyên liệu", kind: "raw" },
  { code: "EXT", name: "Kho tinh dầu và dịch chiết", kind: "extract" },
  { code: "PKG", name: "Kho bao bì", kind: "packaging" },
  { code: "WIP", name: "Kho bán thành phẩm", kind: "wip" },
  { code: "FG", name: "Kho thành phẩm", kind: "finished" },
  { code: "REJ", name: "Kho hàng lỗi, cách ly", kind: "rejected" },
];

export const DEFAULT_LOCATION_CODE = "CHUNG";

export const DEFAULT_CASH_ACCOUNTS: { code: string; name: string; kind: (typeof schema.cashAccountKind.enumValues)[number]; sort: number }[] = [
  { code: "TM", name: "Tiền mặt", kind: "cash", sort: 1 },
  { code: "NH", name: "Ngân hàng", kind: "bank", sort: 2 },
  { code: "COD", name: "Tiền COD chờ đối soát", kind: "clearing", sort: 3 },
];

export const DEFAULT_SALES_CHANNELS: { code: string; name: string; kind: (typeof schema.channelKind.enumValues)[number]; sort: number }[] = [
  { code: "WEB", name: "Website", kind: "own_web", sort: 1 },
  { code: "SHP", name: "Shopee", kind: "marketplace", sort: 2 },
  { code: "TTS", name: "TikTok Shop", kind: "marketplace", sort: 3 },
  { code: "FB", name: "Facebook", kind: "social", sort: 4 },
  { code: "ZL", name: "Zalo", kind: "social", sort: 5 },
  { code: "DL", name: "Đại lý", kind: "dealer", sort: 6 },
  { code: "TT", name: "Bán trực tiếp", kind: "direct", sort: 7 },
];

type PlLine = (typeof schema.plLine.enumValues)[number];
type BudgetGroup = (typeof schema.budgetGroup.enumValues)[number];

// Hạng mục thu chi hệ thống (05-tai-chinh.md mục 5.5)
export const SYSTEM_FINANCE_CATEGORIES: { code: string; name: string; direction: "in" | "out"; plLine: PlLine; budgetGroup: BudgetGroup | null }[] = [
  { code: "THU-BAN-HANG", name: "Thu tiền bán hàng", direction: "in", plLine: "none", budgetGroup: null },
  { code: "THU-CONG-NO", name: "Thu công nợ", direction: "in", plLine: "none", budgetGroup: null },
  { code: "THU-VON-GOP", name: "Vốn góp", direction: "in", plLine: "none", budgetGroup: null },
  { code: "THU-HOAN-UNG", name: "Hoàn ứng", direction: "in", plLine: "none", budgetGroup: null },
  { code: "THU-NCC-HOAN", name: "Nhà cung cấp hoàn tiền", direction: "in", plLine: "none", budgetGroup: null },
  { code: "THU-KHAC", name: "Thu khác", direction: "in", plLine: "other_income", budgetGroup: null },
  { code: "THU-CHENH-LECH", name: "Chênh lệch thừa quỹ", direction: "in", plLine: "other_income", budgetGroup: null },
  { code: "CHI-NGUYEN-LIEU", name: "Nguyên liệu", direction: "out", plLine: "none", budgetGroup: "materials" },
  { code: "CHI-BAO-BI", name: "Bao bì", direction: "out", plLine: "none", budgetGroup: "materials" },
  { code: "CHI-GIA-CONG", name: "Gia công, thuê chưng", direction: "out", plLine: "none", budgetGroup: "production" },
  { code: "CHI-NHAN-CONG-SX", name: "Nhân công sản xuất", direction: "out", plLine: "capitalized", budgetGroup: "production" },
  { code: "CHI-SX-CHUNG", name: "Thuê xưởng, điện nước xưởng, khấu hao, chi phí chung sản xuất", direction: "out", plLine: "capitalized", budgetGroup: "production" },
  { code: "CHI-CHAT-LUONG", name: "Kiểm nghiệm, công bố, hồ sơ chất lượng", direction: "out", plLine: "admin", budgetGroup: "operations" },
  { code: "CHI-VAN-CHUYEN", name: "Vận chuyển, phí thu hộ", direction: "out", plLine: "selling", budgetGroup: "operations" },
  { code: "CHI-PHI-SAN", name: "Phí sàn trả riêng", direction: "out", plLine: "selling", budgetGroup: "operations" },
  { code: "CHI-HOA-HONG", name: "Hoa hồng đại lý", direction: "out", plLine: "selling", budgetGroup: "marketing" },
  { code: "CHI-MARKETING", name: "Marketing, quảng cáo, KOC", direction: "out", plLine: "marketing", budgetGroup: "marketing" },
  { code: "CHI-LUONG", name: "Lương, thù lao", direction: "out", plLine: "admin", budgetGroup: "personnel" },
  { code: "CHI-VAN-HANH", name: "Vận hành, văn phòng, phần mềm, hosting", direction: "out", plLine: "admin", budgetGroup: "operations" },
  { code: "CHI-DAU-TU-TB", name: "Đầu tư thiết bị", direction: "out", plLine: "none", budgetGroup: "investment" },
  { code: "CHI-HOAN-TIEN", name: "Hoàn tiền khách", direction: "out", plLine: "none", budgetGroup: "other" },
  { code: "CHI-TAM-UNG", name: "Tạm ứng", direction: "out", plLine: "none", budgetGroup: "other" },
  { code: "CHI-THUE", name: "Thuế, phí, lệ phí", direction: "out", plLine: "tax", budgetGroup: "other" },
  { code: "CHI-KHAC", name: "Chi khác", direction: "out", plLine: "other_expense", budgetGroup: "other" },
  { code: "CHI-CHENH-LECH", name: "Chênh lệch thiếu quỹ", direction: "out", plLine: "other_expense", budgetGroup: "other" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Trả về số dòng đã thêm (0 khi đã có đủ). Không bật track_inventory, không đổi products.stock.
export async function seedErpMasterData(db: AnyDb): Promise<number> {
  let added = 0;

  // Kho mặc định và vị trí CHUNG
  const existingWh = await db.select({ id: schema.warehouses.id, code: schema.warehouses.code }).from(schema.warehouses);
  const whByCode = new Map(existingWh.map((w) => [w.code, w.id]));
  for (const w of DEFAULT_WAREHOUSES) {
    if (whByCode.has(w.code)) continue;
    const [row] = await db.insert(schema.warehouses).values(w).returning({ id: schema.warehouses.id });
    whByCode.set(w.code, row!.id);
    added++;
  }
  const whIds = [...whByCode.values()];
  const defaults = whIds.length
    ? await db.select({ warehouseId: schema.warehouseLocations.warehouseId }).from(schema.warehouseLocations).where(eq(schema.warehouseLocations.isDefault, true))
    : [];
  const hasDefault = new Set(defaults.map((d) => d.warehouseId));
  for (const id of whIds) {
    if (hasDefault.has(id)) continue;
    await db.insert(schema.warehouseLocations).values({ warehouseId: id, code: DEFAULT_LOCATION_CODE, name: "Vị trí chung", isDefault: true });
    added++;
  }

  // Mỗi sản phẩm một hàng thành phẩm (R-KHO-3): mã = mã sản phẩm, pcs/chai, không IQC
  const productList = await db.select({ id: schema.products.id, code: schema.products.code, name: schema.products.name }).from(schema.products);
  const linked = await db.select({ productId: schema.inventoryItems.productId }).from(schema.inventoryItems).where(eq(schema.inventoryItems.kind, "finished"));
  const linkedIds = new Set(linked.map((l) => l.productId));
  const fgId = whByCode.get("FG") ?? null;
  for (const p of productList) {
    if (linkedIds.has(p.id)) continue;
    await db.insert(schema.inventoryItems).values({
      code: p.code,
      name: p.name,
      kind: "finished",
      baseUom: "pcs",
      displayUom: "chai",
      purchaseUom: "chai",
      requiresIqc: false,
      productId: p.id,
      defaultWarehouseId: fgId,
    });
    added++;
  }

  // Tài khoản tiền
  const accounts = await db.select({ code: schema.cashAccounts.code }).from(schema.cashAccounts);
  const accCodes = new Set(accounts.map((a) => a.code));
  for (const a of DEFAULT_CASH_ACCOUNTS) {
    if (accCodes.has(a.code)) continue;
    await db.insert(schema.cashAccounts).values({ ...a, openingBalance: 0, openingOn: todayIso() });
    added++;
  }

  // Kênh bán: phí 0, ngày tiền về 0 (chủ tự nhập)
  const channels = await db.select({ code: schema.salesChannels.code }).from(schema.salesChannels);
  const chCodes = new Set(channels.map((c) => c.code));
  for (const c of DEFAULT_SALES_CHANNELS) {
    if (chCodes.has(c.code)) continue;
    await db.insert(schema.salesChannels).values(c);
    added++;
  }

  // Hạng mục thu chi hệ thống
  const cats = await db
    .select({ code: schema.financeCategories.code })
    .from(schema.financeCategories)
    .where(inArray(schema.financeCategories.code, SYSTEM_FINANCE_CATEGORIES.map((c) => c.code)));
  const catCodes = new Set(cats.map((c) => c.code));
  let sort = 0;
  for (const c of SYSTEM_FINANCE_CATEGORIES) {
    sort++;
    if (catCodes.has(c.code)) continue;
    await db.insert(schema.financeCategories).values({ ...c, isSystem: true, sort });
    added++;
  }

  // Cài đặt erp mặc định (00 mục 10), chỉ khi chưa có khóa
  const [erp] = await db.select({ key: schema.settings.key }).from(schema.settings).where(eq(schema.settings.key, ERP_SETTINGS_KEY));
  if (!erp) {
    await db.insert(schema.settings).values({ key: ERP_SETTINGS_KEY, value: erpSettingsSchema.parse({}) });
    added++;
  }

  // Hàng thành phẩm lỡ thiếu kho mặc định (DB cũ): gán FG
  if (fgId) {
    await db
      .update(schema.inventoryItems)
      .set({ defaultWarehouseId: fgId })
      .where(and(isNull(schema.inventoryItems.defaultWarehouseId), eq(schema.inventoryItems.kind, "finished")));
  }

  return added;
}
