// Nhập kết quả và quyết định phiếu kiểm (03-chat-luong.md R-CL-3…R-CL-14, R-CL-25).
import { and, asc, eq, gt, inArray, max } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { inventoryItems, lots, lotTests, productionOrders, qcInspectionResults, qcInspections, qcStandardParams, stockBalances, stockLots, warehouses } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { createIssueDraft, setStockLotQcStatus, syncSellableStock, transferLotBalance } from "@/modules/inventory/ledger";
import { releaseLotInTx } from "@/modules/quality/service";
import { cancelInspection, createInspection } from "./inspections";
import { insertNcr } from "./ncr";
import {
  actorCan,
  checkDisposition,
  dispositionStatus,
  evaluateFromLotTests,
  evaluateParam,
  INSPECTION_STALE,
  ncrCategoryForItemKind,
  parseMeasure,
  PERMISSION_DENIED,
  releaseBlockerText,
  suggestVerdict,
  type Actor,
  type Disposition,
  type LotTestKind,
  type ParamGroupKey,
  type Verdict,
} from "./rules";

function need(actor: Actor, p: "quality.write" | "quality.approve") {
  if (!actorCan(actor, p)) throw new UserError(PERMISSION_DENIED);
}

export type EvaluatedResult = typeof qcInspectionResults.$inferSelect & { lotTestType: LotTestKind | null; livePassed: boolean | null };

// Đọc chỉ tiêu của phiếu và đánh giá lại (chỉ tiêu nối lot_tests lấy kết quả từ lot_tests của lô, R-CL-4)
export async function evaluateInspection(db: Db | Tx, inspection: { id: string; lotId: string | null; stage: string }): Promise<{ results: EvaluatedResult[]; verdict: Verdict }> {
  const rows = await db
    .select({ r: qcInspectionResults, lotTestType: qcStandardParams.lotTestType })
    .from(qcInspectionResults)
    .leftJoin(qcStandardParams, eq(qcStandardParams.id, qcInspectionResults.paramId))
    .where(eq(qcInspectionResults.inspectionId, inspection.id))
    .orderBy(asc(qcInspectionResults.sort), asc(qcInspectionResults.createdAt));
  const useLotTests = (inspection.stage === "fqc" || inspection.stage === "recheck") && !!inspection.lotId;
  const tests = useLotTests && rows.some((r) => r.lotTestType) ? await db.select({ type: lotTests.type, result: lotTests.result }).from(lotTests).where(eq(lotTests.lotId, inspection.lotId!)) : [];
  const results: EvaluatedResult[] = rows.map(({ r, lotTestType }) => {
    const fromLot = useLotTests && !!lotTestType;
    return { ...r, lotTestType: lotTestType ?? null, livePassed: fromLot ? evaluateFromLotTests(lotTestType!, tests) : r.passed };
  });
  const verdict = suggestVerdict(
    results.map((r) => ({ kind: r.kind, minMilli: r.minMilli, maxMilli: r.maxMilli, isCritical: r.isCritical, passed: r.livePassed, fromLotTest: useLotTests && !!r.lotTestType })),
  );
  return { results, verdict };
}

async function loadPending(tx: Tx, inspectionId: string) {
  const [insp] = await tx.select().from(qcInspections).where(eq(qcInspections.id, inspectionId));
  if (!insp) throw new UserError("Không tìm thấy phiếu kiểm");
  if (insp.status !== "pending") throw new UserError(INSPECTION_STALE);
  return insp;
}

export type ResultEntry = { resultId: string; value?: string | null; passFail?: "pass" | "fail" | "" | null; text?: string | null; note?: string | null };

