"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/modules/auth/service";
import { packOrder } from "@/modules/orders/service";
import { createChannel, deletePriceListItem, saveBundle, savePriceList, saveVoucher, updateChannel, upsertPriceListItem } from "@/modules/sales/catalog";
import { createDealer, setDealerStatus, updateDealer, type DealerInput } from "@/modules/sales/dealers";
import { createManualOrder, type ManualOrderInput } from "@/modules/sales/orders";
import {
  approveReturn,
  cancelReturn,
  completeReturn,
  createComplaintFromReturn,
  createReturnRequest,
  receiveReturn,
  rejectReturn,
} from "@/modules/sales/returns";
import {
  parseMoney,
  parsePercentToBp,
  type ChannelKind,
  type DealerStatus,
  type PaymentMethod,
  type PriceListKind,
  type ReturnCondition,
  type ReturnDisposition,
  type ReturnReason,
  type ReturnResolution,
} from "@/modules/sales/rules";
import { fail, guard, ok, optStr, str, type ActionResult } from "../_lib/result";

// ---------------------------------------------------------------------------------------------
// Đọc form

function money(formData: FormData, key: string, label: string): number {
  const v = parseMoney(str(formData, key));
  if (v === null) throw new FormError(`${label}: nhập số tiền hợp lệ`);
  return v;
}
function optMoney(formData: FormData, key: string, label: string): number | null {
  return str(formData, key) === "" ? null : money(formData, key, label);
}
function int(formData: FormData, key: string, label: string, fallback = 0): number {
  const raw = str(formData, key);
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new FormError(`${label} phải là số nguyên`);
  return n;
}
function percent(formData: FormData, key: string, label: string): number {
  const v = parsePercentToBp(str(formData, key));
  if (v === null) throw new FormError(`${label}: nhập phần trăm từ 0 tới 100`);
  return v;
}
function checked(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "1";
}
function isoDate(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new FormError("Ngày không hợp lệ");
  return v;
}

class FormError extends Error {}
async function form(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  return guard(async () => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof FormError) return fail(error.message);
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Đơn tay (R-BH-7)

export async function createOrderAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let target = "";
  const result = await form(async () => {
    const staff = await requirePermission("sales.write");
    const productIds = formData.getAll("productId").map(String);
    const qtys = formData.getAll("qty").map(String);
    const prices = formData.getAll("unitPrice").map(String);
    const lines: ManualOrderInput["lines"] = [];
    productIds.forEach((pid, i) => {
      if (!pid) return;
      const qty = Number(qtys[i] ?? "0");
      if (!Number.isInteger(qty) || qty <= 0) throw new FormError("Số lượng mỗi dòng phải là số nguyên lớn hơn 0");
      const priceRaw = (prices[i] ?? "").trim();
      const unitPrice = priceRaw === "" ? null : parseMoney(priceRaw);
      if (priceRaw !== "" && unitPrice === null) throw new FormError("Đơn giá sửa tay không hợp lệ");
      lines.push({ productId: pid, qty, unitPrice });
    });
    const bundleIds = formData.getAll("bundleId").map(String);
    const bundleQtys = formData.getAll("bundleQty").map(String);
    const bundles = bundleIds.map((id, i) => ({ bundleId: id, qty: Number(bundleQtys[i] ?? "0") })).filter((b) => b.bundleId && b.qty > 0);
    if (lines.length === 0 && bundles.length === 0) return fail("Thêm ít nhất một sản phẩm hoặc combo");

    const input: ManualOrderInput = {
      channelCode: str(formData, "channelCode"),
      dealerId: optStr(formData, "dealerId"),
      recipientName: str(formData, "recipientName"),
      phone: optStr(formData, "phone"),
      email: optStr(formData, "email"),
      province: str(formData, "province"),
      ward: str(formData, "ward"),
      addressLine: str(formData, "addressLine"),
      customerNote: optStr(formData, "customerNote"),
      internalNote: optStr(formData, "internalNote"),
      lines,
      bundles,
      voucherCode: optStr(formData, "voucherCode"),
      manualDiscount: money(formData, "manualDiscount", "Chiết khấu tay"),
      shippingFee: money(formData, "shippingFee", "Phí giao"),
      platformFee: optMoney(formData, "platformFee", "Phí nền tảng"),
      externalRef: optStr(formData, "externalRef"),
      paymentMethod: str(formData, "paymentMethod") as PaymentMethod,
      consentConfirmed: checked(formData, "consentConfirmed"),
      confirmNow: str(formData, "intent") === "confirm",
      priceOverrideReason: optStr(formData, "priceOverrideReason"),
    };
    const r = await createManualOrder(input, staff);
    if (!r.ok) return fail(r.message);
    revalidatePath("/admin/don-hang");
    target = `/admin/don-hang/${r.orderId}`;
    return ok(`Đã tạo đơn ${r.code}.`);
  });
  if (target) redirect(target);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Đóng gói (R-BH-13)

export async function packAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.write");
    const orderId = str(formData, "orderId");
    const checkedItemIds = formData.getAll("checked").map(String);
    // Lô chọn tay: ô "pick:<orderItemId>:<stockLotId>" = số chai
    const picks: { orderItemId: string; stockLotId: string; qty: number }[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("pick:")) continue;
      const qty = Number(String(value).trim() || "0");
      if (!Number.isInteger(qty) || qty < 0) return fail("Số chai lấy ở mỗi lô phải là số nguyên không âm");
      if (qty === 0) continue;
      const [, orderItemId, stockLotId] = key.split(":");
      picks.push({ orderItemId: orderItemId!, stockLotId: stockLotId!, qty });
    }
    const manual = str(formData, "lotMode") === "manual";
    const r = await packOrder(orderId, { checkedItemIds, picks: manual ? picks : undefined }, staff.id);
    if (!r.ok) return fail(r.message);
    revalidatePath(`/admin/ban-hang/dong-goi`);
    revalidatePath(`/admin/don-hang/${orderId}`);
    return ok("Đã xuất kho và đóng gói. In phiếu đóng gói và nhãn giao.");
  });
}

