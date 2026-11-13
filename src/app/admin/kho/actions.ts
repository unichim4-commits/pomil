"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import { inventoryItems, stockCountLines, stockIssues, stockLots, stockReceipts, warehouseLocations } from "@/db/schema";
import { UserError } from "@/lib/errors";
import { can } from "@/modules/auth/rules";
import { requirePermission, requireStaff } from "@/modules/auth/service";
import { saveImage } from "@/modules/files/service";
import {
  cancelTransferDraft,
  createLocation,
  createRetainedSampleFromIssue,
  createWarehouse,
  saveFinishedItem,
  saveItem,
  saveSupplier,
  setLocationActive,
  setWarehouseActive,
  updateReceiptLineCost,
} from "@/modules/inventory/admin";
import { cancelStockCount, createStockCount, postStockCount, saveStockCountQty } from "@/modules/inventory/counts";
import {
  cancelReceipt,
  createIssueDraft,
  createReceiptDraft,
  createTransferDraft,
  enableInventoryTracking,
  postIssueDraft,
  postReceiptDraft,
  postTransferDraft,
  rejectIssue,
  setStockLotQcStatus,
  submitIssue,
} from "@/modules/inventory/ledger";
import { parseQty, type BaseUom, type DisplayUom, type IssueInput, type ReceiptInput, type ReceiptLineInput, type WarehouseKind } from "@/modules/inventory/rules";
import { fail, guard, ok, type ActionResult } from "../_lib/result";
import { field, LINE_ROWS, lineCostFrom, moneyOf, optDate, optField, optId, qtyOf } from "./_lib/form";

async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

function intOpt(raw: string, label: string, min = 0): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min) throw new UserError(`${label} không hợp lệ`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// Hàng hóa

const ITEM_KINDS = ["raw_material", "extract", "packaging", "wip", "other"] as const;
const BASES = ["mg", "ul", "pcs"] as const;

export async function saveItemAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id");
    const kind = field(fd, "kind") as (typeof ITEM_KINDS)[number];
    if (!ITEM_KINDS.includes(kind)) return fail("Chọn nhóm hàng");
    const baseUom = field(fd, "baseUom") as BaseUom;
    if (!BASES.includes(baseUom)) return fail("Chọn đơn vị cơ sở");
    const displayUom = field(fd, "displayUom");
    const minRaw = field(fd, "minStock");
    let minStock: number | null = null;
    if (minRaw) {
      const q = parseQty(minRaw, displayUom as DisplayUom);
      if (!q.ok) return fail(`Tồn tối thiểu: ${q.message}`);
      minStock = q.qty;
    }
    const r = await inTx((tx) =>
      saveItem(
        tx,
        id,
        {
          code: field(fd, "code"),
          name: field(fd, "name"),
          kind,
          groupName: field(fd, "groupName"),
          baseUom,
          displayUom,
          purchaseUom: field(fd, "purchaseUom"),
          spec: field(fd, "spec"),
          refUnitPrice: moneyOf(field(fd, "refUnitPrice"), "Giá tham chiếu"),
          defaultSupplierId: optId(fd, "defaultSupplierId"),
          defaultWarehouseId: optId(fd, "defaultWarehouseId"),
          shelfLifeDays: intOpt(field(fd, "shelfLifeDays"), "Hạn dùng mặc định", 1),
          storageCondition: field(fd, "storageCondition"),
          minStock,
          requiresIqc: fd.get("requiresIqc") === "on",
          densityMgPerMl: intOpt(field(fd, "densityMgPerMl"), "Khối lượng riêng", 1),
          isActive: id ? fd.get("isActive") === "on" : true,
          note: optField(fd, "note"),
        },
        staff.id,
      ),
    );
    revalidatePath("/admin/kho/hang-hoa");
    if (!id) createdId = r.id;
    return ok(`Đã lưu ${r.code}`);
  });
  if (createdId) redirect(`/admin/kho/hang-hoa/${createdId}`);
  return result;
}