// Lưu kết quả (quality.write, phiếu đang chờ). Lỗi nhập ở chỉ tiêu nào thì báo tên chỉ tiêu đó, không lưu gì.
export async function saveInspectionResults(
  tx: Tx,
  inspectionId: string,
  input: { entries: ResultEntry[]; sampleSize?: string | null; note?: string | null; fileIds?: string[] },
  actor: Actor,
): Promise<{ saved: number }> {
  need(actor, "quality.write");
  const insp = await loadPending(tx, inspectionId);
  const { results } = await evaluateInspection(tx, insp);
  const byId = new Map(results.map((r) => [r.id, r]));
  const updates: { id: string; valueMilli: number | null; valueText: string | null; passed: boolean | null; note: string | null }[] = [];
  for (const e of input.entries) {
    const r = byId.get(e.resultId);
    if (!r) throw new UserError("Chỉ tiêu không thuộc phiếu này");
    // Chỉ tiêu nối lot_tests không nhập tay
    if (r.lotTestType && (insp.stage === "fqc" || insp.stage === "recheck")) continue;
    let valueMilli: number | null = r.valueMilli;
    let valueText: string | null = r.valueText;
    let passFail: boolean | null = r.kind === "pass_fail" ? r.passed : null;
    if (r.kind === "range" && e.value !== undefined) {
      const raw = (e.value ?? "").trim();
      if (raw === "") valueMilli = null;
      else {
        const p = parseMeasure(raw);
        if (!p.ok) throw new UserError(`${r.name}: ${p.message}`);
        valueMilli = p.milli;
      }
    }
    if (r.kind === "pass_fail" && e.passFail !== undefined) passFail = e.passFail === "pass" ? true : e.passFail === "fail" ? false : null;
    if (e.text !== undefined) valueText = e.text?.trim() || null;
    const passed = evaluateParam({ kind: r.kind, minMilli: r.minMilli, maxMilli: r.maxMilli, valueMilli, passFail });
    updates.push({ id: r.id, valueMilli, valueText, passed, note: e.note === undefined ? r.note : e.note?.trim() || null });
  }
  for (const u of updates) {
    await tx.update(qcInspectionResults).set({ valueMilli: u.valueMilli, valueText: u.valueText, passed: u.passed, note: u.note }).where(eq(qcInspectionResults.id, u.id));
  }
  const [row] = await tx
    .update(qcInspections)
    .set({
      inspectedBy: actor.id,
      inspectedAt: new Date(),
      ...(input.sampleSize !== undefined ? { sampleSize: input.sampleSize?.trim() ?? "" } : {}),
      ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      ...(input.fileIds !== undefined ? { fileIds: input.fileIds } : {}),
    })
    .where(and(eq(qcInspections.id, inspectionId), eq(qcInspections.status, "pending")))
    .returning({ id: qcInspections.id });
  if (!row) throw new UserError(INSPECTION_STALE);
  await writeAudit(tx, { actorId: actor.id, action: "qc_inspection.results_saved", entity: "qc_inspections", entityId: inspectionId, after: { saved: updates.length } });
  return { saved: updates.length };
}

// Thêm chỉ tiêu tự do (phiếu không có tiêu chuẩn hoặc cần thêm)
export async function addInspectionParam(
  tx: Tx,
  inspectionId: string,
  input: { name: string; paramGroup: ParamGroupKey; kind: "range" | "pass_fail" | "text"; unit?: string; min?: string | null; max?: string | null; expectedText?: string | null; isCritical?: boolean },
  actor: Actor,
): Promise<{ id: string }> {
  need(actor, "quality.write");
  await loadPending(tx, inspectionId);
  if (!input.name.trim()) throw new UserError("Nhập tên chỉ tiêu");
  const lim = (raw: string | null | undefined, label: string) => {
    const s = raw?.trim() ?? "";
    if (!s || input.kind !== "range") return null;
    const p = parseMeasure(s);
    if (!p.ok) throw new UserError(`${label}: ${p.message}`);
    return p.milli;
  };
  const minMilli = lim(input.min, "Giới hạn dưới");
  const maxMilli = lim(input.max, "Giới hạn trên");
  if (minMilli !== null && maxMilli !== null && minMilli > maxMilli) throw new UserError("Giới hạn dưới lớn hơn giới hạn trên");
  const [{ s } = { s: -1 }] = await tx.select({ s: max(qcInspectionResults.sort) }).from(qcInspectionResults).where(eq(qcInspectionResults.inspectionId, inspectionId));
  const [row] = await tx
    .insert(qcInspectionResults)
    .values({
      inspectionId,
      name: input.name.trim(),
      paramGroup: input.paramGroup,
      kind: input.kind,
      unit: input.unit?.trim() ?? "",
      minMilli,
      maxMilli,
      expectedText: input.expectedText?.trim() || null,
      isCritical: input.isCritical ?? true,
      sort: (s ?? -1) + 1,
    })
    .returning({ id: qcInspectionResults.id });
  await writeAudit(tx, { actorId: actor.id, action: "qc_inspection.param_added", entity: "qc_inspections", entityId: inspectionId, after: { name: input.name.trim() } });
  return { id: row!.id };
}

