"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/service";
import { checkClaims, describeViolations } from "@/modules/content/rules";
import { invalidRecipients } from "@/modules/notify/rules";
import { storeSettingsSchema } from "@/modules/settings/schema";
import { getErpSettings, saveErpSettings, saveSettings } from "@/modules/settings/service";
import { parseErpForm } from "./erp-form";
import { fail, guard, ok, type ActionResult } from "../_lib/result";

const TEXT_KEYS = ["storeName", "tagline", "hotline", "zalo", "email", "address", "businessInfo", "tiktok", "instagram", "facebook", "shopee", "announcement", "launchNote", "shippingNote", "bankBin", "bankName", "bankAccountNo", "bankAccountName", "notifyEmails", "notifyZaloUserIds"] as const;
const NUMBER_KEYS = ["shippingFlatFee", "shippingFreeThreshold", "maxQtyPerItem"] as const;
const BOOL_KEYS = ["salesOpen", "codEnabled", "bankTransferEnabled", "notifyOnOrder", "notifyOnComplaint"] as const;

export async function saveSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("settings.write");
    const raw: Record<string, unknown> = {};
    for (const k of TEXT_KEYS) raw[k] = String(formData.get(k) ?? "");
    for (const k of NUMBER_KEYS) raw[k] = Number(formData.get(k) ?? 0);
    for (const k of BOOL_KEYS) raw[k] = formData.get(k) === "on";

    const parsed = storeSettingsSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(`${issue?.path.join(".")}: ${issue?.message ?? "chưa hợp lệ"}`);
    }
    const s = parsed.data;
    if (!s.codEnabled && !s.bankTransferEnabled) return fail("Cần bật ít nhất một cách thanh toán.");
    if (s.bankBin && !/^\d{6}$/.test(s.bankBin)) return fail("Mã BIN ngân hàng gồm 6 chữ số (ví dụ Vietcombank 970436).");
    const badEmails = invalidRecipients(s.notifyEmails, "email");
    if (badEmails.length) return fail(`Email nhận thông báo chưa đúng: ${badEmails.join(", ")}`);
    const badZalo = invalidRecipients(s.notifyZaloUserIds, "zalo");
    if (badZalo.length) return fail(`user_id Zalo là dãy số, chưa đúng: ${badZalo.join(", ")}`);
    const violations = [s.tagline, s.announcement, s.launchNote, s.shippingNote].flatMap(checkClaims);
    if (violations.length) return fail(`Có câu công dụng không được phép:\n${describeViolations(violations)}`);

    await saveSettings(s, staff.id);
    revalidatePath("/", "layout");
    return ok("Đã lưu cài đặt.");
  });
}

// Cài đặt vận hành 5 phân hệ (khóa erp, 00-tong-quan mục 10)
export async function saveErpSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("settings.write");
    const current = await getErpSettings();
    const r = parseErpForm((k) => String(formData.get(k) ?? ""), current);
    if (!r.ok) return fail(r.message);
    await saveErpSettings(r.value, staff.id);
    revalidatePath("/admin", "layout");
    return ok("Đã lưu cài đặt vận hành.");
  });
}
