// Mẻ chiết xuất (02-san-xuat.md R-SX-23…R-SX-25)
import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db/client";
import { extractionRuns, inventoryItems, qcInspections, stockLots, stockMovements, suppliers, warehouses } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { adjustDebtAmount, findDebtBySource, openPayable } from "@/modules/finance/ledger";
import { postIssue, postReceipt } from "@/modules/inventory/ledger";
import { addDays, costOfQty, type BaseUom } from "@/modules/inventory/rules";
import { vnToday } from "@/modules/numbering/rules";
import { nextDocCode } from "@/modules/numbering/service";
import { assertCan, STALE, type Actor } from "./access";
import { canChangeExtractionStatus, EXTRACTION_STATUS_LABEL, extractionTotalCost, recoveryOf, type ExtractionStatus, type ProductionKind } from "./rules";

type RunRow = typeof extractionRuns.$inferSelect;
type Method = RunRow["method"];

export type RunInput = {
  kind: ProductionKind;
  pomeloVariety: string;
  sourceSupplierId: string | null;
  harvestOn: string | null;
  peelCondition: string;
  method: Method;
  equipment: string;
  operatorName: string;
  serviceSupplierId: string | null;
  serviceFee: number;
  otherCost: number;
  params: { name: string; valueMilli: number; unit: string }[];
  outputItemId: string;
  note?: string | null;
};

async function checkInput(tx: Tx, input: RunInput) {
  for (const v of [input.serviceFee, input.otherCost]) if (!Number.isSafeInteger(v) || v < 0 || v > 2_000_000_000) throw new UserError("Chi phí không hợp lệ");
  const [item] = await tx.select({ kind: inventoryItems.kind }).from(inventoryItems).where(eq(inventoryItems.id, input.outputItemId)).limit(1);
  if (!item) throw new UserError("Chọn hàng đầu ra");
  if (item.kind !== "extract") throw new UserError("Hàng đầu ra phải là tinh dầu hoặc dịch chiết");
  if (input.kind === "outsourced" && input.serviceFee > 0 && !input.serviceSupplierId) throw new UserError("Chọn lò chưng thuê để ghi phí thuê");
}

async function lockRun(tx: Tx, runId: string): Promise<RunRow> {
  const [r] = await tx.select().from(extractionRuns).where(eq(extractionRuns.id, runId)).for("update").limit(1);
  if (!r) throw new UserError("Không tìm thấy mẻ chiết");
  return r;
}

async function moveRun(tx: Tx, r: RunRow, to: ExtractionStatus, extra: Partial<typeof extractionRuns.$inferInsert>, actor: Actor, after: Record<string, unknown> = {}) {
  if (!canChangeExtractionStatus(r.status, to)) throw new UserError(`Không chuyển được từ ${EXTRACTION_STATUS_LABEL[r.status]} sang ${EXTRACTION_STATUS_LABEL[to]}`);
  const [row] = await tx
    .update(extractionRuns)
    .set({ status: to, updatedAt: new Date(), ...extra })
    .where(and(eq(extractionRuns.id, r.id), eq(extractionRuns.status, r.status)))
    .returning({ id: extractionRuns.id });
  if (!row) throw new UserError(STALE);
  await writeAudit(tx, { actorId: actor.id, action: `extraction_run.${to}`, entity: "extraction_runs", entityId: r.id, before: { status: r.status }, after: { status: to, code: r.code, ...after } });
}

export async function createRun(tx: Tx, actor: Actor, input: RunInput): Promise<{ id: string; code: string }> {
  assertCan(actor, "production.write");
  await checkInput(tx, input);
  const code = await nextDocCode(tx, "CX");
  const [row] = await tx
    .insert(extractionRuns)
    .values({ ...input, harvestOn: input.harvestOn || null, note: input.note?.trim() || null, operatorId: null, code, createdBy: actor.id })
    .returning({ id: extractionRuns.id });
  await writeAudit(tx, { actorId: actor.id, action: "extraction_run.created", entity: "extraction_runs", entityId: row!.id, after: { code, kind: input.kind, method: input.method } });
  return { id: row!.id, code };
}

export async function updateRun(tx: Tx, actor: Actor, runId: string, input: RunInput): Promise<void> {
  assertCan(actor, "production.write");
  const r = await lockRun(tx, runId);
  if (r.status !== "draft" && r.status !== "in_progress") throw new UserError("Mẻ đã hoàn thành hoặc đã hủy, sửa chi phí ở khung chi phí");
  await checkInput(tx, input);
  await tx
    .update(extractionRuns)
    .set({ ...input, harvestOn: input.harvestOn || null, note: input.note?.trim() || null, updatedAt: new Date() })
    .where(eq(extractionRuns.id, runId));
  await writeAudit(tx, { actorId: actor.id, action: "extraction_run.updated", entity: "extraction_runs", entityId: runId, after: { equipment: input.equipment, serviceFee: input.serviceFee, otherCost: input.otherCost } });
}