async function rejectedWarehouseId(tx: Tx): Promise<string> {
  const rows = await tx.select({ id: warehouses.id, code: warehouses.code }).from(warehouses).where(and(eq(warehouses.kind, "rejected"), eq(warehouses.isActive, true)));
  const pick = rows.find((r) => r.code === "REJ") ?? rows[0];
  if (!pick) throw new UserError("Chưa có kho cách ly (REJ)");
  return pick.id;
}

async function lotBalanceIn(tx: Tx, stockLotId: string, warehouseId: string): Promise<number> {
  const rows = await tx
    .select({ qty: stockBalances.qty })
    .from(stockBalances)
    .where(and(eq(stockBalances.stockLotId, stockLotId), eq(stockBalances.warehouseId, warehouseId), gt(stockBalances.qty, 0)));
  return rows.reduce((s, r) => s + r.qty, 0);
}

export type DecisionResult = { status: "passed" | "failed"; ncr: { id: string; code: string } | null; supplierReturn: { issueId: string; code: string } | null; movedQty: number };

// Quyết định phiếu (quality.approve, một lần, R-CL-6). Hiệu lực chạy trong cùng giao dịch (R-CL-8, R-CL-11, R-CL-12, R-CL-13).
// Lỗi nghiệp vụ (kể cả FQC có blocker) ném UserError để giao dịch lùi toàn bộ.
export async function decideInspection(tx: Tx, inspectionId: string, input: { disposition: Disposition; note?: string | null }, actor: Actor): Promise<DecisionResult> {
  need(actor, "quality.approve");
  const insp = await loadPending(tx, inspectionId);
  const { results, verdict } = await evaluateInspection(tx, insp);
  const err = checkDisposition({ stage: insp.stage, verdict, disposition: input.disposition, note: input.note });
  if (err) throw new UserError(err);
  const note = input.note?.trim() || null;
  const status = dispositionStatus(input.disposition);

  // Một lần: cập nhật có điều kiện status = pending
  const [claimed] = await tx
    .update(qcInspections)
    .set({ status, disposition: input.disposition, decisionNote: note, decidedBy: actor.id, decidedAt: new Date() })
    .where(and(eq(qcInspections.id, inspectionId), eq(qcInspections.status, "pending")))
    .returning({ id: qcInspections.id });
  if (!claimed) throw new UserError(INSPECTION_STALE);

  // Lưu kết quả lấy từ lot_tests để phiếu giữ đúng căn cứ lúc quyết định
  for (const r of results) if (r.lotTestType && r.livePassed !== r.passed) await tx.update(qcInspectionResults).set({ passed: r.livePassed }).where(eq(qcInspectionResults.id, r.id));

  const out: DecisionResult = { status, ncr: null, supplierReturn: null, movedQty: 0 };

  // IQC, IPQC đầu ra mẻ chiết: lô vật tư/lô EX
  if ((insp.stage === "iqc" || insp.stage === "ipqc") && insp.stockLotId) {
    const [sl] = await tx
      .select({ id: stockLots.id, code: stockLots.code, itemId: stockLots.itemId, itemCode: inventoryItems.code, kind: inventoryItems.kind, supplierId: stockLots.supplierId, extractionRunId: stockLots.extractionRunId })
      .from(stockLots)
      .innerJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
      .where(eq(stockLots.id, insp.stockLotId));
    if (!sl) throw new UserError("Không tìm thấy lô kho");
    if (status === "passed") {
      // R-CL-8: use_as_is ghi "Chấp nhận có điều kiện: …" vào hold_reason của lô (giữ lại khi duyệt)
      const releaseNote = input.disposition === "use_as_is" ? `Chấp nhận có điều kiện: ${note}` : null;
      await setStockLotQcStatus(tx, sl.id, "released", releaseNote, actor.id, { releaseNote });
    } else {
      const reason = `${insp.code} không đạt: ${note}`;
      await setStockLotQcStatus(tx, sl.id, "rejected", reason, actor.id);
      const moved = await transferLotBalance(tx, { stockLotId: sl.id, toWarehouseKind: "rejected", reason, source: { type: "qc_inspection", id: insp.id } }, actor.id);
      out.movedQty = moved.qty;
      const runId = insp.extractionRunId ?? sl.extractionRunId ?? null;
      out.ncr = await insertNcr(
        tx,
        {
          title: insp.stage === "iqc" ? `IQC không đạt: ${sl.itemCode} lô ${sl.code}` : `IPQC đầu ra mẻ chiết không đạt: ${sl.itemCode} lô ${sl.code}`,
          category: insp.stage === "ipqc" ? "extract" : ncrCategoryForItemKind(sl.kind),
          severity: "major",
          description: note ?? "",
          supplierId: insp.supplierId ?? sl.supplierId,
          stockLotId: sl.id,
          inspectionId: insp.id,
          extractionRunId: runId,
        },
        actor.id,
      );
      if (input.disposition === "return_to_supplier") {
        const rejId = await rejectedWarehouseId(tx);
        const qty = await lotBalanceIn(tx, sl.id, rejId);
        if (qty > 0) {
          out.supplierReturn = await createIssueDraft(
            tx,
            { kind: "supplier_return", warehouseId: rejId, purpose: `Trả NCC theo ${insp.code}`, note, lines: [{ itemId: sl.itemId, qty, stockLotId: sl.id }] },
            actor.id,
          );
        }
      }
    }
  }

  // FQC: một đường duyệt lô (R-CL-12, R-CL-14) và không đạt (R-CL-13)
  if (insp.stage === "fqc" && insp.lotId) {
    if (status === "passed") {
      const verdictLot = await releaseLotInTx(tx, insp.lotId, actor.id);
      if (!verdictLot.ok) throw new UserError(`Chưa duyệt được lô:\n${verdictLot.blockers.map(releaseBlockerText).join("\n")}`);
    } else {
      const [lot] = await tx
        .update(lots)
        .set({ releaseStatus: "rejected", holdReason: `${insp.code} không đạt: ${note}` })
        .where(and(eq(lots.id, insp.lotId), eq(lots.releaseStatus, "quarantine")))
        .returning({ id: lots.id, lotNo: lots.lotNo, productId: lots.productId });
      if (!lot) throw new UserError("Lô không ở trạng thái cách ly, không đánh dấu không đạt được");
      await writeAudit(tx, { actorId: actor.id, action: "lot.rejected", entity: "lots", entityId: lot.id, before: { releaseStatus: "quarantine" }, after: { releaseStatus: "rejected", inspection: insp.code } });
      const stockLotRows = await tx.select({ id: stockLots.id }).from(stockLots).where(eq(stockLots.productLotId, lot.id));
      for (const s of stockLotRows) {
        const moved = await transferLotBalance(tx, { stockLotId: s.id, toWarehouseKind: "rejected", reason: `${insp.code} không đạt`, source: { type: "qc_inspection", id: insp.id } }, actor.id);
        out.movedQty += moved.qty;
      }
      await syncSellableStock(tx, lot.productId);
      out.ncr = await insertNcr(
        tx,
        {
          title: `FQC không đạt: lô ${lot.lotNo}`,
          category: "product",
          severity: "major",
          description: note ?? "",
          lotId: lot.id,
          productionOrderId: insp.productionOrderId,
          inspectionId: insp.id,
        },
        actor.id,
      );
    }
  }
  // Kiểm lại (recheck) và IPQC công đoạn: chỉ ghi nhận, không đổi trạng thái lô (R-CL-10, R-CL-25)

  await writeAudit(tx, {
    actorId: actor.id,
    action: "qc_inspection.decided",
    entity: "qc_inspections",
    entityId: inspectionId,
    before: { status: "pending" },
    after: { status, disposition: input.disposition, verdict, code: insp.code, ncr: out.ncr?.code ?? null, supplierReturn: out.supplierReturn?.code ?? null },
  });
  return out;
}

