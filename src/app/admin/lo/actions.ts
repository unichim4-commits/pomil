"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formatLotNo } from "@/lib/lot-no";
import { requirePermission } from "@/modules/auth/service";
import { getProduct } from "@/modules/catalog/service";
import { addLotTest, addNotification, COMPLAINT_STATUS_LABEL, createLot, setLotHold, setLotTestResult, TEST_LABEL, updateComplaint, updateLotPublic } from "@/modules/quality/admin";
import type { ReleaseBlocker } from "@/modules/quality/rules";
import { releaseLot } from "@/modules/quality/service";
import { fail, guard, ok, optStr, str, type ActionResult } from "../_lib/result";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày chưa đúng");

const lotSchema = z.object({
  productId: z.string().uuid("Chọn sản phẩm"),
  manufacturedOn: date,
  expiresOn: date,
  batch: z.coerce.number().int().min(1).max(99),
  formulaVersion: z.string().trim().min(1, "Nhập phiên bản công thức").max(20),
  factory: z.string().trim().max(120),
  unitsProduced: z.coerce.number().int().min(1, "Số chai phải lớn hơn 0").max(1_000_000),
});

export async function createLotAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("lots.write");
    const parsed = lotSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ");
    const d = parsed.data;
    if (d.expiresOn <= d.manufacturedOn) return fail("Hạn dùng phải sau ngày sản xuất");
    const product = await getProduct(d.productId);
    if (!product) return fail("Không tìm thấy sản phẩm");
    const lotNo = formatLotNo(product.code, new Date(`${d.manufacturedOn}T00:00:00Z`), d.batch);
    const r = await createLot(
      { lotNo, productId: d.productId, formulaVersion: d.formulaVersion, factory: d.factory || null, manufacturedOn: d.manufacturedOn, expiresOn: d.expiresOn, unitsProduced: d.unitsProduced },
      staff.id,
    );
    if (!r.ok) return fail(r.message);
    id = r.id;
    return ok(`Đã tạo lô ${lotNo}`);
  });
  if (id) redirect(`/admin/lo/${id}`);
  return result;
}

const BLOCKER_TEXT = (b: ReleaseBlocker): string => {
  switch (b.code) {
    case "missing_test":
      return `Thiếu phiếu ${TEST_LABEL[b.test]}`;
    case "failed_test":
      return `${TEST_LABEL[b.test]} không đạt`;
    case "pending_test":
      return `${TEST_LABEL[b.test]} đang chờ kết quả`;
    case "no_notification":
      return "Sản phẩm chưa có phiếu công bố";
    case "notification_expired":
      return "Phiếu công bố đã hết hạn";
    case "lot_expired":
      return "Lô đã hết hạn dùng";
    case "not_in_quarantine":
      return "Lô không ở trạng thái cách ly";
  }
};

export async function releaseLotAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    // Duyệt xuất lô: chỉ chủ (quality.approve), chủ dự án duyệt 13/11/2026 (Q17)
    const staff = await requirePermission("quality.approve");
    const id = str(formData, "lotId");
    const verdict = await releaseLot(id, staff.id);
    revalidatePath(`/admin/lo/${id}`);
    if (!verdict.ok) return fail(`Chưa duyệt được:\n${verdict.blockers.map(BLOCKER_TEXT).join("\n")}`);
    return ok("Đã duyệt xuất kho. Lô có thể gán cho đơn hàng.");
  });
}

export async function holdLotAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const hold = str(formData, "hold") === "1";
    // Giữ lô: lots.write. Mở lại lô đang giữ: quality.approve (03-chat-luong.md, mở giữ cần duyệt chất lượng)
    const staff = await requirePermission(hold ? "lots.write" : "quality.approve");
    const id = str(formData, "lotId");
    const reason = optStr(formData, "reason");
    if (hold && !reason) return fail("Ghi lý do giữ lô");
    const r = await setLotHold(id, hold, reason, staff.id);
    revalidatePath(`/admin/lo/${id}`);
    return r.ok ? ok(hold ? "Đã giữ lô." : "Đã mở lại lô.") : fail(r.message ?? "Không đổi được");
  });
}

const testSchema = z.object({
  lotId: z.string().uuid(),
  type: z.enum(["microbial", "heavy_metals", "stability", "gc_ms", "irritation", "sensory"]),
  result: z.enum(["pass", "fail", "pending"]),
  lab: z.string().trim().max(120),
  reportNo: z.string().trim().max(60),
  testedOn: z.union([z.literal(""), date]),
});

export async function addTestAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("lots.write");
    const parsed = testSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ");
    const d = parsed.data;
    await addLotTest({ ...d, lab: d.lab || null, reportNo: d.reportNo || null, testedOn: d.testedOn || null, isPublic: formData.get("isPublic") === "on" }, staff.id);
    revalidatePath(`/admin/lo/${d.lotId}`);
    return ok("Đã thêm phiếu.");
  });
}

export async function testResultAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("lots.write");
    const result = str(formData, "result");
    if (result !== "pass" && result !== "fail" && result !== "pending") return fail("Kết quả không hợp lệ");
    await setLotTestResult(str(formData, "testId"), result, staff.id);
    revalidatePath(`/admin/lo/${str(formData, "lotId")}`);
    return ok("Đã lưu");
  });
}

export async function notificationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("lots.write");
    const parsed = z
      .object({ productId: z.string().uuid(), number: z.string().trim().min(3, "Nhập số tiếp nhận").max(60), issuedAt: date, expiresAt: date })
      .safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ");
    if (parsed.data.expiresAt <= parsed.data.issuedAt) return fail("Ngày hết hạn phải sau ngày cấp");
    await addNotification(parsed.data, staff.id);
    revalidatePath(`/admin/lo/${str(formData, "lotId")}`);
    return ok("Đã lưu phiếu công bố.");
  });
}

export async function publicInfoAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("lots.write");
    const id = str(formData, "lotId");
    // Mỗi dòng "Limonene | 92.5"
    const components = str(formData, "oilMainComponents")
      .split(/\r?\n/)
      .map((l) => l.split("|").map((x) => x.trim()))
      .filter(([name, pct]) => name && pct)
      .map(([name, pct]) => ({ name: name!, percent: Number(String(pct).replace(",", ".")) }));
    if (components.some((c) => !Number.isFinite(c.percent) || c.percent < 0 || c.percent > 100)) return fail("Tỷ lệ phần trăm phải từ 0 đến 100");
    await updateLotPublic(
      id,
      {
        isPublic: formData.get("isPublic") === "on",
        publicInfo: {
          pomeloOrigin: optStr(formData, "pomeloOrigin") ?? undefined,
          harvestSeason: optStr(formData, "harvestSeason") ?? undefined,
          note: optStr(formData, "note") ?? undefined,
          oilMainComponents: components,
        },
      },
      staff.id,
    );
    revalidatePath(`/admin/lo/${id}`);
    return ok("Đã lưu thông tin công khai.");
  });
}

export async function complaintAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("complaints.write");
    const status = str(formData, "status") as keyof typeof COMPLAINT_STATUS_LABEL;
    if (!(status in COMPLAINT_STATUS_LABEL)) return fail("Trạng thái không hợp lệ");
    await updateComplaint(str(formData, "id"), { status, rootCause: optStr(formData, "rootCause"), correctiveAction: optStr(formData, "correctiveAction") }, staff.id);
    revalidatePath("/admin/phan-anh");
    return ok("Đã lưu");
  });
}
