// Nhãn tiếng Việt cho màn hình Kho (không phải file "use server": hằng số để ở đây)
import type { BadgeTone } from "../../_components/ui";
import type { StockMoveType } from "@/modules/inventory/rules";

export const ITEM_KIND_LABEL: Record<string, string> = {
  raw_material: "Nguyên liệu",
  extract: "Tinh dầu, dịch chiết",
  packaging: "Bao bì",
  wip: "Bán thành phẩm",
  finished: "Thành phẩm",
  other: "Khác",
};

export const WAREHOUSE_KIND_LABEL: Record<string, string> = {
  raw: "Nguyên liệu",
  extract: "Tinh dầu, dịch chiết",
  packaging: "Bao bì",
  wip: "Bán thành phẩm",
  finished: "Thành phẩm",
  rejected: "Hàng lỗi, cách ly",
};

export const SUPPLIER_KIND_LABEL: Record<string, string> = {
  material: "Nguyên liệu",
  packaging: "Bao bì",
  factory: "Nhà máy gia công",
  farm: "Vườn bưởi",
  service: "Dịch vụ (lò chưng thuê…)",
  other: "Khác",
};

export const RECEIPT_KIND_LABEL: Record<string, string> = {
  purchase: "Nhập mua",
  production: "Thành phẩm từ sản xuất",
  extraction: "Dịch chiết từ mẻ chiết",
  customer_return: "Khách trả",
  production_return: "Trả NVL thừa",
  opening: "Tồn đầu kỳ",
  other: "Nhập khác",
};

// Loại người dùng tự lập ở /admin/kho/nhap/moi (production, extraction, customer_return, production_return do phân hệ khác tạo)
export const MANUAL_RECEIPT_KINDS = ["purchase", "opening", "other"] as const;

export const ISSUE_KIND_LABEL: Record<string, string> = {
  production: "Sản xuất",
  extraction: "Chiết xuất",
  sample: "Mẫu tặng, KOC",
  qc_sample: "Mẫu lưu, gửi kiểm nghiệm",
  scrap: "Hủy (hỏng, hết hạn)",
  research: "Nghiên cứu",
  supplier_return: "Trả nhà cung cấp",
  other: "Xuất khác",
};

export const MANUAL_ISSUE_KINDS = ["sample", "qc_sample", "scrap", "research", "supplier_return", "other"] as const;

export const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  pending_approval: "Chờ duyệt",
  posted: "Đã ghi sổ",
  cancelled: "Đã hủy",
};

export const DOC_STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  pending_approval: "amber",
  posted: "green",
  cancelled: "red",
};

// Trạng thái lô: vật tư (qc_status) và thành phẩm (lots.release_status) chung một bảng nhãn
export const LOT_STATUS_LABEL: Record<string, string> = {
  pending: "Chờ kiểm",
  released: "Đạt",
  rejected: "Không đạt",
  on_hold: "Đang giữ",
  quarantine: "Cách ly",
  recalled: "Thu hồi",
};

export const LOT_STATUS_TONE: Record<string, BadgeTone> = {
  pending: "amber",
  quarantine: "amber",
  released: "green",
  rejected: "red",
  on_hold: "red",
  recalled: "red",
};

export const MOVE_TYPE_LABEL: Record<StockMoveType, string> = {
  opening: "Tồn đầu kỳ",
  purchase_receipt: "Nhập mua",
  production_receipt: "Nhập sản xuất",
  extraction_receipt: "Nhập dịch chiết",
  return_receipt: "Nhập hàng trả",
  production_return: "Trả NVL thừa",
  other_receipt: "Nhập khác",
  production_issue: "Xuất sản xuất",
  extraction_issue: "Xuất chiết",
  sale_issue: "Xuất bán",
  sample_issue: "Xuất mẫu",
  qc_sample_issue: "Xuất mẫu lưu",
  research_issue: "Xuất nghiên cứu",
  scrap_issue: "Xuất hủy",
  supplier_return: "Trả NCC",
  other_issue: "Xuất khác",
  transfer_out: "Chuyển đi",
  transfer_in: "Chuyển đến",
  count_adjust: "Chênh lệch kiểm kê",
  reversal: "Đảo",
};

export const PAYMENT_MODE_LABEL: Record<string, string> = {
  payable: "Ghi công nợ",
  paid_now: "Trả tiền ngay",
  none: "Không ghi tiền",
};

// Đơn vị cho ô chọn
export const UOMS_BY_BASE: Record<string, string[]> = {
  mg: ["kg", "g", "mg"],
  ul: ["l", "ml"],
  pcs: ["cái", "chai", "lọ", "hộp", "nắp", "nhãn", "cuộn", "tờ", "gói"],
};

export const BASE_UOM_LABEL: Record<string, string> = { mg: "Khối lượng (mg)", ul: "Thể tích (µl)", pcs: "Đếm (cái)" };
