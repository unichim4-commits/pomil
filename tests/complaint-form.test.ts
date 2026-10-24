import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// T-8 / SA-7: câu lỗi số lô không còn số lô mẫu.
// T-9 / SA-9 (D-3): số lô và mã mẫu thử đều tùy chọn; thiếu cả hai thì bắt buộc số điện thoại/Zalo.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => undefined }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-complaint-"));
process.env.PGLITE_DIR = dir;

import { getDb } from "@/db/client";
import { sendComplaint } from "@/app/(public)/phan-anh/actions";
import { complaints } from "@/db/schema";
import { checkClaims } from "@/modules/content/rules";
import {
  COMPLAINT_LOT_FORMAT_ERROR,
  COMPLAINT_LOT_HINT,
  COMPLAINT_INTRO,
  COMPLAINT_NEED_CONTACT_ERROR,
  COMPLAINT_PHONE_ERROR,
  COMPLAINT_PHONE_HINT,
  COMPLAINT_PHONE_LABEL,
  COMPLAINT_SAMPLE_LABEL,
  COMPLAINT_THANKS_TITLE,
  complaintThanksBody,
  complaintThanksText,
} from "@/modules/quality/copy";
import { complaintLotLabel, complaintMissingField, complaintResponseBadge } from "@/modules/quality/rules";
import { eq } from "drizzle-orm";

