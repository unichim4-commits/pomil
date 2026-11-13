"use server";

// Server Action của phân hệ Sản xuất (02-san-xuat.md). Mỗi action: requirePermission → một giao dịch → revalidate.
// Service kiểm quyền lần nữa (assertCan) và ghi audit.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, type Tx } from "@/db/client";
import { inventoryItems, stockLots } from "@/db/schema";
import { formatVnd } from "@/lib/format";
import { UserError } from "@/lib/errors";
import type { Permission } from "@/modules/auth/rules";
import { can } from "@/modules/auth/rules";
import { requirePermission } from "@/modules/auth/service";
import type { Actor } from "@/modules/production/access";
import { cancelRun, completeRun, createRun, issuePeel, startRun, updateRunCosts, type RunInput } from "@/modules/production/extraction";
import {
  changeVersionStatus,
  createFormula,
  createNextVersion,
  removeFormulaLine,
  removePackaging,
  updateVersionParams,
  upsertFormulaLine,
  upsertPackaging,
  type VersionParams,
} from "@/modules/production/formulas";
import {
  addMaterialLine,
  addStep,
  approveOrder,
  cancelOrder,
  completeOrder,
  createOrder,
  createOrderFromPlanLine,
  finishStep,
  issueMaterial,
  planOrder,
  recordOutput,
  removeMaterialLine,
  removeStep,
  requestStepIpqc,
  returnMaterial,
  setCostLock,
  setMaterialSource,
  skipStep,
  startOrder,
  startStep,
  unplanOrder,
  updateOrder,
  updateOrderCosts,
  type OrderInput,
} from "@/modules/production/orders";
import { addPlanLine, createPlan, removePlanLine, setPlanStatus } from "@/modules/production/plans";
import { EXTRACTION_METHOD_LABEL, ORDER_STATUS_LABEL, parseParams, PLAN_STATUS_LABEL, VERSION_STATUS_LABEL, type FormulaVersionStatus, type PlanStatus, type ProductionKind } from "@/modules/production/rules";
import { guard, ok, type ActionResult } from "../_lib/result";
import { actorOf } from "./_lib/data";
import { bpOf, dateOf, idOf, intOf, moneyOf, optDateOf, optIdOf, optMoneyOf, optText, percentOf, qtyOf, text } from "./_lib/form";

const BASE = "/admin/san-xuat";

// Chạy một thao tác ghi trong giao dịch; trả câu báo thành công
async function run(permission: Permission, fn: (tx: Tx, actor: Actor) => Promise<string>, paths: string[] = [BASE]): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission(permission);
    const db = await getDb();
    const message = await db.transaction((tx) => fn(tx, actorOf(staff)));
    for (const p of paths) revalidatePath(p, "layout");
    return ok(message);
  });
}

async function displayUomOf(tx: Tx, itemId: string): Promise<{ code: string; displayUom: string }> {
  const [it] = await tx.select({ code: inventoryItems.code, displayUom: inventoryItems.displayUom }).from(inventoryItems).where(eq(inventoryItems.id, itemId)).limit(1);
  if (!it) throw new UserError("Không tìm thấy hàng hóa");
  return it;
}

function kindOf(fd: FormData): ProductionKind {
  const k = text(fd, "kind");
  if (k !== "in_house" && k !== "outsourced") throw new UserError("Chọn loại");
  return k;
}

// ---------------------------------------------------------------------------------------------
// Công thức (formulas.write)

function versionParams(fd: FormData): VersionParams {
  const unit = text(fd, "batchUnit");
  if (unit !== "l" && unit !== "kg") throw new UserError("Chọn đơn vị cỡ mẻ");
  const batchSize = qtyOf(text(fd, "batchSize"), unit, "Cỡ mẻ");
  const density = text(fd, "density");
  return {
    batchSize,
    batchUom: unit === "l" ? "ul" : "mg",
    bulkDensityMgPerMl: density ? intOf(density, "Khối lượng riêng (mg/ml)", { min: 1 }) : null,
    expectedYieldBp: bpOf(text(fd, "yield") || "100", "Hiệu suất dự kiến"),
    processNote: text(fd, "processNote"),
  };
}

export async function createFormulaAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const r = await run("formulas.write", async (tx, actor) => {
    const res = await createFormula(tx, actor, { name: text(fd, "name"), productId: optIdOf(fd, "productId"), note: optText(fd, "note"), ...versionParams(fd) });
    id = res.formulaId;
    return `Đã tạo ${res.code}, phiên bản ${res.label}`;
  });
  if (id) redirect(`${BASE}/cong-thuc/${id}`);
  return r;
}