// ---------------------------------------------------------------------------------------------
// Đổi trả (R-BH-19…R-BH-25)

const REASONS: ReturnReason[] = ["defect", "wrong_item", "damaged", "changed_mind", "other"];
const RESOLUTIONS: ReturnResolution[] = ["refund", "exchange", "none"];

export async function createReturnAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let target = "";
  const result = await form(async () => {
    const staff = await requirePermission("sales.write");
    const reason = str(formData, "reason") as ReturnReason;
    const resolution = str(formData, "resolution") as ReturnResolution;
    if (!REASONS.includes(reason)) return fail("Chọn lý do đổi trả");
    if (!RESOLUTIONS.includes(resolution)) return fail("Chọn cách giải quyết");
    const lines: { orderItemId: string; qty: number }[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("qty:")) continue;
      const qty = Number(String(value).trim() || "0");
      if (!Number.isInteger(qty) || qty < 0) return fail("Số trả phải là số nguyên không âm");
      if (qty > 0) lines.push({ orderItemId: key.slice(4), qty });
    }
    const r = await createReturnRequest(
      {
        orderId: str(formData, "orderId"),
        reason,
        reasonNote: str(formData, "reasonNote"),
        resolution,
        lines,
        refundAmount: optMoney(formData, "refundAmount", "Tiền hoàn"),
        extraCost: money(formData, "extraCost", "Chi phí phát sinh"),
        note: optStr(formData, "note"),
      },
      staff,
    );
    if (!r.ok) return fail(r.message);
    revalidatePath("/admin/ban-hang/doi-tra");
    target = `/admin/ban-hang/doi-tra/${r.id}`;
    return ok(`Đã tạo đổi trả ${r.code}.`);
  });
  if (target) redirect(target);
  return result;
}

function returnDone(id: string, message: string): ActionResult {
  revalidatePath(`/admin/ban-hang/doi-tra/${id}`);
  revalidatePath("/admin/ban-hang/doi-tra");
  return ok(message);
}

export async function approveReturnAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "returnId");
    const r = await approveReturn(id, staff);
    return r.ok ? returnDone(id, "Đã duyệt. Chờ nhận hàng trả về.") : fail(r.message);
  });
}

export async function cancelReturnAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "returnId");
    const r = await cancelReturn(id, staff);
    return r.ok ? returnDone(id, "Đã hủy đổi trả.") : fail(r.message);
  });
}

export async function rejectReturnAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "returnId");
    const reason = str(formData, "reason");
    if (!reason) return fail("Ghi lý do từ chối");
    const r = await rejectReturn(id, reason, staff);
    return r.ok ? returnDone(id, "Đã từ chối.") : fail(r.message);
  });
}