beforeAll(async () => {
  await getDb();
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function form(fields: Record<string, string>) {
  const fd = new FormData();
  const base = { symptoms: "Ngứa nhẹ sau 2 ngày", severity: "mild", website: "" };
  for (const [k, v] of Object.entries({ ...base, ...fields })) fd.set(k, v);
  return fd;
}

describe("complaintMissingField", () => {
  it("has a lot number: nothing else required", () => {
    expect(complaintMissingField({ lotNo: "PST-271101-01", sampleCode: null, contactPhone: null })).toBeNull();
  });
  it("has a sample code: nothing else required", () => {
    expect(complaintMissingField({ lotNo: "", sampleCode: "MT01", contactPhone: null })).toBeNull();
  });
  it("no lot, no sample code, but a phone: ok", () => {
    expect(complaintMissingField({ lotNo: "", sampleCode: "", contactPhone: "0900000000" })).toBeNull();
  });
  it("nothing at all: asks for a contact", () => {
    expect(complaintMissingField({ lotNo: "", sampleCode: "", contactPhone: null })).toBe("contact");
    expect(complaintMissingField({ lotNo: "   ", sampleCode: undefined, contactPhone: "  " })).toBe("contact");
  });
});

describe("complaintLotLabel", () => {
  it("shows the matched lot, the typed lot, the sample code, or 'Chưa có số lô'", () => {
    expect(complaintLotLabel({ lotNo: "PST-271101-01", reportedLotNo: "PST-271101-01", sampleCode: null })).toBe("PST-271101-01");
    expect(complaintLotLabel({ lotNo: null, reportedLotNo: "PST-990101-01", sampleCode: null })).toBe("PST-990101-01 (không khớp lô nào)");
    expect(complaintLotLabel({ lotNo: null, reportedLotNo: null, sampleCode: "MT01" })).toBe("Mẫu MT01");
    expect(complaintLotLabel({ lotNo: null, reportedLotNo: null, sampleCode: null })).toBe("Chưa có số lô");
  });
});

describe("complaintResponseBadge", () => {
  const now = new Date("2027-12-10T12:00:00Z");
  const old = new Date("2027-12-09T10:00:00Z");
  it("has a phone and is overdue: red badge", () => {
    expect(complaintResponseBadge({ openedAt: old, firstResponseAt: null, contactPhone: "84900000000" }, now)).toEqual({ tone: "red", label: "Quá 24 giờ chưa phản hồi" });
  });
  it("no phone: neutral badge, never red", () => {
    expect(complaintResponseBadge({ openedAt: old, firstResponseAt: null, contactPhone: null }, now)).toEqual({ tone: "neutral", label: "Không có số liên hệ" });
    expect(complaintResponseBadge({ openedAt: old, firstResponseAt: null, contactPhone: "  " }, now)?.tone).toBe("neutral");
  });
  it("has a phone, answered or still within 24 hours: no badge", () => {
    expect(complaintResponseBadge({ openedAt: old, firstResponseAt: new Date("2027-12-09T11:00:00Z"), contactPhone: "84900000000" }, now)).toBeNull();
    expect(complaintResponseBadge({ openedAt: new Date("2027-12-10T01:00:00Z"), firstResponseAt: null, contactPhone: "84900000000" }, now)).toBeNull();
  });
});

describe("complaint copy", () => {
  it("passes checkClaims", () => {
    const texts = [
      COMPLAINT_LOT_HINT,
      COMPLAINT_NEED_CONTACT_ERROR,
      COMPLAINT_PHONE_ERROR,
      COMPLAINT_INTRO,
      COMPLAINT_PHONE_LABEL,
      COMPLAINT_PHONE_HINT,
      COMPLAINT_SAMPLE_LABEL,
      COMPLAINT_THANKS_TITLE,
      complaintThanksText(complaintThanksBody(true)),
      complaintThanksText(complaintThanksBody(false)),
      complaintThanksText(complaintThanksBody(false, { zalo: "0900000000" })),
      complaintThanksText(complaintThanksBody(false, { hotline: "0900000000" })),
      complaintThanksText(complaintThanksBody(false, { zalo: "+84 911.222.333", hotline: "1900 1234" })),
    ];
    expect(texts.flatMap((t) => checkClaims(t))).toEqual([]);
  });
  it("uses the approved wording (T-9 V1, V2, V3, V5, V6)", () => {
    expect(COMPLAINT_INTRO).toBe(
      "Nếu da đầu bạn ngứa, đỏ, rát hoặc khó chịu sau khi dùng, hãy ngừng dùng và cho Pomil biết. Bạn để lại số điện thoại hoặc Zalo thì mình sẽ liên hệ lại trong vòng 24 giờ.",
    );
    expect(COMPLAINT_PHONE_LABEL).toBe("Số điện thoại hoặc Zalo");
    expect(COMPLAINT_PHONE_HINT).toBe("Bắt buộc nếu bạn không có số lô hay mã mẫu thử. Mình chỉ dùng số này để hỏi về phản ánh của bạn.");
    expect(COMPLAINT_SAMPLE_LABEL).toBe("Mã mẫu thử (nếu có)");
    expect(COMPLAINT_NEED_CONTACT_ERROR).toBe("Không có số lô hay mã mẫu thử thì để lại số điện thoại hoặc Zalo, để mình gọi hỏi thêm nhé.");
    expect(COMPLAINT_PHONE_ERROR).toBe("Số điện thoại chưa đúng. Bạn gõ đủ 10 số, bắt đầu bằng 0 nhé.");
  });
  it("does not promise a call back when there is no contact", () => {
    expect(complaintThanksText(complaintThanksBody(true))).toContain("liên hệ trong vòng 24 giờ");
    const none = complaintThanksText(complaintThanksBody(false));
    expect(none).not.toContain("24 giờ");
    expect(none).toContain("chưa liên hệ lại được");
    expect(complaintThanksText(complaintThanksBody(false, { zalo: "0911222333" }))).toContain("Zalo 0911222333");
    expect(complaintThanksText(complaintThanksBody(false, { hotline: "19001234" }))).toContain("gọi 19001234");
  });
  it("keeps the sentence text exactly", () => {
    expect(complaintThanksText(complaintThanksBody(false, { zalo: "0911222333" }))).toBe(
      "Bạn chưa để lại số nên mình chưa liên hệ lại được. Cần mình gọi lại thì nhắn Zalo 0911222333 cho Pomil nhé. Bạn nên ngừng dùng sản phẩm. Nếu triệu chứng nặng hoặc kéo dài, hãy đến cơ sở y tế.",
    );
  });
  it("links Zalo and hotline with normalized numbers", () => {
    const z = complaintThanksBody(false, { zalo: "+84 911.222.333" }).find((p) => p.href);
    expect(z).toMatchObject({ href: "https://zalo.me/0911222333", external: true, text: "nhắn Zalo +84 911.222.333" });
    const h = complaintThanksBody(false, { hotline: "1900 1234" }).find((p) => p.href);
    expect(h).toMatchObject({ href: "tel:19001234", text: "gọi 1900 1234" });
    expect(h?.external).toBeUndefined();
  });
  it("stays plain text when the number is invalid or missing", () => {
    expect(complaintThanksBody(false, { zalo: "abc" }).some((p) => p.href)).toBe(false);
    expect(complaintThanksBody(false, { zalo: "12345" }).some((p) => p.href)).toBe(false);
    expect(complaintThanksBody(false, { hotline: "12" }).some((p) => p.href)).toBe(false);
    expect(complaintThanksBody(false).some((p) => p.href)).toBe(false);
    expect(complaintThanksBody(true).some((p) => p.href)).toBe(false);
  });
});

describe("sendComplaint", () => {
  it("explains the lot format without a real-looking lot number", async () => {
    const r = await sendComplaint({ status: "idle" }, form({ lotNo: "PST-2710", sampleCode: "" }));
    expect(r).toEqual({ status: "error", message: COMPLAINT_LOT_FORMAT_ERROR });
    expect(COMPLAINT_LOT_FORMAT_ERROR).not.toMatch(/PST-\d/);
  });
  it("accepts a sample code without a lot number", async () => {
    expect(await sendComplaint({ status: "idle" }, form({ lotNo: "", sampleCode: "MT01" }))).toEqual({ status: "ok", hasContact: false });
  });
  it("accepts a valid lot number without a sample code", async () => {
    expect(await sendComplaint({ status: "idle" }, form({ lotNo: "pst-271101-01", sampleCode: "" }))).toEqual({ status: "ok", hasContact: false });
  });
  it("both codes empty and no phone: asks for a phone or Zalo", async () => {
    const r = await sendComplaint({ status: "idle" }, form({ lotNo: "", sampleCode: "", phone: "" }));
    expect(r).toEqual({ status: "error", message: COMPLAINT_NEED_CONTACT_ERROR });
  });
  it("both codes empty and a bad phone: says the phone is wrong", async () => {
    const r = await sendComplaint({ status: "idle" }, form({ lotNo: "", sampleCode: "", phone: "12" }));
    expect(r).toEqual({ status: "error", message: COMPLAINT_PHONE_ERROR });
  });
  it("both codes empty with a phone: saves a complaint without a lot", async () => {
    const symptoms = "Phản ánh không có lô, có số điện thoại";
    const r = await sendComplaint({ status: "idle" }, form({ lotNo: "", sampleCode: "", phone: "0900 000 000", symptoms }));
    expect(r).toEqual({ status: "ok", hasContact: true });
    const db = await getDb();
    const [row] = await db.select().from(complaints).where(eq(complaints.symptoms, symptoms));
    expect(row).toMatchObject({ lotId: null, reportedLotNo: null, sampleCode: null, contactPhone: "84900000000" });
  });
  it("keeps a typed lot number that matches no lot", async () => {
    const symptoms = "Số lô gõ nhầm, chưa có trong hệ thống";
    const r = await sendComplaint({ status: "idle" }, form({ lotNo: "PST-990101-01", sampleCode: "", symptoms }));
    expect(r).toEqual({ status: "ok", hasContact: false });
    const db = await getDb();
    const [row] = await db.select().from(complaints).where(eq(complaints.symptoms, symptoms));
    expect(row).toMatchObject({ lotId: null, reportedLotNo: "PST-990101-01" });
  });
});