export async function saveVersionParamsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("formulas.write", async (tx, actor) => {
    await updateVersionParams(tx, actor, idOf(fd, "versionId"), versionParams(fd));
    return "Đã lưu thông số mẻ";
  });
}

export async function saveFormulaLineAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("formulas.write", async (tx, actor) => {
    const isBalance = fd.get("isBalance") === "on";
    await upsertFormulaLine(tx, actor, idOf(fd, "versionId"), {
      itemId: idOf(fd, "itemId", "Hàng"),
      ppm: isBalance ? 0 : percentOf(text(fd, "percent"), "Tỷ lệ"),
      isBalance,
      phase: text(fd, "phase"),
      note: optText(fd, "note"),
    });
    return "Đã lưu dòng công thức";
  });
}

export async function removeFormulaLineAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("formulas.write", async (tx, actor) => {
    await removeFormulaLine(tx, actor, idOf(fd));
    return "Đã bỏ dòng";
  });
}

export async function savePackagingAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("formulas.write", async (tx, actor) => {
    const itemId = idOf(fd, "itemId", "Hàng");
    const it = await displayUomOf(tx, itemId);
    await upsertPackaging(tx, actor, idOf(fd, "versionId"), { itemId, qtyPerUnit: qtyOf(text(fd, "qty") || "1", it.displayUom, "Định mức mỗi chai"), note: optText(fd, "note") });
    return `Đã lưu định mức bao bì ${it.code}`;
  });
}

export async function removePackagingAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("formulas.write", async (tx, actor) => {
    await removePackaging(tx, actor, idOf(fd));
    return "Đã bỏ dòng bao bì";
  });
}

export async function changeVersionStatusAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("formulas.write", async (tx, actor) => {
    const to = text(fd, "to") as FormulaVersionStatus;
    if (!(to in VERSION_STATUS_LABEL)) throw new UserError("Trạng thái không hợp lệ");
    await changeVersionStatus(tx, actor, idOf(fd, "versionId"), to);
    return `Đã chuyển sang ${VERSION_STATUS_LABEL[to]}`;
  });
}

export async function createNextVersionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("formulas.write", async (tx, actor) => {
    const r = await createNextVersion(tx, actor, idOf(fd, "versionId"), text(fd, "changeNote"));
    return `Đã tạo ${r.label} (bản nháp)`;
  });
}

// ---------------------------------------------------------------------------------------------
// Kế hoạch (production.write)

export async function createPlanAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const r = await run("production.write", async (tx, actor) => {
    const period = text(fd, "period") as "day" | "week" | "month";
    const res = await createPlan(tx, actor, { period, periodStart: dateOf(fd, "periodStart", "ngày bắt đầu"), periodEnd: dateOf(fd, "periodEnd", "ngày kết thúc"), note: optText(fd, "note") });
    id = res.id;
    return `Đã tạo ${res.code}`;
  });
  if (id) redirect(`${BASE}/ke-hoach/${id}`);
  return r;
}

export async function addPlanLineAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("production.write", async (tx, actor) => {
    await addPlanLine(tx, actor, idOf(fd, "planId"), {
      productId: idOf(fd, "productId", "Sản phẩm"),
      formulaVersionId: optIdOf(fd, "formulaVersionId"),
      targetUnits: intOf(text(fd, "targetUnits"), "Số chai", { min: 1 })!,
      plannedStart: optDateOf(fd, "plannedStart"),
      note: optText(fd, "note"),
    });
    return "Đã thêm dòng kế hoạch";
  });
}

export async function removePlanLineAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("production.write", async (tx, actor) => {
    await removePlanLine(tx, actor, idOf(fd));
    return "Đã bỏ dòng";
  });
}

export async function setPlanStatusAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("production.write", async (tx, actor) => {
    const to = text(fd, "to") as PlanStatus;
    if (!(to in PLAN_STATUS_LABEL)) throw new UserError("Trạng thái không hợp lệ");
    await setPlanStatus(tx, actor, idOf(fd, "planId"), to);
    return `Kế hoạch: ${PLAN_STATUS_LABEL[to]}`;
  });
}

