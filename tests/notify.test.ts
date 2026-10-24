import { describe, expect, it } from "vitest";
import { composeMessage, emailHtml, invalidRecipients, parseEmails, parseZaloIds, recipientsFor, type NotifyEvent, type NotifyPrefs } from "@/modules/notify/rules";
import { checkClaims } from "@/modules/content/rules";

const order: NotifyEvent = {
  kind: "order_created",
  orderId: "11111111-1111-4111-8111-111111111111",
  code: "WEB-2711-0007",
  total: 458_000,
  items: [{ name: "Pomelo Scalp Tonic", quantity: 2 }],
  recipientName: "Lan",
  phoneE164: "84901234567",
  province: "Hà Nội",
  paymentMethod: "bank_transfer",
  customerNote: "Giao giờ hành chính",
};

const complaint = (over: Partial<Extract<NotifyEvent, { kind: "complaint_created" }>> = {}): NotifyEvent => ({
  kind: "complaint_created",
  complaintId: "22222222-2222-4222-8222-222222222222",
  lotNo: "PST-271101-01",
  sampleCode: null,
  severity: "mild",
  symptoms: "Hơi ngứa sau 2 ngày",
  contactPhone: "0901234567",
  lotHeld: false,
  ...over,
});

const prefs: NotifyPrefs = { notifyEmails: "chu@pomil.vn", notifyZaloUserIds: "1234567890123", notifyOnOrder: true, notifyOnComplaint: true };

describe("compose", () => {
  it("complaint without lot or sample code (D-3) still reads well and shows the phone", () => {
    const m = composeMessage(complaint({ lotNo: null, sampleCode: null }), "https://pomil.vn");
    expect(m.text).toContain("chưa rõ lô");
    expect(m.text).toContain("Liên hệ khách: 0901234567");
    expect(m.text).not.toContain("null");
  });
  it("order message leads with code, total and admin link", () => {
    const m = composeMessage(order, "https://pomil.vn/");
    expect(m.subject).toBe("[Pomil] Đơn mới WEB-2711-0007 · 458.000đ");
    expect(m.text.split("\n")[0]).toBe("Đơn mới WEB-2711-0007 · 458.000đ · 2 chai");
    expect(m.text).toContain("0901 234 567");
    expect(m.text).toContain("chuyển khoản, chờ tiền về");
    expect(m.text).toContain("https://pomil.vn/admin/don-hang/11111111-1111-4111-8111-111111111111");
    expect(m.urgent).toBe(false);
  });

  it("severe complaint or held lot is urgent", () => {
    expect(composeMessage(complaint(), "x").urgent).toBe(false);
    const severe = composeMessage(complaint({ severity: "severe" }), "x");
    expect(severe.urgent).toBe(true);
    expect(severe.subject).toContain("KHẨN");
    const held = composeMessage(complaint({ lotHeld: true }), "x");
    expect(held.urgent).toBe(true);
    expect(held.text).toContain("TỰ CHUYỂN SANG GIỮ LẠI");
  });

  it("system text passes the claim filter", () => {
    for (const e of [order, complaint({ lotHeld: true, severity: "severe" }), { kind: "test", requestedBy: "a" } as const]) {
      const m = composeMessage(e, "https://pomil.vn");
      expect(checkClaims(m.subject + "\n" + m.text.replace(/Khách kể:.*$/m, ""))).toEqual([]);
    }
  });

  it("email html escapes customer text", () => {
    const html = emailHtml(composeMessage({ ...order, customerNote: "<script>x</script>" }, "https://pomil.vn"));
    expect(html).not.toContain("<script>");
    expect(html).toContain('<a href="https://pomil.vn/admin/don-hang/');
  });
});

describe("recipients", () => {
  it("parses and dedupes lists", () => {
    expect(parseEmails("A@pomil.vn, b@pomil.vn; a@pomil.vn sai")).toEqual(["a@pomil.vn", "b@pomil.vn"]);
    expect(parseZaloIds("123456789, abc 123456789\n98765")).toEqual(["123456789", "98765"]);
    expect(invalidRecipients("a@pomil.vn, sai", "email")).toEqual(["sai"]);
  });

  it("respects toggles but never drops urgent complaints", () => {
    expect(recipientsFor(order, prefs)).toEqual({ emails: ["chu@pomil.vn"], zaloIds: ["1234567890123"] });
    expect(recipientsFor(order, { ...prefs, notifyOnOrder: false })).toEqual({ emails: [], zaloIds: [] });
    const off = { ...prefs, notifyOnComplaint: false };
    expect(recipientsFor(complaint(), off).emails).toEqual([]);
    expect(recipientsFor(complaint({ severity: "severe" }), off).emails).toEqual(["chu@pomil.vn"]);
    expect(recipientsFor(complaint({ lotHeld: true }), off).zaloIds).toEqual(["1234567890123"]);
  });

  it("falls back to ALERT_EMAIL when no email is set", () => {
    expect(recipientsFor(order, { ...prefs, notifyEmails: "" }, "alert@pomil.vn").emails).toEqual(["alert@pomil.vn"]);
  });
});
