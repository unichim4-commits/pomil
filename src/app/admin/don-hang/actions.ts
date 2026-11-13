"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/service";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/modules/orders/rules";
import { assignLot, changeOrderStatus, deliverOnSpot, recordDeliveryFailed, setPaymentStatus, updateOrderShipping, type ReturnLineChoice } from "@/modules/orders/service";
import { updatePlatformFee } from "@/modules/sales/orders";
import { parseMoney } from "@/modules/sales/rules";
import { fail, guard, ok, optStr, str, type ActionResult } from "../_lib/result";

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];

export async function changeStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("orders.write");
    const id = str(formData, "orderId");
    const to = str(formData, "to") as OrderStatus;
    if (!STATUSES.includes(to)) return fail("Trạng thái không hợp lệ");
    const note = optStr(formData, "note");
    if (to === "cancelled" && !note) return fail("Ghi lý do hủy để sau này đối chiếu.");
    // Hoàn về: cách xử lý từng dòng "disposition:<orderItemId>" (R-BH-16)
    const returnLines: ReturnLineChoice[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("disposition:")) continue;
      returnLines.push({ orderItemId: key.slice(12), disposition: String(value) === "quarantine" ? "quarantine" : "restock" });
    }
    const result = await changeOrderStatus(id, to, staff.id, note, { returnLines });
    if (!result.ok) return fail(result.message);
    revalidatePath(`/admin/don-hang/${id}`);
    return ok(`Đã chuyển sang “${ORDER_STATUS_LABEL[to]}”.`);
  });
}

export async function paymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("orders.write");
    const id = str(formData, "orderId");
    const status = str(formData, "paymentStatus");
    if (status !== "paid" && status !== "unpaid" && status !== "refunded") return fail("Trạng thái thanh toán không hợp lệ");
    const reason = optStr(formData, "reason");
    if (status === "unpaid" && !reason) return fail("Ghi lý do khi chuyển về chưa thanh toán");
    const result = await setPaymentStatus(id, status, staff.id, reason);
    if (!result.ok) return fail(result.message);
    revalidatePath(`/admin/don-hang/${id}`);
    return ok("Đã cập nhật thanh toán.");
  });
}

export async function shippingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("orders.write");
    const id = str(formData, "orderId");
    await updateOrderShipping(
      id,
      { carrier: optStr(formData, "carrier"), trackingNo: optStr(formData, "trackingNo"), internalNote: optStr(formData, "internalNote") },
      staff.id,
    );
    revalidatePath(`/admin/don-hang/${id}`);
    return ok("Đã lưu.");
  });
}

export async function assignLotAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("orders.write");
    const result = await assignLot(str(formData, "itemId"), optStr(formData, "lotId"), staff.id);
    if (!result.ok) return fail(result.message ?? "Không gán được lô");
    revalidatePath(`/admin/don-hang/${str(formData, "orderId")}`);
    return ok(result.warning ? `Đã gán lô. ${result.warning}` : "Đã gán lô.");
  });
}

export async function deliverOnSpotAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("orders.write");
    const id = str(formData, "orderId");
    const result = await deliverOnSpot(id, staff.id, { paidNow: formData.get("paidNow") === "on" });
    if (!result.ok) return fail(result.message);
    revalidatePath(`/admin/don-hang/${id}`);
    return ok("Đã giao tại chỗ.");
  });
}

export async function deliveryFailedAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("orders.write");
    const id = str(formData, "orderId");
    const result = await recordDeliveryFailed(id, str(formData, "reason"), staff.id);
    if (!result.ok) return fail(result.message);
    revalidatePath(`/admin/don-hang/${id}`);
    return ok("Đã ghi giao thất bại. Đơn vẫn đang giao.");
  });
}

export async function platformFeeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "orderId");
    const fee = parseMoney(str(formData, "platformFee"));
    if (fee === null) return fail("Nhập phí nền tảng hợp lệ");
    const reason = str(formData, "reason");
    if (!reason) return fail("Ghi lý do sửa phí");
    const result = await updatePlatformFee(id, fee, reason, staff);
    if (!result.ok) return fail(result.message);
    revalidatePath(`/admin/don-hang/${id}`);
    return ok("Đã sửa phí nền tảng.");
  });
}