export async function createOrderFromPlanLineAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const r = await run("production.write", async (tx, actor) => {
    const kind = kindOf(fd);
    const res = await createOrderFromPlanLine(tx, actor, idOf(fd, "lineId"), {
      kind,
      supplierId: kind === "outsourced" ? optIdOf(fd, "supplierId") : null,
      outsourcingUnitPrice: kind === "outsourced" ? optMoneyOf(fd, "unitPrice", "Đơn giá gia công") : null,
    });
    id = res.id;
    return `Đã tạo lệnh ${res.code}`;
  });
  if (id) redirect(`${BASE}/lenh/${id}`);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Lệnh sản xuất

function orderInput(fd: FormData): OrderInput {
  const kind = kindOf(fd);
  return {
    kind,
    productId: idOf(fd, "productId", "Sản phẩm"),
    formulaVersionId: optIdOf(fd, "formulaVersionId"),
    formulaLabel: optText(fd, "formulaLabel"),
    supplierId: kind === "outsourced" ? optIdOf(fd, "supplierId") : null,
    outsourcingUnitPrice: kind === "outsourced" ? optMoneyOf(fd, "unitPrice", "Đơn giá gia công") : null,
    plannedUnits: intOf(text(fd, "plannedUnits"), "Số chai kế hoạch", { min: 1 })!,
    plannedStart: optDateOf(fd, "plannedStart"),
    plannedEnd: optDateOf(fd, "plannedEnd"),
    note: optText(fd, "note"),
  };
}

export async function createOrderAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const r = await run("production.write", async (tx, actor) => {
    const res = await createOrder(tx, actor, orderInput(fd));
    id = res.id;
    return `Đã tạo lệnh ${res.code}`;
  });
  if (id) redirect(`${BASE}/lenh/${id}`);
  return r;
}

export async function updateOrderAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("production.write", async (tx, actor) => {
    await updateOrder(tx, actor, idOf(fd), orderInput(fd));
    return "Đã lưu lệnh";
  });
}

export async function moveOrderAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const to = text(fd, "to");
  const perm: Permission = to === "approved" ? "production.approve" : "production.write";
  return run(perm, async (tx, actor) => {
    const id = idOf(fd);
    switch (to) {
      case "planned":
        await planOrder(tx, actor, id);
        return "Đã lên kế hoạch, định mức và công đoạn đã sinh";
      case "draft":
        await unplanOrder(tx, actor, id);
        return "Đã đưa về nháp";
      case "approved": {
        const r = await approveOrder(tx, actor, id);
        const parts = ["Đã duyệt lệnh"];
        if (can(actor.role, "finance.view")) parts.push(`giá thành kế hoạch ${formatVnd(r.plannedCost)}`);
        if (r.missingPrice.length) parts.push(`thiếu giá tham chiếu: ${r.missingPrice.join(", ")}`);
        if (r.shortages.length) parts.push(`cảnh báo thiếu: ${r.shortages.join("; ")}`);
        return parts.join(" · ");
      }
      case "in_progress":
        await startOrder(tx, actor, id);
        return "Đã bắt đầu sản xuất";
      case "completed": {
        const r = await completeOrder(tx, actor, id);
        return r.qcResult === "pass" ? "Đã hoàn thành, lô đạt FQC" : "Đã hoàn thành, lô không đạt FQC";
      }
      default:
        throw new UserError(`Không chuyển được sang ${ORDER_STATUS_LABEL[to as keyof typeof ORDER_STATUS_LABEL] ?? to}`);
    }
  });
}

export async function cancelOrderAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("production.write", async (tx, actor) => {
    const r = await cancelOrder(tx, actor, idOf(fd), text(fd, "reason"));
    return r.leftoverValue > 0 && can(actor.role, "finance.view") ? `Đã hủy lệnh. NVL không trả về tính hao hụt do hủy lệnh: ${formatVnd(r.leftoverValue)}` : "Đã hủy lệnh";
  });
}

export async function addMaterialAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("production.write", async (tx, actor) => {
    const itemId = idOf(fd, "itemId", "Hàng");
    const it = await displayUomOf(tx, itemId);
    const raw = text(fd, "qty");
    await addMaterialLine(tx, actor, idOf(fd), { itemId, plannedQty: raw ? qtyOf(raw, it.displayUom, "Lượng kế hoạch") : 0, note: optText(fd, "note") });
    return `Đã thêm ${it.code} vào định mức`;
  });
}

export async function removeMaterialAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("production.write", async (tx, actor) => {
    await removeMaterialLine(tx, actor, idOf(fd));
    return "Đã bỏ dòng định mức";
  });
}

export async function setMaterialSourceAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("production.write", async (tx, actor) => {
    const src = text(fd, "source");
    if (src !== "pomil" && src !== "factory") throw new UserError("Chọn nguồn cấp");
    await setMaterialSource(tx, actor, idOf(fd), src);
    return src === "pomil" ? "Pomil cấp dòng này" : "Nhà máy tự cấp dòng này";
  });
}

