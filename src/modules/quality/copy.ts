import { toLocalMobile, toTelNumber } from "@/lib/phone";
// Câu chữ cho khách ở trang lô và trang lỗi. Có test chạy qua checkClaims (tests/lot-lookup.test.ts).

export const LOT_FORMAT_HINT = "PST-YYMMDD-NN";

export const LOT_COPY = {
  eyebrow: "Truy xuất lô",
  badFormatTitle: "Số lô này chưa đúng dạng",
  badFormat: "Số lô có dạng PST-YYMMDD-NN, in dưới đáy chai.",
  missingTitle: "Mình chưa thấy lô này",
  missingBody: "Số lô in dưới đáy chai, dạng PST-YYMMDD-NN. Bạn gõ lại giúp mình nhé. Nếu chắc đã nhập đúng mà vẫn không thấy, báo cho Pomil để mình kiểm tra.",
  pendingTitle: "Lô này chưa mở trang",
  // Dùng chung cho lô đang cách ly và lô đã bán nhưng chưa bật công khai: không khẳng định lý do.
  pendingBody: "Lô này chưa có trang công khai. Thường là vì lô đang chờ kết quả kiểm nghiệm. Nếu bạn đã mua chai có số lô này, nhắn mình để mình kiểm tra ngay.",
  pendingHint: "Nếu bạn đang cầm chai có số lô này và thấy da đầu khó chịu, hãy ngừng dùng và báo cho Pomil.",
  retryLabel: "Tra lại số lô",
  retryButton: "Tra",
  complaintLink: "Báo vấn đề cho Pomil",
  homeLink: "Về trang chủ",
} as const;

// Form phản ánh (/phan-anh): câu lỗi khi số lô gõ sai dạng
export const COMPLAINT_LOT_FORMAT_ERROR = "Số lô có dạng PST-YYMMDD-NN, in dưới đáy chai. Không thấy số lô thì để trống.";

export const NOT_FOUND_COPY = {
  eyebrow: "Không tìm thấy",
  title: "Mình chưa tìm thấy trang này.",
  body: "Có thể đường dẫn đã đổi hoặc bị gõ nhầm. Bạn thử một trong các lối dưới đây nhé.",
  links: [
    { href: "/", label: "Về trang chủ" },
    { href: "/san-pham", label: "Xem sản phẩm" },
    { href: "/tra-cuu-don", label: "Tra cứu đơn hàng" },
    { href: "/minh-bach", label: "Tra số lô" },
  ],
} as const;

// Form phản ánh (D-3, T-9). Có test qua checkClaims (tests/complaint-form.test.ts).
export const COMPLAINT_LOT_HINT = "In dưới đáy chai. Không thấy thì để trống, mình sẽ hỏi lại.";
export const COMPLAINT_NEED_CONTACT_ERROR = "Không có số lô hay mã mẫu thử thì để lại số điện thoại hoặc Zalo, để mình gọi hỏi thêm nhé.";
export const COMPLAINT_PHONE_ERROR = "Số điện thoại chưa đúng. Bạn gõ đủ 10 số, bắt đầu bằng 0 nhé.";
export const COMPLAINT_INTRO =
  "Nếu da đầu bạn ngứa, đỏ, rát hoặc khó chịu sau khi dùng, hãy ngừng dùng và cho Pomil biết. Bạn để lại số điện thoại hoặc Zalo thì mình sẽ liên hệ lại trong vòng 24 giờ.";
export const COMPLAINT_PHONE_LABEL = "Số điện thoại hoặc Zalo";
export const COMPLAINT_PHONE_HINT = "Bắt buộc nếu bạn không có số lô hay mã mẫu thử. Mình chỉ dùng số này để hỏi về phản ánh của bạn.";
export const COMPLAINT_SAMPLE_LABEL = "Mã mẫu thử (nếu có)";
export const COMPLAINT_THANKS_TITLE = "Pomil đã nhận phản ánh của bạn.";
const COMPLAINT_SAFETY = "Nếu triệu chứng nặng hoặc kéo dài, hãy đến cơ sở y tế.";

// Câu cảm ơn trả về từng phần để hiện link Zalo/hotline. Số không hợp lệ thì giữ chữ thường.
export type ThanksPart = { text: string; href?: string; external?: boolean };

export function complaintThanksText(parts: ThanksPart[]): string {
  return parts.map((p) => p.text).join("");
}

// Có số thì hứa liên hệ; không có số thì nói rõ mình chưa liên hệ lại được và mời nhắn.
export function complaintThanksBody(hasContact: boolean, shop: { zalo?: string; hotline?: string } = {}): ThanksPart[] {
  if (hasContact) return [{ text: `Pomil sẽ liên hệ trong vòng 24 giờ. Trong lúc chờ, bạn nên ngừng dùng sản phẩm. ${COMPLAINT_SAFETY}` }];
  const zalo = shop.zalo?.trim();
  const hotline = shop.hotline?.trim();
  const head = "Bạn chưa để lại số nên mình chưa liên hệ lại được. ";
  const tail = ` Bạn nên ngừng dùng sản phẩm. ${COMPLAINT_SAFETY}`;
  if (zalo) {
    const local = toLocalMobile(zalo);
    return [
      { text: `${head}Cần mình gọi lại thì ` },
      { text: `nhắn Zalo ${zalo}`, href: local ? `https://zalo.me/${local}` : undefined, external: true },
      { text: ` cho Pomil nhé.${tail}` },
    ];
  }
  if (hotline) {
    const tel = toTelNumber(hotline);
    return [
      { text: `${head}Cần mình gọi lại thì ` },
      { text: `gọi ${hotline}`, href: tel ? `tel:${tel}` : undefined },
      { text: ` hoặc nhắn Zalo cho Pomil nhé.${tail}` },
    ];
  }
  return [{ text: `${head}Cần mình gọi lại thì nhắn Zalo cho Pomil nhé.${tail}` }];
}