export async function startRun(tx: Tx, actor: Actor, runId: string): Promise<void> {
  assertCan(actor, "production.write");
  const r = await lockRun(tx, runId);
  if (r.status !== "draft") throw new UserError(STALE);
  await moveRun(tx, r, "in_progress", { startedAt: new Date() }, actor);
}

// Vỏ đã xuất ròng theo lô (gồm dòng đảo): lượng (mg) và giá trị theo giá lô
export async function peelConsumption(db: Db | Tx, runId: string) {
  const original = alias(stockMovements, "original");
  const rows = await db
    .select({
      stockLotId: stockMovements.stockLotId,
      sumQty: sql<string>`sum(${stockMovements.qty})`,
      code: stockLots.code,
      receivedQty: stockLots.receivedQty,
      receivedCost: stockLots.receivedCost,
      baseUom: inventoryItems.baseUom,
    })
    .from(stockMovements)
    .leftJoin(original, eq(original.id, stockMovements.reversalOf))
    .innerJoin(stockLots, eq(stockLots.id, stockMovements.stockLotId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockMovements.itemId))
    .where(
      or(
        and(eq(stockMovements.extractionRunId, runId), eq(stockMovements.type, "extraction_issue")),
        and(eq(stockMovements.type, "reversal"), eq(original.extractionRunId, runId), eq(original.type, "extraction_issue")),
      ),
    )
    .groupBy(stockMovements.stockLotId, stockLots.code, stockLots.receivedQty, stockLots.receivedCost, inventoryItems.baseUom);
  const lotsUsed = rows.map((r) => {
    const net = -Number(r.sumQty);
    return { stockLotId: r.stockLotId, code: r.code, net, baseUom: r.baseUom as BaseUom, value: costOfQty(net, r.receivedQty, r.receivedCost) };
  });
  return {
    lots: lotsUsed.filter((l) => l.net !== 0),
    inputMg: lotsUsed.filter((l) => l.baseUom === "mg").reduce((s, l) => s + l.net, 0),
    cost: lotsUsed.reduce((s, l) => s + l.value, 0),
  };
}

// Xuất vỏ cho mẻ (R-SX-23): kho nguyên liệu, hàng kind raw_material; lần đầu tự chuyển "đang chạy"
export async function issuePeel(tx: Tx, actor: Actor, runId: string, input: { itemId: string; qty: number; stockLotId?: string | null }): Promise<{ issueCode: string }> {
  assertCan(actor, "production.write");
  const r = await lockRun(tx, runId);
  if (r.status !== "draft" && r.status !== "in_progress") throw new UserError("Mẻ đã hoàn thành hoặc đã hủy");
  const [item] = await tx.select({ kind: inventoryItems.kind, code: inventoryItems.code }).from(inventoryItems).where(eq(inventoryItems.id, input.itemId)).limit(1);
  if (!item) throw new UserError("Không tìm thấy hàng hóa");
  if (item.kind !== "raw_material") throw new UserError("Chỉ xuất nguyên liệu (vỏ bưởi) cho mẻ chiết");
  if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new UserError("Số lượng xuất phải lớn hơn 0");
  const res = await postIssue(
    tx,
    { kind: "extraction", extractionRunId: runId, purpose: `Xuất vỏ cho ${r.code}`, lines: [{ itemId: input.itemId, qty: input.qty, stockLotId: input.stockLotId ?? null }] },
    actor.id,
  );
  if (r.status === "draft") await moveRun(tx, r, "in_progress", { startedAt: new Date() }, actor, { by: "first_issue" });
  await writeAudit(tx, { actorId: actor.id, action: "extraction_run.peel_issued", entity: "extraction_runs", entityId: runId, after: { issue: res.code, item: item.code, qty: input.qty } });
  return { issueCode: res.code };
}