export async function issueMaterialAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "production.write",
    async (tx, actor) => {
      const itemId = idOf(fd, "itemId", "Hàng");
      const it = await displayUomOf(tx, itemId);
      const r = await issueMaterial(tx, actor, idOf(fd), { itemId, qty: qtyOf(text(fd, "qty"), it.displayUom, `Lượng xuất ${it.code}`), stockLotId: optIdOf(fd, "stockLotId"), reason: optText(fd, "reason") });
      return `Đã xuất ${it.code}, phiếu ${r.issueCode}`;
    },
    [BASE, "/admin/kho"],
  );
}

export async function returnMaterialAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "production.write",
    async (tx, actor) => {
      const stockLotId = idOf(fd, "stockLotId", "Lô");
      const [lot] = await tx.select({ itemId: stockLots.itemId }).from(stockLots).where(eq(stockLots.id, stockLotId)).limit(1);
      if (!lot) throw new UserError("Không tìm thấy lô");
      const it = await displayUomOf(tx, lot.itemId);
      const r = await returnMaterial(tx, actor, idOf(fd), { stockLotId, qty: qtyOf(text(fd, "qty"), it.displayUom, "Lượng trả") });
      return `Đã trả về kho, phiếu ${r.receiptCode}`;
    },
    [BASE, "/admin/kho"],
  );
}

export async function addStepAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("production.write", async (tx, actor) => {
    await addStep(tx, actor, idOf(fd), { name: text(fd, "name"), needsQc: fd.get("needsQc") === "on" });
    return "Đã thêm công đoạn";
  });
}

export async function stepAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("production.write", async (tx, actor) => {
    const stepId = idOf(fd, "stepId");
    switch (text(fd, "op")) {
      case "start":
        await startStep(tx, actor, stepId);
        return "Đã bắt đầu công đoạn";
      case "finish":
        await finishStep(tx, actor, stepId, optText(fd, "note"));
        return "Đã xong công đoạn";
      case "skip":
        await skipStep(tx, actor, stepId, text(fd, "note"));
        return "Đã bỏ qua công đoạn";
      case "ipqc": {
        const r = await requestStepIpqc(tx, actor, stepId);
        return `Đã lập phiếu IPQC ${r.code}`;
      }
      case "remove":
        await removeStep(tx, actor, stepId);
        return "Đã bỏ công đoạn";
      default:
        throw new UserError("Thao tác không hợp lệ");
    }
  });
}

export async function recordOutputAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "production.write",
    async (tx, actor) => {
      const bulkRaw = text(fd, "actualBulk");
      const bulkUnit = text(fd, "bulkUnit") || "l";
      const r = await recordOutput(tx, actor, idOf(fd), {
        goodUnits: intOf(text(fd, "goodUnits"), "Số chai đạt", { min: 1 })!,
        rejectedUnits: intOf(text(fd, "rejectedUnits") || "0", "Số chai lỗi", { min: 0 })!,
        manufacturedOn: optDateOf(fd, "manufacturedOn"),
        expiresOn: optDateOf(fd, "expiresOn"),
        actualBulk: bulkRaw ? qtyOf(bulkRaw, bulkUnit, "Lượng bán thành phẩm thực tế") : null,
        outsourcingCost: can(actor.role, "finance.view") ? optMoneyOf(fd, "outsourcingCost", "Chi phí gia công") : null,
        lotNo: optText(fd, "lotNo"),
      });
      const parts = [`Đã ghi sản lượng: lô ${r.lotNo} cách ly, phiếu FQC ${r.fqcCode}`];
      if (r.payableCode) parts.push(`công nợ ${r.payableCode}`);
      return parts.join(" · ");
    },
    [BASE, "/admin/kho", "/admin/lo", "/admin/chat-luong", "/admin/tai-chinh"],
  );
}

export async function updateOrderCostsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "finance.view",
    async (tx, actor) => {
      const r = await updateOrderCosts(tx, actor, idOf(fd), {
        laborCost: moneyOf(fd, "laborCost", "Nhân công"),
        overheadCost: moneyOf(fd, "overheadCost", "Chi phí chung"),
        otherCost: moneyOf(fd, "otherCost", "Chi phí khác"),
        outsourcingCost: optMoneyOf(fd, "outsourcingCost", "Chi phí gia công"),
        reason: optText(fd, "reason"),
      });
      return `Đã lưu chi phí, giá thành ${formatVnd(r.total)}`;
    },
    [BASE, "/admin/tai-chinh"],
  );
}