export async function receiveReturnAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "returnId");
    const lineIds = formData.getAll("lineId").map(String);
    const lines = lineIds.map((lineId) => ({
      lineId,
      condition: (str(formData, `condition:${lineId}`) || null) as ReturnCondition | null,
      disposition: (str(formData, `disposition:${lineId}`) || null) as ReturnDisposition | null,
    }));
    const r = await receiveReturn(id, lines, staff);
    return r.ok ? returnDone(id, "Đã nhận hàng trả về.") : fail(r.message);
  });
}

export async function completeReturnAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "returnId");
    const exchangeIds = formData.getAll("exchangeProductId").map(String);
    const exchangeQtys = formData.getAll("exchangeQty").map(String);
    const exchangeLines = exchangeIds.map((productId, i) => ({ productId, qty: Number(exchangeQtys[i] ?? "0") })).filter((l) => l.productId && l.qty > 0);
    const r = await completeReturn(
      id,
      {
        refundAmount: optMoney(formData, "refundAmount", "Tiền hoàn"),
        extraCost: optMoney(formData, "extraCost", "Chi phí phát sinh"),
        refundAccountId: optStr(formData, "refundAccountId"),
        exchangeLines: exchangeLines.length ? exchangeLines : undefined,
        exchangeShippingFee: money(formData, "exchangeShippingFee", "Phí giao đơn đổi"),
      },
      staff,
    );
    if (!r.ok) return fail(r.message);
    return returnDone(id, r.replacementOrderCode ? `Đã hoàn tất. Đơn đổi ${r.replacementOrderCode}.` : "Đã hoàn tất đổi trả.");
  });
}

export async function complaintFromReturnAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("complaints.write");
    const id = str(formData, "returnId");
    const r = await createComplaintFromReturn(id, staff);
    return r.ok ? returnDone(id, "Đã tạo phản ánh, gắn với lô của dòng hàng.") : fail(r.message);
  });
}

// ---------------------------------------------------------------------------------------------
// Đại lý (R-BH-9, R-BH-10)

function dealerInput(formData: FormData): DealerInput {
  return {
    name: str(formData, "name"),
    tier: str(formData, "tier"),
    contactName: optStr(formData, "contactName"),
    phone: optStr(formData, "phone"),
    email: optStr(formData, "email"),
    address: optStr(formData, "address"),
    taxCode: optStr(formData, "taxCode"),
    contractNo: optStr(formData, "contractNo"),
    contractStart: isoDate(formData, "contractStart"),
    contractEnd: isoDate(formData, "contractEnd"),
    priceListId: optStr(formData, "priceListId"),
    discountBp: percent(formData, "discount", "Chiết khấu"),
    commissionBp: percent(formData, "commission", "Hoa hồng"),
    creditLimit: money(formData, "creditLimit", "Hạn mức công nợ"),
    paymentTermsDays: int(formData, "paymentTermsDays", "Số ngày nợ"),
    customerId: optStr(formData, "customerId"),
    note: optStr(formData, "note"),
  };
}

export async function saveDealerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let target = "";
  const result = await form(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "dealerId");
    if (id) {
      await updateDealer(id, dealerInput(formData), staff);
      revalidatePath(`/admin/ban-hang/dai-ly/${id}`);
      return ok("Đã lưu.");
    }
    const r = await createDealer(dealerInput(formData), staff);
    revalidatePath("/admin/ban-hang/dai-ly");
    target = `/admin/ban-hang/dai-ly/${r.id}`;
    return ok(`Đã tạo đại lý ${r.code}.`);
  });
  if (target) redirect(target);
  return result;
}

export async function dealerStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.write");
    const id = str(formData, "dealerId");
    await setDealerStatus(id, str(formData, "status") as DealerStatus, staff);
    revalidatePath(`/admin/ban-hang/dai-ly/${id}`);
    return ok("Đã đổi trạng thái.");
  });
}

// ---------------------------------------------------------------------------------------------
// Kênh, bảng giá, combo, voucher (sales.pricing)

export async function saveChannelAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.pricing");
    const code = str(formData, "code").toUpperCase();
    const data = {
      name: str(formData, "name"),
      feeRateBp: percent(formData, "feeRate", "Phí nền tảng"),
      payoutDays: int(formData, "payoutDays", "Số ngày tiền về"),
      priceListId: optStr(formData, "priceListId"),
      isActive: checked(formData, "isActive"),
      sort: int(formData, "sort", "Thứ tự"),
      note: optStr(formData, "note"),
    };
    if (str(formData, "mode") === "create") {
      await createChannel(code, { ...data, kind: str(formData, "kind") as ChannelKind }, staff);
    } else {
      await updateChannel(code, data, staff);
    }
    revalidatePath("/admin/ban-hang/kenh");
    return ok(`Đã lưu kênh ${code}.`);
  });
}

