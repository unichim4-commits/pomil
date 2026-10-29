// Soạn thông báo cho chủ cửa hàng và chọn người nhận. Hàm thuần để test được.
import { displayPhone, formatVnd } from "@/lib/format";

export type NotifyEvent =
  | {
      kind: "order_created";
      orderId: string;
      code: string;
      total: number;
      items: { name: string; quantity: number }[];
      recipientName: string;
      phoneE164: string;
      province: string;
      paymentMethod: "cod" | "bank_transfer";
      customerNote: string | null;
    }
  | {
      kind: "complaint_created";
      complaintId: string;
      lotNo: string | null;
      sampleCode: string | null;
      severity: "mild" | "moderate" | "severe";
      symptoms: string;
      contactPhone: string | null;
      lotHeld: boolean;
    }
  | {
      kind: "review_created";
      reviewId: string;
      productName: string;
      rating: number;
      // Khách chọn "Ngứa hoặc châm chích"
      irritation: boolean;
      comment: string;
    }
  | { kind: "test"; requestedBy: string };

export type NotifyPrefs = {
  notifyEmails: string;
  notifyZaloUserIds: string;
  notifyOnOrder: boolean;
  notifyOnComplaint: boolean;
};

export type Message = { subject: string; text: string; urgent: boolean };

const SEVERITY = { mild: "nhẹ", moderate: "vừa", severe: "NẶNG" } as const;

export function eventEntityId(e: NotifyEvent): string | null {
  return e.kind === "order_created" ? e.orderId : e.kind === "complaint_created" ? e.complaintId : e.kind === "review_created" ? e.reviewId : null;
}

// Tin ngắn, đọc được trên màn hình khóa điện thoại: dòng đầu là điều cần làm.
export function composeMessage(e: NotifyEvent, siteUrl: string): Message {
  const base = siteUrl.replace(/\/$/, "");
  switch (e.kind) {
    case "order_created": {
      const qty = e.items.reduce((s, i) => s + i.quantity, 0);
      const lines = [
        `Đơn mới ${e.code} · ${formatVnd(e.total)} · ${qty} chai`,
        ...e.items.map((i) => `- ${i.name} × ${i.quantity}`),
        `Khách: ${e.recipientName} · ${displayPhone(e.phoneE164)} · ${e.province}`,
        `Thanh toán: ${e.paymentMethod === "cod" ? "thu tiền khi giao (COD)" : "chuyển khoản, chờ tiền về"}`,
        ...(e.customerNote ? [`Khách ghi: ${e.customerNote}`] : []),
        `Xác nhận đơn: ${base}/admin/don-hang/${e.orderId}`,
      ];
      return { subject: `[Pomil] Đơn mới ${e.code} · ${formatVnd(e.total)}`, text: lines.join("\n"), urgent: false };
    }
    case "complaint_created": {
      const urgent = e.severity === "severe" || e.lotHeld;
      const where = e.lotNo ? `lô ${e.lotNo}` : e.sampleCode ? `mẫu thử ${e.sampleCode}` : "chưa rõ lô";
      const lines = [
        `${urgent ? "KHẨN · " : ""}Phản ánh kích ứng mức ${SEVERITY[e.severity]} · ${where}`,
        ...(e.lotHeld ? [`Lô ${e.lotNo} đã TỰ CHUYỂN SANG GIỮ LẠI (đủ ngưỡng 3 phản ánh trong 7 ngày). Ngừng gán lô này cho đơn mới.`] : []),
        `Khách kể: ${e.symptoms.slice(0, 400)}`,
        e.contactPhone ? `Liên hệ khách: ${e.contactPhone}` : "Khách không để lại số liên hệ",
        "Cần phản hồi khách trong 24 giờ.",
        `Xử lý: ${base}/admin/phan-anh`,
      ];
      return {
        subject: `[Pomil]${urgent ? " KHẨN ·" : ""} Phản ánh ${SEVERITY[e.severity]} · ${where}`,
        text: lines.join("\n"),
        urgent,
      };
    }
    case "review_created": {
      const lines = [
        `Đánh giá ${e.rating}/5 · ${e.productName}${e.irritation ? " · khách báo NGỨA hoặc CHÂM CHÍCH" : ""}`,
        ...(e.comment ? [`Khách viết: ${e.comment.slice(0, 400)}`] : []),
        e.irritation ? "Nhắn hỏi thăm khách và mời gửi phản ánh kèm số lô nếu cần." : "Đọc và ghi lại điều cần sửa.",
        `Xem: ${base}/admin/danh-gia`,
      ];
      return { subject: `[Pomil] Đánh giá ${e.rating}/5 · ${e.productName}`, text: lines.join("\n"), urgent: e.irritation };
    }
    case "test":
      return {
        subject: "[Pomil] Tin thử thông báo",
        text: `Tin thử do ${e.requestedBy} gửi từ trang quản trị. Nhận được tin này nghĩa là kênh đã thông.\n${base}/admin/thong-bao`,
        urgent: false,
      };
  }
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// "a@x.vn, b@x.vn; a@x.vn" → ["a@x.vn", "b@x.vn"]
export function parseEmails(raw: string): string[] {
  const out = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (EMAIL_RE.test(email)) out.add(email);
  }
  return [...out].slice(0, 10);
}