export async function saveFinishedItemAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    const minRaw = field(fd, "minStock");
    let minStock: number | null = null;
    if (minRaw) {
      const q = parseQty(minRaw, "chai");
      if (!q.ok) return fail(`Tồn tối thiểu: ${q.message}`);
      minStock = q.qty;
    }
    await inTx((tx) => saveFinishedItem(tx, id, { groupName: field(fd, "groupName"), spec: field(fd, "spec"), storageCondition: field(fd, "storageCondition"), minStock, note: optField(fd, "note") }, staff.id));
    revalidatePath(`/admin/kho/hang-hoa/${id}`);
    return ok("Đã lưu");
  });
}

// Bật/tắt quản lý tồn theo kho cho sản phẩm (R-KHO-25)
export async function toggleTrackingAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.approve");
    const productId = optId(fd, "productId");
    if (!productId) return fail("Thiếu sản phẩm");
    const on = field(fd, "on") === "1";
    const r = await enableInventoryTracking(productId, on, staff.id);
    revalidatePath("/admin/san-pham");
    revalidatePath(`/admin/san-pham/${productId}`);
    revalidatePath("/admin/kho/hang-hoa", "layout");
    return ok(on ? `Đã bật quản lý tồn theo kho. Số bán được: ${r.before} → ${r.after}.` : `Đã tắt. Số bán được giữ ${r.after}.`);
  });
}

// ---------------------------------------------------------------------------------------------
// Nhà cung cấp

const SUPPLIER_KINDS = ["material", "packaging", "factory", "farm", "service", "other"] as const;

export async function saveSupplierAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id");
    const kind = field(fd, "kind") as (typeof SUPPLIER_KINDS)[number];
    if (!SUPPLIER_KINDS.includes(kind)) return fail("Chọn loại nhà cung cấp");
    const r = await inTx((tx) =>
      saveSupplier(
        tx,
        id,
        {
          code: optField(fd, "code"),
          name: field(fd, "name"),
          kind,
          contactName: optField(fd, "contactName"),
          phone: optField(fd, "phone"),
          email: optField(fd, "email"),
          address: optField(fd, "address"),
          taxCode: optField(fd, "taxCode"),
          paymentTermsDays: intOpt(field(fd, "paymentTermsDays"), "Hạn trả") ?? 0,
          qualified: fd.get("qualified") === "on",
          note: optField(fd, "note"),
          isActive: id ? fd.get("isActive") === "on" : true,
        },
        staff.id,
      ),
    );
    revalidatePath("/admin/kho/nha-cung-cap");
    if (!id) createdId = r.id;
    return ok(`Đã lưu ${r.code}`);
  });
  if (createdId) redirect(`/admin/kho/nha-cung-cap/${createdId}`);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Kho và vị trí (inventory.approve)

const WH_KINDS = ["raw", "extract", "packaging", "wip", "finished", "rejected"] as const;

export async function createWarehouseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.approve");
    const kind = field(fd, "kind") as WarehouseKind;
    if (!WH_KINDS.includes(kind)) return fail("Chọn loại kho");
    await inTx((tx) => createWarehouse(tx, { code: field(fd, "code"), name: field(fd, "name"), kind, address: optField(fd, "address") }, staff.id));
    revalidatePath("/admin/kho/cai-dat");
    return ok("Đã thêm kho, kèm vị trí CHUNG");
  });
}

export async function toggleWarehouseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.approve");
    const on = field(fd, "on") === "1";
    await inTx((tx) => setWarehouseActive(tx, optId(fd, "id")!, on, staff.id));
    revalidatePath("/admin/kho/cai-dat");
    return ok(on ? "Đã dùng lại kho" : "Đã ngừng dùng kho");
  });
}

export async function createLocationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.approve");
    await inTx((tx) => createLocation(tx, { warehouseId: optId(fd, "warehouseId")!, code: field(fd, "code"), name: field(fd, "name") }, staff.id));
    revalidatePath("/admin/kho/cai-dat");
    return ok("Đã thêm vị trí");
  });
}

export async function toggleLocationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.approve");
    const on = field(fd, "on") === "1";
    await inTx((tx) => setLocationActive(tx, optId(fd, "id")!, on, staff.id));
    revalidatePath("/admin/kho/cai-dat");
    return ok(on ? "Đã dùng lại vị trí" : "Đã ngừng dùng vị trí");
  });
}