export async function setCostLockAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "finance.approve",
    async (tx, actor) => {
      const lock = text(fd, "lock") === "1";
      await setCostLock(tx, actor, idOf(fd), lock, optText(fd, "reason"));
      return lock ? "Đã chốt giá vốn lệnh" : "Đã mở chốt giá vốn";
    },
    [BASE, "/admin/tai-chinh"],
  );
}

// ---------------------------------------------------------------------------------------------
// Mẻ chiết

function runInput(fd: FormData): RunInput {
  const kind = kindOf(fd);
  const method = text(fd, "method") as RunInput["method"];
  if (!(method in EXTRACTION_METHOD_LABEL)) throw new UserError("Chọn phương pháp");
  const params = parseParams(text(fd, "params"));
  if (!params.ok) throw new UserError(params.message);
  return {
    kind,
    pomeloVariety: text(fd, "pomeloVariety"),
    sourceSupplierId: optIdOf(fd, "sourceSupplierId"),
    harvestOn: optDateOf(fd, "harvestOn"),
    peelCondition: text(fd, "peelCondition"),
    method,
    equipment: text(fd, "equipment"),
    operatorName: text(fd, "operatorName"),
    serviceSupplierId: kind === "outsourced" ? optIdOf(fd, "serviceSupplierId") : null,
    serviceFee: kind === "outsourced" ? moneyOf(fd, "serviceFee", "Phí thuê lò") : 0,
    otherCost: moneyOf(fd, "otherCost", "Chi phí khác"),
    params: params.params,
    outputItemId: idOf(fd, "outputItemId", "Hàng đầu ra"),
    note: optText(fd, "note"),
  };
}

export async function createRunAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const r = await run("production.write", async (tx, actor) => {
    const res = await createRun(tx, actor, runInput(fd));
    id = res.id;
    return `Đã tạo mẻ ${res.code}`;
  });
  if (id) redirect(`${BASE}/chiet-xuat/${id}`);
  return r;
}

export async function runOpAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "production.write",
    async (tx, actor) => {
      const id = idOf(fd);
      switch (text(fd, "op")) {
        case "start":
          await startRun(tx, actor, id);
          return "Đã bắt đầu mẻ";
        case "cancel": {
          const r = await cancelRun(tx, actor, id, text(fd, "reason"));
          return r.leftoverValue > 0 && can(actor.role, "finance.view") ? `Đã hủy mẻ, vỏ đã xuất tính hao hụt ${formatVnd(r.leftoverValue)}` : "Đã hủy mẻ";
        }
        default:
          throw new UserError("Thao tác không hợp lệ");
      }
    },
    [BASE, "/admin/kho"],
  );
}

export async function issuePeelAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "production.write",
    async (tx, actor) => {
      const itemId = idOf(fd, "itemId", "Hàng");
      const it = await displayUomOf(tx, itemId);
      const r = await issuePeel(tx, actor, idOf(fd), { itemId, qty: qtyOf(text(fd, "qty"), it.displayUom, `Lượng xuất ${it.code}`), stockLotId: optIdOf(fd, "stockLotId") });
      return `Đã xuất ${it.code}, phiếu ${r.issueCode}`;
    },
    [BASE, "/admin/kho"],
  );
}

export async function completeRunAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "production.write",
    async (tx, actor) => {
      const unit = text(fd, "unit");
      const r = await completeRun(tx, actor, idOf(fd), { outputQty: qtyOf(text(fd, "outputQty"), unit, "Lượng đầu ra") });
      const parts = [`Đã hoàn thành mẻ: lô ${r.lotCode} chờ IPQC`];
      if (r.payableCode) parts.push(`công nợ ${r.payableCode}`);
      return parts.join(" · ");
    },
    [BASE, "/admin/kho", "/admin/chat-luong", "/admin/tai-chinh"],
  );
}

export async function updateRunCostsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "finance.view",
    async (tx, actor) => {
      const r = await updateRunCosts(tx, actor, idOf(fd), { serviceFee: moneyOf(fd, "serviceFee", "Phí thuê lò"), otherCost: moneyOf(fd, "otherCost", "Chi phí khác"), reason: text(fd, "reason") });
      return `Đã lưu chi phí, giá thành mẻ ${formatVnd(r.totalCost)}`;
    },
    [BASE, "/admin/kho", "/admin/tai-chinh"],
  );
}
