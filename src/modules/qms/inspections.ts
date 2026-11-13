// Chất lượng: phiếu kiểm dùng chung (00-tong-quan.md mục 8.3). Chữ ký do T-14a chốt; thân hàm do T-14b-C viết.
import { and, asc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { extractionRuns, inventoryItems, lots, productionOrderSteps, qcInspectionResults, qcInspections, qcStandardParams, qcStandards, stockLots } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { nextDocCode } from "@/modules/numbering/service";
import { INSPECTION_PREFIX, inspectionAppliesTo, isDeviationBlocking, pickStandard, type ItemKindKey } from "./inspection-rules";

export type InspectionStage = "iqc" | "ipqc" | "fqc" | "recheck";

type CreateInspectionInput = {
  stage: InspectionStage;
  stockLotId?: string | null;
  lotId?: string | null;
  receiptId?: string | null;
  receiptLineId?: string | null;
  productionOrderId?: string | null;
  productionStepId?: string | null;
  extractionRunId?: string | null;
  supplierId?: string | null;
  complaintId?: string | null;
  standardId?: string | null;
  note?: string | null;
};

// Phiếu đang chờ cùng đối tượng: theo lô kho / lô thành phẩm (chỉ mục duy nhất ở 3.6),
// IPQC không gắn lô thì theo công đoạn hoặc mẻ chiết (tránh tạo trùng khi bấm hai lần).
function pendingMatch(stage: InspectionStage, ref: { stockLotId: string | null; lotId: string | null; productionStepId: string | null; extractionRunId: string | null }): SQL | null {
  const base = [eq(qcInspections.stage, stage), eq(qcInspections.status, "pending")];
  if (ref.stockLotId) return and(...base, eq(qcInspections.stockLotId, ref.stockLotId))!;
  if (ref.lotId) return and(...base, eq(qcInspections.lotId, ref.lotId))!;
  if (stage === "ipqc" && ref.productionStepId) return and(...base, eq(qcInspections.productionStepId, ref.productionStepId), isNull(qcInspections.stockLotId))!;
  if (stage === "ipqc" && ref.extractionRunId) return and(...base, eq(qcInspections.extractionRunId, ref.extractionRunId), isNull(qcInspections.stockLotId))!;
  return null;
}

async function findPending(tx: Tx, where: SQL | null): Promise<{ id: string; code: string } | null> {
  if (!where) return null;
  const [row] = await tx.select({ id: qcInspections.id, code: qcInspections.code }).from(qcInspections).where(where).limit(1);
  return row ?? null;
}

// Chọn tiêu chuẩn tự động (R-CL-2), chụp chỉ tiêu vào qc_inspection_results (R-CL-1); đã có phiếu chờ thì trả created: false.
export async function createInspection(tx: Tx, input: CreateInspectionInput, actorId: string | null): Promise<{ id: string; code: string; created: boolean }> {
  const stage = input.stage;
  let stockLotId = input.stockLotId ?? null;
  let lotId = input.lotId ?? null;
  let productionOrderId = input.productionOrderId ?? null;
  const productionStepId = input.productionStepId ?? null;
  const extractionRunId = input.extractionRunId ?? null;
  let supplierId = input.supplierId ?? null;

  // Đối tượng kiểm: hàng (IQC/IPQC) hoặc sản phẩm (FQC/kiểm lại)
  let itemId: string | null = null;
  let itemKind: ItemKindKey | null = null;
  let productId: string | null = null;

  if (stockLotId) {
    const [sl] = await tx
      .select({ itemId: stockLots.itemId, supplierId: stockLots.supplierId, productLotId: stockLots.productLotId, kind: inventoryItems.kind, productId: inventoryItems.productId })
      .from(stockLots)
      .innerJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
      .where(eq(stockLots.id, stockLotId))
      .limit(1);
    if (!sl) throw new Error("Không tìm thấy lô kho");
    itemId = sl.itemId;
    itemKind = sl.kind;
    productId = sl.productId;
    supplierId ??= sl.supplierId;
    // Lô thành phẩm: FQC/kiểm lại gắn lots
    if ((stage === "fqc" || stage === "recheck") && sl.productLotId) {
      lotId ??= sl.productLotId;
      stockLotId = null;
    }
  }
  if (lotId) {
    const [lot] = await tx.select({ productId: lots.productId }).from(lots).where(eq(lots.id, lotId)).limit(1);
    if (!lot) throw new Error("Không tìm thấy lô thành phẩm");
    productId = lot.productId;
  }
  if (productionStepId) {
    const [step] = await tx.select({ productionOrderId: productionOrderSteps.productionOrderId }).from(productionOrderSteps).where(eq(productionOrderSteps.id, productionStepId)).limit(1);
    if (!step) throw new Error("Không tìm thấy công đoạn");
    if (productionOrderId && productionOrderId !== step.productionOrderId) throw new Error("Công đoạn không thuộc lệnh sản xuất này");
    productionOrderId = step.productionOrderId;
  }
  if (extractionRunId) {
    const [run] = await tx
      .select({ outputItemId: extractionRuns.outputItemId, kind: inventoryItems.kind })
      .from(extractionRuns)
      .innerJoin(inventoryItems, eq(inventoryItems.id, extractionRuns.outputItemId))
      .where(eq(extractionRuns.id, extractionRunId))
      .limit(1);
    if (!run) throw new Error("Không tìm thấy mẻ chiết");
    itemId ??= run.outputItemId;
    itemKind ??= run.kind;
  }

  // Bắt buộc đối tượng theo loại phiếu
  if (stage === "iqc" && !stockLotId) throw new Error("Phiếu IQC cần lô vật tư");
  if (stage === "ipqc" && !productionStepId && !extractionRunId) throw new Error("Phiếu IPQC cần công đoạn lệnh sản xuất hoặc mẻ chiết");
  if ((stage === "fqc" || stage === "recheck") && !lotId) throw new Error("Phiếu FQC hoặc kiểm lại cần lô thành phẩm");

  const where = pendingMatch(stage, { stockLotId, lotId, productionStepId, extractionRunId });
  const existing = await findPending(tx, where);
  if (existing) return { ...existing, created: false };

  // Tiêu chuẩn: chỉ định sẵn hoặc chọn tự động
  let standardId: string | null = null;
  if (input.standardId) {
    const [std] = await tx.select({ id: qcStandards.id, status: qcStandards.status }).from(qcStandards).where(eq(qcStandards.id, input.standardId)).limit(1);
    if (!std) throw new Error("Không tìm thấy tiêu chuẩn");
    if (std.status !== "active") throw new Error("Tiêu chuẩn chưa được duyệt hoặc đã ngừng dùng");
    standardId = std.id;
  } else {
    const appliesTo = inspectionAppliesTo({ stage, itemKind, extractionRunId });
    const byProduct = stage === "fqc" || stage === "recheck";
    const conds: SQL[] = [eq(qcStandards.appliesTo, appliesTo)];
    if (!byProduct && itemId) conds.push(eq(qcStandards.itemId, itemId));
    if (byProduct && productId) conds.push(eq(qcStandards.productId, productId));
    const candidates = await tx
      .select({
        id: qcStandards.id,
        status: qcStandards.status,
        appliesTo: qcStandards.appliesTo,
        itemId: qcStandards.itemId,
        productId: qcStandards.productId,
        effectiveFrom: qcStandards.effectiveFrom,
        code: qcStandards.code,
      })
      .from(qcStandards)
      .where(and(eq(qcStandards.status, "active"), or(...conds)));
    standardId = pickStandard(candidates, { stage, appliesTo, itemId, productId })?.id ?? null;
  }

  const code = await nextDocCode(tx, INSPECTION_PREFIX[stage]);
  const [row] = await tx
    .insert(qcInspections)
    .values({
      code,
      stage,
      standardId,
      stockReceiptId: input.receiptId ?? null,
      stockReceiptLineId: input.receiptLineId ?? null,
      stockLotId,
      lotId,
      productionOrderId,
      productionStepId,
      extractionRunId,
      supplierId,
      complaintId: input.complaintId ?? null,
      note: input.note ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: qcInspections.id, code: qcInspections.code });
  if (!row) {
    // Giao dịch khác vừa tạo phiếu chờ cho cùng lô (chỉ mục duy nhất một phần)
    const other = await findPending(tx, where);
    if (other) return { ...other, created: false };
    throw new Error("Không tạo được phiếu kiểm");
  }

  // Chụp chỉ tiêu lúc tạo (R-CL-1): đổi tiêu chuẩn sau đó không đổi phiếu này
  let paramCount = 0;
  if (standardId) {
    const params = await tx.select().from(qcStandardParams).where(eq(qcStandardParams.standardId, standardId)).orderBy(asc(qcStandardParams.sort), asc(qcStandardParams.createdAt));
    if (params.length > 0) {
      await tx.insert(qcInspectionResults).values(
        params.map((p) => ({
          inspectionId: row.id,
          paramId: p.id,
          name: p.name,
          paramGroup: p.paramGroup,
          kind: p.kind,
          unit: p.unit,
          minMilli: p.minMilli,
          maxMilli: p.maxMilli,
          expectedText: p.expectedText,
          isCritical: p.isCritical,
          sort: p.sort,
        })),
      );
    }
    paramCount = params.length;
  }

  await writeAudit(tx, {
    actorId,
    action: "qc_inspection.created",
    entity: "qc_inspection",
    entityId: row.id,
    after: { code: row.code, stage, standardId, stockLotId, lotId, productionOrderId, productionStepId, extractionRunId, params: paramCount },
  });
  return { id: row.id, code: row.code, created: true };
}

// Có phiếu IPQC failed của công đoạn/mẻ mà sau nó chưa có phiếu passed (R-CL-10).
// Ref là lệnh thì xét từng công đoạn của lệnh. Ưu tiên ref cụ thể nhất: công đoạn > mẻ chiết > lệnh.
export async function hasBlockingDeviation(db: Db | Tx, ref: { productionOrderId?: string; productionStepId?: string; extractionRunId?: string }): Promise<boolean> {
  let where: SQL;
  if (ref.productionStepId) where = eq(qcInspections.productionStepId, ref.productionStepId);
  else if (ref.extractionRunId) where = eq(qcInspections.extractionRunId, ref.extractionRunId);
  else if (ref.productionOrderId) where = eq(qcInspections.productionOrderId, ref.productionOrderId);
  else return false;

  const rows = await db
    .select({
      stepId: qcInspections.productionStepId,
      runId: qcInspections.extractionRunId,
      status: qcInspections.status,
      decidedAt: qcInspections.decidedAt,
      createdAt: qcInspections.createdAt,
    })
    .from(qcInspections)
    .where(and(eq(qcInspections.stage, "ipqc"), inArray(qcInspections.status, ["passed", "failed"]), where));

  return isDeviationBlocking(rows.map((r) => ({ key: r.stepId ?? (r.runId ? `run:${r.runId}` : "order"), status: r.status, decidedAt: r.decidedAt, createdAt: r.createdAt })));
}

// Hủy phiếu kiểm đang chờ (dùng chung, T-16). Kho gọi khi hủy phiếu nhập (thay cho sửa thẳng qc_inspections).
// Chỉ hủy phiếu pending, cập nhật có điều kiện; phiếu đã quyết định hoặc đã hủy thì trả cancelled: false.
// Quyền kiểm ở tầng gọi (Kho: inventory.approve; Chất lượng: quality.write).
export async function cancelInspection(tx: Tx, inspectionId: string, reason: string, actorId: string | null): Promise<{ cancelled: boolean }> {
  const why = reason.trim();
  if (!why) throw new UserError("Ghi lý do hủy phiếu kiểm");
  const [row] = await tx
    .update(qcInspections)
    .set({ status: "cancelled", decidedBy: actorId, decidedAt: new Date(), decisionNote: why })
    .where(and(eq(qcInspections.id, inspectionId), eq(qcInspections.status, "pending")))
    .returning({ id: qcInspections.id, code: qcInspections.code });
  if (!row) return { cancelled: false };
  await writeAudit(tx, {
    actorId,
    action: "qc_inspection.cancelled",
    entity: "qc_inspections",
    entityId: row.id,
    before: { status: "pending" },
    after: { status: "cancelled", code: row.code, reason: why },
  });
  return { cancelled: true };
}

// Hủy mọi phiếu chờ của một phiếu nhập (tiện cho cancelReceipt).
export async function cancelPendingInspectionsOfReceipt(tx: Tx, receiptId: string, reason: string, actorId: string | null): Promise<{ cancelled: number }> {
  const rows = await tx
    .select({ id: qcInspections.id })
    .from(qcInspections)
    .where(and(eq(qcInspections.stockReceiptId, receiptId), eq(qcInspections.status, "pending")));
  let n = 0;
  for (const r of rows) if ((await cancelInspection(tx, r.id, reason, actorId)).cancelled) n++;
  return { cancelled: n };
}