// ---------------------------------------------------------------------------------------------
// Phiếu nhập (R-KHO-13…R-KHO-16, R-KHO-30, R-KHO-37)

const RECEIPT_KINDS = ["purchase", "opening", "other"] as const;

async function loadItems(ids: string[]) {
  if (!ids.length) return new Map<string, typeof inventoryItems.$inferSelect>();
  const db = await getDb();
  const rows = await db.select().from(inventoryItems).where(inArray(inventoryItems.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

async function saveFiles(fd: FormData, staffId: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of fd.getAll("files")) {
    if (f instanceof File && f.size > 0) out.push(await saveImage(f, staffId));
  }
  if (out.length > 5) throw new UserError("Tối đa 5 ảnh chứng từ");
  return out;
}

export async function createReceiptAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("inventory.write");
    const kind = field(fd, "kind") as (typeof RECEIPT_KINDS)[number];
    if (!RECEIPT_KINDS.includes(kind)) return fail("Chọn loại phiếu nhập");
    const warehouseId = optId(fd, "warehouseId");
    if (!warehouseId) return fail("Chọn kho nhận");
    const receivedOn = optDate(fd, "receivedOn");
    if (!receivedOn) return fail("Chọn ngày nhập");
    const supplierId = optId(fd, "supplierId");
    const paymentMode = (kind === "opening" ? "none" : field(fd, "paymentMode") || (supplierId ? "payable" : "none")) as ReceiptInput["paymentMode"];
    if (!["payable", "paid_now", "none"].includes(paymentMode!)) return fail("Chọn cách trả tiền");
    if (paymentMode === "payable" && !supplierId && kind === "purchase") return fail("Ghi công nợ cần chọn nhà cung cấp");
    const payAccountId = paymentMode === "paid_now" ? optId(fd, "payAccountId") : null;
    if (paymentMode === "paid_now" && !payAccountId) return fail("Chọn tài khoản trả tiền");

    const itemIds = Array.from({ length: LINE_ROWS }, (_, i) => optId(fd, `item_${i}`)).filter((x): x is string => !!x);
    const items = await loadItems(itemIds);
    const lines: ReceiptLineInput[] = [];
    for (let i = 0; i < LINE_ROWS; i++) {
      const itemId = optId(fd, `item_${i}`);
      if (!itemId) continue;
      const item = items.get(itemId);
      if (!item) return fail(`Dòng ${i + 1}: không tìm thấy hàng`);
      if (!item.isActive) return fail(`Dòng ${i + 1}: hàng ${item.code} đã ngừng dùng`);
      const label = `Dòng ${i + 1} (${item.code})`;
      const qty = qtyOf(field(fd, `qty_${i}`), item.displayUom, label);
      const prechecked = kind === "opening" && fd.get(`pre_${i}`) === "on";
      const note = optField(fd, `note_${i}`);
      if (prechecked && !note) return fail(`${label}: ghi chú bắt buộc khi chọn "đã kiểm trước đó"`);
      lines.push({
        itemId,
        qty,
        lineCost: lineCostFrom(field(fd, `cost_${i}`), field(fd, `price_${i}`), qty, item.purchaseUom, label),
        locationId: optId(fd, `loc_${i}`),
        productLotId: item.kind === "finished" ? optId(fd, `plot_${i}`) : null,
        supplierLotNo: optField(fd, `slot_${i}`),
        manufacturedOn: optDate(fd, `mfg_${i}`),
        expiresOn: optDate(fd, `exp_${i}`),
        qcRequired: item.kind === "finished" ? false : prechecked ? false : item.requiresIqc,
        note,
      });
    }
    if (!lines.length) return fail("Thêm ít nhất một dòng hàng");
    const fileIds = await saveFiles(fd, staff.id);
    const r = await inTx((tx) =>
      createReceiptDraft(
        tx,
        { kind, warehouseId, supplierId, receivedOn, invoiceNo: optField(fd, "invoiceNo"), fileIds, paymentMode, payAccountId, note: optField(fd, "note"), lines },
        staff.id,
      ),
    );
    createdId = r.receiptId;
    return ok(`Đã lưu nháp ${r.code}`);
  });
  if (createdId) redirect(`/admin/kho/nhap/${createdId}`);
  return result;
}

