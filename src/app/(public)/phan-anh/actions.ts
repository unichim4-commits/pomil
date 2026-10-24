"use server";

import { z } from "zod";
import { logError } from "@/lib/log";
import { normalizeVnPhone } from "@/lib/phone";
import { parseLotNo } from "@/lib/lot-no";
import { displayPhone } from "@/lib/format";
import { COMPLAINT_LOT_FORMAT_ERROR, COMPLAINT_NEED_CONTACT_ERROR, COMPLAINT_PHONE_ERROR } from "@/modules/quality/copy";
import { complaintMissingField } from "@/modules/quality/rules";
import { notifyInBackground } from "@/modules/notify/service";
import { submitComplaint } from "@/modules/quality/service";

export type ComplaintState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; hasContact: boolean };

const schema = z.object({
  lotNo: z.string().trim().toUpperCase().optional(),
  sampleCode: z.string().trim().max(10).optional(),
  phone: z.string().trim().optional(),
  startedUsingOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  symptoms: z.string().trim().min(5, "Vui lòng mô tả triệu chứng").max(2000),
  severity: z.enum(["mild", "moderate", "severe"]),
  website: z.string().max(0).optional(),
});

export async function sendComplaint(_prev: ComplaintState, formData: FormData): Promise<ComplaintState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ" };

  const { lotNo, sampleCode, phone, startedUsingOn, symptoms, severity } = parsed.data;
  if (lotNo && !parseLotNo(lotNo)) return { status: "error", message: COMPLAINT_LOT_FORMAT_ERROR };

  const contactPhone = phone ? normalizeVnPhone(phone) : null;
  if (phone && !contactPhone) return { status: "error", message: COMPLAINT_PHONE_ERROR };
  // D-3: số lô và mã mẫu đều tùy chọn; thiếu cả hai thì cần số liên hệ.
  if (complaintMissingField({ lotNo, sampleCode, contactPhone }) === "contact") return { status: "error", message: COMPLAINT_NEED_CONTACT_ERROR };

  try {
    const result = await submitComplaint({
      lotNo: lotNo || null,
      sampleCode: sampleCode || null,
      contactPhone,
      startedUsingOn: startedUsingOn || null,
      symptoms,
      severity,
    });
    notifyInBackground({
      kind: "complaint_created",
      complaintId: result.complaintId,
      lotNo: lotNo || null,
      sampleCode: sampleCode || null,
      severity,
      symptoms,
      contactPhone: contactPhone ? displayPhone(contactPhone) : null,
      lotHeld: result.lotHeld,
    });
    return { status: "ok", hasContact: !!contactPhone };
  } catch (error) {
    logError("complaint", error);
    return { status: "error", message: "Chưa gửi được, bạn thử lại hoặc nhắn Zalo cho Pomil nhé" };
  }
}