// user_id Zalo của người đã quan tâm OA: chuỗi số
export function parseZaloIds(raw: string): string[] {
  const out = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) if (/^\d{5,30}$/.test(part.trim())) out.add(part.trim());
  return [...out].slice(0, 10);
}

export function invalidRecipients(raw: string, kind: "email" | "zalo"): string[] {
  const valid = kind === "email" ? parseEmails(raw) : parseZaloIds(raw);
  return raw
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter((p) => p && !valid.includes(kind === "email" ? p.toLowerCase() : p));
}

// Tắt thông báo phản ánh vẫn gửi tin khẩn (mức nặng hoặc lô bị giữ): đó là việc an toàn, không phải tiện ích.
export function recipientsFor(e: NotifyEvent, prefs: NotifyPrefs, fallbackEmail?: string | null): { emails: string[]; zaloIds: string[] } {
  const emails = parseEmails(prefs.notifyEmails);
  if (emails.length === 0 && fallbackEmail) emails.push(...parseEmails(fallbackEmail));
  const all = { emails, zaloIds: parseZaloIds(prefs.notifyZaloUserIds) };
  const none = { emails: [], zaloIds: [] };

  if (e.kind === "order_created") return prefs.notifyOnOrder ? all : none;
  if (e.kind === "complaint_created") {
    const urgent = e.severity === "severe" || e.lotHeld;
    return prefs.notifyOnComplaint || urgent ? all : none;
  }
  // Chỉ báo đánh giá cần làm gì ngay: điểm thấp hoặc khách báo ngứa. Đánh giá tốt xem trong trang quản trị.
  if (e.kind === "review_created") return reviewNeedsAttention(e) && (prefs.notifyOnComplaint || e.irritation) ? all : none;
  return all;
}

export function reviewNeedsAttention(e: { rating: number; irritation: boolean }): boolean {
  return e.rating <= 2 || e.irritation;
}

// Zalo giới hạn độ dài tin văn bản; cắt gọn ở 2000 ký tự cho chắc.
export function zaloText(m: Message): string {
  return m.text.length > 2000 ? `${m.text.slice(0, 1990)}…` : m.text;
}

// Mã lỗi Zalo khi access token hết hạn hoặc không hợp lệ: làm mới token rồi gửi lại một lần
export const ZALO_TOKEN_ERRORS: readonly number[] = [-216, -124, -14005];

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Email dạng HTML đơn giản: giữ xuống dòng, biến địa chỉ quản trị thành liên kết
export function emailHtml(m: Message): string {
  const body = escapeHtml(m.text)
    .split("\n")
    .map((line) => line.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>'))
    .join("<br>");
  const color = m.urgent ? "#9a3b2c" : "#1e2420";
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e2420;max-width:560px"><p style="margin:0 0 12px;font-size:12px;letter-spacing:2px;color:${color}">POMIL OS</p>${body}</div>`;
}