export async function postReceiptAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    const db = await getDb();
    const [r] = await db.select({ kind: stockReceipts.kind }).from(stockReceipts).where(eq(stockReceipts.id, id));
    if (!r) return fail("Không tìm thấy phiếu nhập");
    if (r.kind === "opening" && !can(staff.role, "inventory.approve")) return fail("Phiếu tồn đầu kỳ cần chủ cửa hàng ghi sổ");
    await inTx((tx) => postReceiptDraft(tx, id, staff.id));
    revalidatePath(`/admin/kho/nhap/${id}`);
    revalidatePath("/admin/kho");
    return ok("Đã ghi sổ phiếu nhập");
  });
}

export async function cancelReceiptAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    const db = await getDb();
    const [r] = await db.select({ status: stockReceipts.status, createdBy: stockReceipts.createdBy }).from(stockReceipts).where(eq(stockReceipts.id, id));
    if (!r) return fail("Không tìm thấy phiếu nhập");
    const approver = can(staff.role, "inventory.approve");
    // Nháp: người tạo hoặc chủ; đã ghi sổ: inventory.approve (R-KHO-16)
    if (r.status === "draft" ? !(approver || r.createdBy === staff.id) : !approver) return fail("Tài khoản của bạn không có quyền làm việc này.");
    const reason = field(fd, "reason") || (r.status === "draft" ? "Xóa nháp" : "");
    const res = await inTx((tx) => cancelReceipt(tx, id, reason, staff.id));
    revalidatePath(`/admin/kho/nhap/${id}`);
    return ok(r.status === "draft" ? "Đã hủy nháp" : `Đã hủy phiếu, đảo ${res.reversed} dòng biến động`);
  });
}

export async function updateLineCostAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("finance.write");
    const lineId = optId(fd, "lineId")!;
    const cost = moneyOf(field(fd, "lineCost"), "Thành tiền");
    if (cost === null) return fail("Nhập thành tiền mới");
    const r = await inTx((tx) => updateReceiptLineCost(tx, lineId, cost, field(fd, "reason"), staff.id));
    revalidatePath(`/admin/kho/nhap/${field(fd, "receiptId")}`);
    const extra = [r.productionOrdersRecalculated.length ? `Đã tính lại giá lệnh ${r.productionOrdersRecalculated.join(", ")}.` : "", ...r.extractionReminders].filter(Boolean).join(" ");
    return ok(`Đã sửa giá. ${extra}`.trim());
  });
}

// ---------------------------------------------------------------------------------------------
// Phiếu xuất (R-KHO-11, R-KHO-17)

const ISSUE_KINDS = ["sample", "qc_sample", "scrap", "research", "supplier_return", "other"] as const;

export async function createIssueAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("inventory.write");
    const kind = field(fd, "kind") as (typeof ISSUE_KINDS)[number];
    if (!ISSUE_KINDS.includes(kind)) return fail("Chọn loại phiếu xuất");
    const db = await getDb();
    const lines: IssueInput["lines"] = [];
    for (let i = 0; i < LINE_ROWS; i++) {
      // Mỗi dòng: chọn lô cụ thể (pick = "lot:<lotId>:<locationId>") hoặc chọn hàng để FEFO
      const pick = field(fd, `pick_${i}`);
      const itemOnly = optId(fd, `item_${i}`);
      const raw = field(fd, `qty_${i}`);
      if (!pick && !itemOnly) continue;
      let itemId = itemOnly;
      let stockLotId: string | null = null;
      let locationId: string | null = null;
      if (pick) {
        const [, lotId, locId] = pick.split(":");
        const [lot] = await db.select({ itemId: stockLots.itemId }).from(stockLots).where(eq(stockLots.id, lotId ?? ""));
        if (!lot) return fail(`Dòng ${i + 1}: không tìm thấy lô`);
        itemId = lot.itemId;
        stockLotId = lotId!;
        locationId = locId || null;
      }
      const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId!));
      if (!item) return fail(`Dòng ${i + 1}: không tìm thấy hàng`);
      lines.push({ itemId: item.id, qty: qtyOf(raw, item.displayUom, `Dòng ${i + 1} (${item.code})`), stockLotId, locationId, note: optField(fd, `note_${i}`) });
    }
    if (!lines.length) return fail("Thêm ít nhất một dòng hàng");
    const fileIds = await saveFiles(fd, staff.id);
    const r = await inTx((tx) => createIssueDraft(tx, { kind, warehouseId: optId(fd, "warehouseId"), purpose: optField(fd, "purpose"), note: optField(fd, "note"), fileIds, lines }, staff.id));
    createdId = r.issueId;
    return ok(`Đã lưu nháp ${r.code}`);
  });
  if (createdId) redirect(`/admin/kho/xuat/${createdId}`);
  return result;
}