// Hoàn thành (R-SX-23, R-SX-25): lô EX chờ IPQC ở kho tinh dầu, công nợ thuê lò
export async function completeRun(
  tx: Tx,
  actor: Actor,
  runId: string,
  input: { outputQty: number; endedAt?: Date | null },
  today: string = vnToday(),
): Promise<{ stockLotId: string; lotCode: string; totalCost: number; payableCode: string | null }> {
  assertCan(actor, "production.write");
  const r = await lockRun(tx, runId);
  if (r.status !== "in_progress") throw new UserError(r.status === "draft" ? "Bắt đầu mẻ và xuất vỏ trước" : STALE);
  if (!Number.isSafeInteger(input.outputQty) || input.outputQty <= 0) throw new UserError("Lượng đầu ra phải lớn hơn 0");
  const [item] = await tx.select({ kind: inventoryItems.kind }).from(inventoryItems).where(eq(inventoryItems.id, r.outputItemId)).limit(1);
  if (item?.kind !== "extract") throw new UserError("Hàng đầu ra phải là tinh dầu hoặc dịch chiết");
  const peel = await peelConsumption(tx, runId);
  const total = extractionTotalCost(peel.cost, r.serviceFee, r.otherCost);
  if (total > 2_147_483_647) throw new UserError("Giá thành mẻ quá lớn");
  const [wh] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.kind, "extract"), eq(warehouses.isActive, true)))
    .orderBy(sql`case when ${warehouses.code} = 'EXT' then 0 else 1 end`)
    .limit(1);
  if (!wh) throw new UserError("Chưa có kho tinh dầu và dịch chiết");
  const rec = await postReceipt(
    tx,
    {
      kind: "extraction",
      warehouseId: wh.id,
      receivedOn: today,
      source: { type: "extraction_run", id: runId },
      paymentMode: "none",
      note: `Đầu ra mẻ chiết ${r.code}`,
      lines: [{ itemId: r.outputItemId, qty: input.outputQty, lineCost: total, qcRequired: true }],
    },
    actor.id,
  );
  const stockLotId = rec.lines[0]!.stockLotId;
  const [lot] = await tx.select({ code: stockLots.code }).from(stockLots).where(eq(stockLots.id, stockLotId)).limit(1);
  let payableCode: string | null = null;
  if (r.kind === "outsourced" && r.serviceFee > 0 && r.serviceSupplierId) {
    const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, r.serviceSupplierId)).limit(1);
    const pay = await openPayable(
      tx,
      {
        supplierId: r.serviceSupplierId,
        categoryCode: "CHI-GIA-CONG",
        source: { type: "extraction_run", id: runId, code: r.code },
        amount: r.serviceFee,
        issuedOn: today,
        dueOn: addDays(today, s?.paymentTermsDays ?? 0),
        note: `Thuê chưng mẻ ${r.code}`,
      },
      actor.id,
    );
    payableCode = pay.code;
  }
  await moveRun(tx, r, "completed", { outputQty: input.outputQty, outputStockLotId: stockLotId, totalCost: total, endedAt: input.endedAt ?? new Date() }, actor, { outputQty: input.outputQty, lot: lot?.code, totalCost: total });
  return { stockLotId, lotCode: lot?.code ?? "", totalCost: total, payableCode };
}

// Sửa chi phí sau khi hoàn thành: tính lại giá lô EX nếu chưa chốt (R-SX-25); phí thuê đổi → điều chỉnh công nợ
export async function updateRunCosts(tx: Tx, actor: Actor, runId: string, input: { serviceFee: number; otherCost: number; reason: string }): Promise<{ totalCost: number }> {
  assertCan(actor, "production.write");
  assertCan(actor, "finance.view");
  const r = await lockRun(tx, runId);
  for (const v of [input.serviceFee, input.otherCost]) if (!Number.isSafeInteger(v) || v < 0 || v > 2_000_000_000) throw new UserError("Chi phí không hợp lệ");
  if (r.status !== "completed") {
    await tx.update(extractionRuns).set({ serviceFee: input.serviceFee, otherCost: input.otherCost, updatedAt: new Date() }).where(eq(extractionRuns.id, runId));
    return { totalCost: r.totalCost };
  }
  if (!input.reason.trim()) throw new UserError("Ghi lý do sửa chi phí");
  const [lot] = r.outputStockLotId ? await tx.select({ costLockedAt: stockLots.costLockedAt }).from(stockLots).where(eq(stockLots.id, r.outputStockLotId)).limit(1) : [];
  if (lot?.costLockedAt) throw new UserError("Giá lô tinh dầu đã chốt, không sửa chi phí");
  const peel = await peelConsumption(tx, runId);
  const total = extractionTotalCost(peel.cost, input.serviceFee, input.otherCost);
  await tx.update(extractionRuns).set({ serviceFee: input.serviceFee, otherCost: input.otherCost, totalCost: total, updatedAt: new Date() }).where(eq(extractionRuns.id, runId));
  // Giá lô EX = giá thành mẻ (R-SX-25); lô do chính mẻ này tạo
  if (r.outputStockLotId) await tx.update(stockLots).set({ receivedCost: total }).where(and(eq(stockLots.id, r.outputStockLotId), eq(stockLots.extractionRunId, runId)));
  if (input.serviceFee !== r.serviceFee) {
    const debt = await findDebtBySource(tx, { kind: "payable", sourceType: "extraction_run", sourceId: runId });
    if (debt && debt.status !== "cancelled") await adjustDebtAmount(tx, { kind: "payable", debtId: debt.id, newAmount: input.serviceFee, reason: input.reason.trim() }, actor.id);
    else if (!debt && input.serviceFee > 0 && r.serviceSupplierId) {
      const today = vnToday();
      await openPayable(tx, { supplierId: r.serviceSupplierId, categoryCode: "CHI-GIA-CONG", source: { type: "extraction_run", id: runId, code: r.code }, amount: input.serviceFee, issuedOn: today, dueOn: today }, actor.id);
    }
  }
  await writeAudit(tx, {
    actorId: actor.id,
    action: "extraction_run.costs_updated",
    entity: "extraction_runs",
    entityId: runId,
    before: { serviceFee: r.serviceFee, otherCost: r.otherCost, totalCost: r.totalCost },
    after: { serviceFee: input.serviceFee, otherCost: input.otherCost, totalCost: total, reason: input.reason.trim() },
  });
  return { totalCost: total };
}