export async function savePriceListAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let target = "";
  const result = await form(async () => {
    const staff = await requirePermission("sales.pricing");
    const id = optStr(formData, "priceListId");
    const savedId = await savePriceList(
      id,
      {
        code: str(formData, "code").toUpperCase(),
        name: str(formData, "name"),
        kind: str(formData, "kind") as PriceListKind,
        channelCode: optStr(formData, "channelCode"),
        validFrom: isoDate(formData, "validFrom"),
        validTo: isoDate(formData, "validTo"),
        priority: int(formData, "priority", "Độ ưu tiên"),
        isActive: checked(formData, "isActive"),
        note: optStr(formData, "note"),
      },
      staff,
    );
    revalidatePath("/admin/ban-hang/bang-gia");
    if (!id) target = `/admin/ban-hang/bang-gia/${savedId}`;
    else revalidatePath(`/admin/ban-hang/bang-gia/${id}`);
    return ok("Đã lưu bảng giá.");
  });
  if (target) redirect(target);
  return result;
}

export async function priceItemAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.pricing");
    const id = str(formData, "priceListId");
    const productId = str(formData, "productId");
    if (!productId) return fail("Chọn sản phẩm");
    const minQty = int(formData, "minQty", "Số lượng từ", 1);
    const unitPrice = money(formData, "unitPrice", "Đơn giá");
    if (unitPrice <= 0) return fail("Đơn giá phải lớn hơn 0");
    await upsertPriceListItem(id, { productId, minQty, unitPrice }, staff);
    revalidatePath(`/admin/ban-hang/bang-gia/${id}`);
    return ok("Đã lưu giá.");
  });
}

export async function deletePriceItemAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.pricing");
    const listId = await deletePriceListItem(str(formData, "itemId"), staff);
    if (listId) revalidatePath(`/admin/ban-hang/bang-gia/${listId}`);
    return ok("Đã xóa dòng giá.");
  });
}

export async function saveBundleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.pricing");
    const productIds = formData.getAll("bundleProductId").map(String);
    const qtys = formData.getAll("bundleProductQty").map(String);
    await saveBundle(
      optStr(formData, "bundleId"),
      {
        code: str(formData, "code"),
        name: str(formData, "name"),
        price: money(formData, "price", "Giá combo"),
        channelCode: optStr(formData, "channelCode"),
        isActive: checked(formData, "isActive"),
        note: optStr(formData, "note"),
        items: productIds.map((productId, i) => ({ productId, qty: Number(qtys[i] ?? "0") })).filter((i) => i.productId && i.qty > 0),
      },
      staff,
    );
    revalidatePath("/admin/ban-hang/bang-gia");
    return ok("Đã lưu combo.");
  });
}

function vnDateTime(formData: FormData, key: string, endOfDay: boolean): Date | null {
  const d = isoDate(formData, key);
  if (!d) return null;
  return new Date(`${d}T${endOfDay ? "23:59:59" : "00:00:00"}+07:00`);
}

export async function saveVoucherAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return form(async () => {
    const staff = await requirePermission("sales.pricing");
    const kind = str(formData, "kind") === "amount" ? "amount" : "percent";
    const value = kind === "percent" ? percent(formData, "value", "Mức giảm") : money(formData, "value", "Mức giảm");
    const usage = str(formData, "usageLimit");
    await saveVoucher(
      optStr(formData, "voucherId"),
      {
        code: str(formData, "code"),
        kind,
        value,
        minOrder: money(formData, "minOrder", "Đơn tối thiểu"),
        maxDiscount: optMoney(formData, "maxDiscount", "Giảm tối đa"),
        channelCode: optStr(formData, "channelCode"),
        validFrom: vnDateTime(formData, "validFrom", false),
        validTo: vnDateTime(formData, "validTo", true),
        usageLimit: usage === "" ? null : int(formData, "usageLimit", "Số lượt"),
        isActive: checked(formData, "isActive"),
      },
      staff,
    );
    revalidatePath("/admin/ban-hang/bang-gia");
    return ok("Đã lưu mã giảm giá.");
  });
}