export async function submitIssueAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    await inTx((tx) => submitIssue(tx, id, staff.id));
    revalidatePath(`/admin/kho/xuat/${id}`);
    return ok("Đã gửi duyệt. Tồn chưa đổi tới khi chủ duyệt.");
  });
}

// Ghi sổ nháp hoặc duyệt phiếu chờ duyệt: chỉ inventory.approve (phiếu tay)
export async function postIssueAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.approve");
    const id = optId(fd, "id")!;
    await inTx((tx) => postIssueDraft(tx, id, staff.id));
    revalidatePath(`/admin/kho/xuat/${id}`);
    revalidatePath("/admin/kho");
    return ok("Đã ghi sổ phiếu xuất");
  });
}

export async function rejectIssueAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    const db = await getDb();
    const [is] = await db.select({ status: stockIssues.status, requestedBy: stockIssues.requestedBy }).from(stockIssues).where(eq(stockIssues.id, id));
    if (!is) return fail("Không tìm thấy phiếu xuất");
    const approver = can(staff.role, "inventory.approve");
    if (is.status === "pending_approval" ? !approver : !(approver || is.requestedBy === staff.id)) return fail("Tài khoản của bạn không có quyền làm việc này.");
    await inTx((tx) => rejectIssue(tx, id, field(fd, "reason"), staff.id));
    revalidatePath(`/admin/kho/xuat/${id}`);
    return ok(is.status === "pending_approval" ? "Đã từ chối phiếu" : "Đã hủy nháp");
  });
}

export async function retainedSampleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    const units = Number(field(fd, "units"));
    await inTx((tx) => createRetainedSampleFromIssue(tx, id, { productLotId: optId(fd, "productLotId")!, units, location: field(fd, "location"), keepUntil: field(fd, "keepUntil") }, staff.id));
    revalidatePath(`/admin/kho/xuat/${id}`);
    return ok("Đã ghi mẫu lưu");
  });
}

// ---------------------------------------------------------------------------------------------
// Điều chuyển (R-KHO-18)

export async function createTransferAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("inventory.write");
    const fromWarehouseId = optId(fd, "fromWarehouseId");
    const toWarehouseId = optId(fd, "toWarehouseId");
    if (!fromWarehouseId || !toWarehouseId) return fail("Chọn kho đi và kho đến");
    const db = await getDb();
    const lines: { stockLotId: string; qty: number; fromLocationId: string | null; toLocationId: string | null }[] = [];
    for (let i = 0; i < LINE_ROWS; i++) {
      const pick = field(fd, `pick_${i}`);
      if (!pick) continue;
      const [, lotId, locId] = pick.split(":");
      const [lot] = await db
        .select({ code: stockLots.code, displayUom: inventoryItems.displayUom })
        .from(stockLots)
        .innerJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
        .where(eq(stockLots.id, lotId ?? ""));
      if (!lot) return fail(`Dòng ${i + 1}: không tìm thấy lô`);
      if (locId) {
        const [loc] = await db.select({ warehouseId: warehouseLocations.warehouseId }).from(warehouseLocations).where(eq(warehouseLocations.id, locId));
        if (loc?.warehouseId !== fromWarehouseId) return fail(`Dòng ${i + 1}: lô ${lot.code} không nằm ở kho đi đã chọn`);
      }
      lines.push({ stockLotId: lotId!, qty: qtyOf(field(fd, `qty_${i}`), lot.displayUom, `Dòng ${i + 1} (${lot.code})`), fromLocationId: locId || null, toLocationId: optId(fd, `to_${i}`) });
    }
    if (!lines.length) return fail("Thêm ít nhất một dòng lô");
    const r = await inTx((tx) => createTransferDraft(tx, { fromWarehouseId, toWarehouseId, reason: field(fd, "reason"), lines }, staff.id));
    createdId = r.transferId;
    return ok(`Đã lưu nháp ${r.code}`);
  });
  if (createdId) redirect(`/admin/kho/dieu-chuyen/${createdId}`);
  return result;
}