// Hủy phiếu chờ từ trang Chất lượng (quality.write)
export async function cancelInspectionByStaff(tx: Tx, inspectionId: string, reason: string, actor: Actor): Promise<void> {
  need(actor, "quality.write");
  const r = await cancelInspection(tx, inspectionId, reason, actor.id);
  if (!r.cancelled) throw new UserError(INSPECTION_STALE);
}

// ---------------------------------------------------------------------------------------------
// Mở phiếu tay

// R-CL-14, AC-CL-18: "Mở phiếu FQC" cho lô cách ly; đã có phiếu chờ thì trả phiếu đó
export async function openFqcForLot(tx: Tx, lotId: string, actor: Actor): Promise<{ id: string; code: string; created: boolean }> {
  need(actor, "quality.write");
  const [lot] = await tx.select({ status: lots.releaseStatus }).from(lots).where(eq(lots.id, lotId));
  if (!lot) throw new UserError("Không tìm thấy lô");
  const [pending] = await tx.select({ id: qcInspections.id, code: qcInspections.code }).from(qcInspections).where(and(eq(qcInspections.stage, "fqc"), eq(qcInspections.lotId, lotId), eq(qcInspections.status, "pending")));
  if (pending) return { ...pending, created: false };
  if (lot.status !== "quarantine") throw new UserError("Chỉ mở phiếu FQC cho lô đang cách ly");
  const [po] = await tx.select({ id: productionOrders.id }).from(productionOrders).where(eq(productionOrders.lotId, lotId)).limit(1);
  return createInspection(tx, { stage: "fqc", lotId, productionOrderId: po?.id ?? null }, actor.id);
}

