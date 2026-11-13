// Kiểu cảnh báo chung cho 5 phân hệ (00-tong-quan.md mục 8.7). Trang Tổng quan gọi getAlerts của từng module,
// bắt lỗi từng cái để một phân hệ hỏng không làm hỏng trang.
export type AdminAlert = {
  module: "kho" | "san-xuat" | "chat-luong" | "ban-hang" | "tai-chinh";
  level: "info" | "warn" | "danger";
  text: string;
  href: string;
  count?: number;
};