export async function postTransferAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    await inTx((tx) => postTransferDraft(tx, id, staff.id));
    revalidatePath(`/admin/kho/dieu-chuyen/${id}`);
    return ok("Đã ghi sổ điều chuyển");
  });
}

export async function cancelTransferAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    await inTx((tx) => cancelTransferDraft(tx, id, staff.id));
    revalidatePath(`/admin/kho/dieu-chuyen/${id}`);
    return ok("Đã hủy nháp");
  });
}

// ---------------------------------------------------------------------------------------------
// Kiểm kê (R-KHO-19)

export async function createCountAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("inventory.write");
    const warehouseId = optId(fd, "warehouseId");
    if (!warehouseId) return fail("Chọn kho");
    const r = await inTx((tx) => createStockCount(tx, { warehouseId, countedOn: optDate(fd, "countedOn") ?? undefined, note: optField(fd, "note") }, staff.id));
    createdId = r.countId;
    return ok(`Đã tạo ${r.code} với ${r.lines} dòng`);
  });
  if (createdId) redirect(`/admin/kho/kiem-ke/${createdId}`);
  return result;
}

async function readCountEntries(fd: FormData, countId: string) {
  const db = await getDb();
  const lines = await db
    .select({ id: stockCountLines.id, displayUom: inventoryItems.displayUom, code: inventoryItems.code })
    .from(stockCountLines)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockCountLines.itemId))
    .where(eq(stockCountLines.countId, countId));
  return lines.map((l) => {
    const raw = field(fd, `c_${l.id}`);
    let countedQty: number | null = null;
    if (raw !== "") {
      const q = parseQty(raw, l.displayUom as DisplayUom);
      if (!q.ok) throw new UserError(`${l.code}: ${q.message}`);
      countedQty = q.qty;
    }
    return { lineId: l.id, countedQty, reason: optField(fd, `r_${l.id}`) };
  });
}

export async function saveCountAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    const entries = await readCountEntries(fd, id);
    await inTx((tx) => saveStockCountQty(tx, id, entries));
    revalidatePath(`/admin/kho/kiem-ke/${id}`);
    return ok("Đã lưu số đếm");
  });
}

export async function postCountAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    const entries = await readCountEntries(fd, id);
    const r = await inTx(async (tx) => {
      await saveStockCountQty(tx, id, entries);
      return postStockCount(tx, id, staff.id);
    });
    revalidatePath(`/admin/kho/kiem-ke/${id}`);
    revalidatePath("/admin/kho");
    return ok([`Đã ghi sổ, ${r.diffs} dòng chênh lệch.`, ...r.warnings].join("\n"));
  });
}

export async function cancelCountAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("inventory.write");
    const id = optId(fd, "id")!;
    await inTx((tx) => cancelStockCount(tx, id, staff.id));
    revalidatePath(`/admin/kho/kiem-ke/${id}`);
    return ok("Đã hủy phiếu kiểm kê");
  });
}

// ---------------------------------------------------------------------------------------------
// Khóa / mở khóa lô vật tư (R-KHO-36): khóa cần quality.write, mở khóa cần quality.approve

export async function lotHoldAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requireStaff();
    const id = optId(fd, "id")!;
    const hold = field(fd, "hold") === "1";
    await requirePermission(hold ? "quality.write" : "quality.approve");
    await inTx((tx) => setStockLotQcStatus(tx, id, hold ? "on_hold" : "released", optField(fd, "reason"), staff.id));
    revalidatePath(`/admin/kho/lo/${id}`);
    return ok(hold ? "Đã khóa lô" : "Đã mở khóa lô");
  });
}