// R-CL-7: IQC tay cho lô vật tư pending chưa có phiếu chờ
export async function openIqcForStockLot(tx: Tx, stockLotId: string, actor: Actor): Promise<{ id: string; code: string; created: boolean }> {
  need(actor, "quality.write");
  const [sl] = await tx.select({ qcStatus: stockLots.qcStatus, productLotId: stockLots.productLotId, sourceDocType: stockLots.sourceDocType, sourceDocId: stockLots.sourceDocId }).from(stockLots).where(eq(stockLots.id, stockLotId));
  if (!sl) throw new UserError("Không tìm thấy lô kho");
  if (sl.productLotId || sl.qcStatus !== "pending") throw new UserError("Chỉ mở IQC cho lô vật tư đang chờ kiểm");
  return createInspection(tx, { stage: "iqc", stockLotId, receiptId: sl.sourceDocType === "receipt" ? sl.sourceDocId : null }, actor.id);
}

// R-CL-25: kiểm lại mẫu lưu (gắn lô, phản ánh nếu có); không đổi trạng thái lô
export async function openRecheck(tx: Tx, input: { lotId: string; complaintId?: string | null }, actor: Actor): Promise<{ id: string; code: string; created: boolean }> {
  need(actor, "quality.write");
  return createInspection(tx, { stage: "recheck", lotId: input.lotId, complaintId: input.complaintId ?? null }, actor.id);
}

// Lô kho đang chờ IQC mà chưa có phiếu (để trang phiếu kiểm gợi ý tạo tay)
export async function pendingLotsWithoutInspection(db: Db | Tx) {
  const pending = await db
    .select({ id: stockLots.id, code: stockLots.code, itemCode: inventoryItems.code, itemName: inventoryItems.name })
    .from(stockLots)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockLots.itemId))
    .where(eq(stockLots.qcStatus, "pending"));
  if (pending.length === 0) return [];
  const withInsp = await db
    .select({ id: qcInspections.stockLotId })
    .from(qcInspections)
    .where(and(eq(qcInspections.status, "pending"), inArray(qcInspections.stockLotId, pending.map((p) => p.id))));
  const has = new Set(withInsp.map((r) => r.id));
  return pending.filter((p) => !has.has(p.id));
}
