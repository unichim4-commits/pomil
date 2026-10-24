import type { StoreSettings } from "./schema";

// Dòng "Dự kiến mở bán" chỉ đúng khi cửa hàng đang tắt nhận đơn. Đã bật bán thì ẩn dù chủ shop
// quên xóa ghi chú, để sản phẩm "sắp ra mắt" khác (ví dụ dầu gội đang hỏi ý kiến) không mang nhầm ngày mở bán.
export function launchNoteToShow(settings: Pick<StoreSettings, "salesOpen" | "launchNote">): string | null {
  if (settings.salesOpen) return null;
  const note = settings.launchNote.trim();
  return note === "" ? null : note;
}