// Hủy: vỏ đã xuất tính hao hụt (như R-SX-21)
export async function cancelRun(tx: Tx, actor: Actor, runId: string, reason: string): Promise<{ leftoverValue: number }> {
  assertCan(actor, "production.write");
  if (!reason.trim()) throw new UserError("Ghi lý do hủy mẻ");
  const r = await lockRun(tx, runId);
  const peel = await peelConsumption(tx, runId);
  await moveRun(tx, r, "cancelled", { note: [r.note, `Hủy: ${reason.trim()}`].filter(Boolean).join(" · ") }, actor, { reason: reason.trim(), leftoverValue: peel.cost });
  return { leftoverValue: peel.cost };
}

export async function listRuns(db: Db | Tx, status?: ExtractionStatus | null) {
  return db
    .select({
      id: extractionRuns.id,
      code: extractionRuns.code,
      kind: extractionRuns.kind,
      status: extractionRuns.status,
      method: extractionRuns.method,
      equipment: extractionRuns.equipment,
      pomeloVariety: extractionRuns.pomeloVariety,
      outputQty: extractionRuns.outputQty,
      createdAt: extractionRuns.createdAt,
      outputCode: inventoryItems.code,
      outputUom: inventoryItems.baseUom,
      outputDisplayUom: inventoryItems.displayUom,
    })
    .from(extractionRuns)
    .innerJoin(inventoryItems, eq(inventoryItems.id, extractionRuns.outputItemId))
    .where(status ? eq(extractionRuns.status, status) : undefined)
    .orderBy(desc(extractionRuns.createdAt))
    .limit(200);
}

export async function getRunDetail(db: Db | Tx, runId: string) {
  const [run] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, runId)).limit(1);
  if (!run) return null;
  const [output] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, run.outputItemId)).limit(1);
  const supplierIds = [run.sourceSupplierId, run.serviceSupplierId].filter((x): x is string => !!x);
  const sups = supplierIds.length ? await db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supplierIds)) : [];
  const peel = await peelConsumption(db, runId);
  const lot = run.outputStockLotId ? ((await db.select().from(stockLots).where(eq(stockLots.id, run.outputStockLotId)).limit(1))[0] ?? null) : null;
  const ipqc = await db
    .select({ id: qcInspections.id, code: qcInspections.code, status: qcInspections.status })
    .from(qcInspections)
    .where(and(eq(qcInspections.extractionRunId, runId), eq(qcInspections.stage, "ipqc")))
    .orderBy(desc(qcInspections.createdAt));
  const payable = await findDebtBySource(db, { kind: "payable", sourceType: "extraction_run", sourceId: runId });
  const recovery = run.outputQty && output ? recoveryOf(peel.inputMg, run.outputQty, output.baseUom as BaseUom, output.densityMgPerMl) : null;
  return {
    run,
    output: output ?? null,
    source: sups.find((s) => s.id === run.sourceSupplierId) ?? null,
    service: sups.find((s) => s.id === run.serviceSupplierId) ?? null,
    peel,
    lot,
    ipqc,
    payable,
    recovery,
  };
}
