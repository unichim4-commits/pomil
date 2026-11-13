// Công thức có phiên bản (02-san-xuat.md R-SX-4…R-SX-11). Đọc dòng/tỷ lệ cần formulas.view; ghi cần formulas.write.
import "server-only";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { formulaLines, formulaPackaging, formulas, formulaVersions, inventoryItems, products } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import type { BaseUom } from "@/modules/inventory/rules";
import { nextDocCode } from "@/modules/numbering/service";
import { assertCan, STALE, type Actor } from "./access";
import {
  canChangeVersionStatus,
  checkFormulaItem,
  checkFormulaTotals,
  diffVersions,
  formulaVersionLabel,
  PPM_FULL,
  VERSION_STATUS_LABEL,
  type FormulaVersionStatus,
  type VersionSnapshot,
} from "./rules";

export const ONLY_DRAFT = "Chỉ sửa được bản nháp";

export type VersionParams = {
  batchSize: number;
  batchUom: "mg" | "ul";
  bulkDensityMgPerMl: number | null;
  expectedYieldBp: number;
  processNote: string;
};

function checkParams(p: VersionParams): void {
  if (!Number.isSafeInteger(p.batchSize) || p.batchSize <= 0) throw new UserError("Cỡ mẻ phải lớn hơn 0");
  if (p.batchUom !== "mg" && p.batchUom !== "ul") throw new UserError("Cỡ mẻ đo theo khối lượng hoặc thể tích");
  if (!Number.isInteger(p.expectedYieldBp) || p.expectedYieldBp < 1 || p.expectedYieldBp > 10_000) throw new UserError("Hiệu suất dự kiến từ 0,01% đến 100%");
  if (p.bulkDensityMgPerMl !== null && (!Number.isInteger(p.bulkDensityMgPerMl) || p.bulkDensityMgPerMl <= 0)) throw new UserError("Khối lượng riêng không hợp lệ");
}

// ---------------------------------------------------------------------------------------------
// Đọc

export async function listFormulas(db: Db | Tx, actor: Actor) {
  assertCan(actor, "formulas.view");
  const rows = await db
    .select({ id: formulas.id, code: formulas.code, name: formulas.name, productCode: products.code, productName: products.name, isActive: formulas.isActive, updatedAt: formulas.updatedAt })
    .from(formulas)
    .leftJoin(products, eq(products.id, formulas.productId))
    .orderBy(asc(formulas.code));
  const versions = rows.length
    ? await db
        .select({ formulaId: formulaVersions.formulaId, version: formulaVersions.version, label: formulaVersions.label, status: formulaVersions.status })
        .from(formulaVersions)
        .where(inArray(formulaVersions.formulaId, rows.map((r) => r.id)))
        .orderBy(asc(formulaVersions.version))
    : [];
  return rows.map((r) => {
    const vs = versions.filter((v) => v.formulaId === r.id);
    return { ...r, versions: vs, current: vs.find((v) => v.status === "approved") ?? null, latest: vs[vs.length - 1] ?? null };
  });
}

export type VersionDetail = Awaited<ReturnType<typeof loadVersion>>;

async function loadVersion(db: Db | Tx, versionId: string) {
  const [v] = await db.select().from(formulaVersions).where(eq(formulaVersions.id, versionId)).limit(1);
  if (!v) return null;
  const lines = await db
    .select({
      id: formulaLines.id,
      itemId: formulaLines.itemId,
      ppm: formulaLines.ppm,
      isBalance: formulaLines.isBalance,
      phase: formulaLines.phase,
      note: formulaLines.note,
      sort: formulaLines.sort,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      itemKind: inventoryItems.kind,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
      densityMgPerMl: inventoryItems.densityMgPerMl,
    })
    .from(formulaLines)
    .innerJoin(inventoryItems, eq(inventoryItems.id, formulaLines.itemId))
    .where(eq(formulaLines.formulaVersionId, versionId))
    .orderBy(asc(formulaLines.sort), asc(formulaLines.createdAt));
  const packaging = await db
    .select({
      id: formulaPackaging.id,
      itemId: formulaPackaging.itemId,
      qtyPerUnit: formulaPackaging.qtyPerUnit,
      note: formulaPackaging.note,
      sort: formulaPackaging.sort,
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      baseUom: inventoryItems.baseUom,
      displayUom: inventoryItems.displayUom,
    })
    .from(formulaPackaging)
    .innerJoin(inventoryItems, eq(inventoryItems.id, formulaPackaging.itemId))
    .where(eq(formulaPackaging.formulaVersionId, versionId))
    .orderBy(asc(formulaPackaging.sort), asc(formulaPackaging.createdAt));
  return { ...v, lines, packaging };
}

// Dùng nội bộ (lệnh, kế hoạch): đọc dòng để tính định mức, không qua kiểm quyền xem tỷ lệ.
// Trang lệnh chỉ hiện lượng, không hiện % (R-SX-10).
export async function loadVersionForCalc(db: Db | Tx, versionId: string) {
  return loadVersion(db, versionId);
}

export async function getFormulaDetail(db: Db | Tx, actor: Actor, formulaId: string) {
  assertCan(actor, "formulas.view");
  const [f] = await db
    .select({ id: formulas.id, code: formulas.code, name: formulas.name, note: formulas.note, productId: formulas.productId, productCode: products.code, productName: products.name, isActive: formulas.isActive })
    .from(formulas)
    .leftJoin(products, eq(products.id, formulas.productId))
    .where(eq(formulas.id, formulaId))
    .limit(1);
  if (!f) return null;
  const ids = await db.select({ id: formulaVersions.id }).from(formulaVersions).where(eq(formulaVersions.formulaId, formulaId)).orderBy(desc(formulaVersions.version));
  const versions = [];
  for (const { id } of ids) versions.push((await loadVersion(db, id))!);
  return { formula: f, versions };
}

// Phiên bản dùng được cho lệnh/kế hoạch (approved, trial), kèm nhãn; không có tỷ lệ
export async function listUsableVersions(db: Db | Tx) {
  return db
    .select({
      id: formulaVersions.id,
      label: formulaVersions.label,
      status: formulaVersions.status,
      formulaId: formulaVersions.formulaId,
      formulaName: formulas.name,
      productId: formulas.productId,
      batchSize: formulaVersions.batchSize,
      batchUom: formulaVersions.batchUom,
    })
    .from(formulaVersions)
    .innerJoin(formulas, eq(formulas.id, formulaVersions.formulaId))
    .where(inArray(formulaVersions.status, ["approved", "trial"]))
    .orderBy(asc(formulaVersions.label));
}

// Bản approved hiện hành của sản phẩm (kế hoạch để trống phiên bản)
export async function currentVersionOfProduct(db: Db | Tx, productId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: formulaVersions.id })
    .from(formulaVersions)
    .innerJoin(formulas, eq(formulas.id, formulaVersions.formulaId))
    .where(and(eq(formulas.productId, productId), eq(formulaVersions.status, "approved")))
    .orderBy(desc(formulaVersions.approvedAt))
    .limit(1);
  return row?.id ?? null;
}

// Nhãn bản đã duyệt hiện hành của sản phẩm (trang sản phẩm); không có tỷ lệ
export async function productFormulaInfo(db: Db | Tx, productId: string): Promise<{ formulaId: string; label: string } | null> {
  const [row] = await db
    .select({ formulaId: formulas.id, label: formulaVersions.label })
    .from(formulaVersions)
    .innerJoin(formulas, eq(formulas.id, formulaVersions.formulaId))
    .where(and(eq(formulas.productId, productId), eq(formulaVersions.status, "approved")))
    .orderBy(desc(formulaVersions.approvedAt))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------
// Tạo công thức + phiên bản 1 (R-SX-4)

export async function createFormula(
  tx: Tx,
  actor: Actor,
  input: { name: string; productId: string | null; note?: string | null } & VersionParams,
): Promise<{ formulaId: string; versionId: string; code: string; label: string }> {
  assertCan(actor, "formulas.write");
  const name = input.name.trim();
  if (name.length < 2) throw new UserError("Nhập tên công thức");
  checkParams(input);
  let productCode: string | null = null;
  if (input.productId) {
    const [p] = await tx.select({ code: products.code }).from(products).where(eq(products.id, input.productId)).limit(1);
    if (!p) throw new UserError("Không tìm thấy sản phẩm");
    productCode = p.code;
  }
  const code = await nextDocCode(tx, "FORM");
  const [f] = await tx.insert(formulas).values({ code, name, productId: input.productId, note: input.note ?? null, createdBy: actor.id }).returning({ id: formulas.id });
  const label = formulaVersionLabel(productCode, code, 1);
  const [v] = await tx
    .insert(formulaVersions)
    .values({
      formulaId: f!.id,
      version: 1,
      label,
      batchSize: input.batchSize,
      batchUom: input.batchUom,
      bulkDensityMgPerMl: input.bulkDensityMgPerMl,
      expectedYieldBp: input.expectedYieldBp,
      processNote: input.processNote,
      createdBy: actor.id,
    })
    .returning({ id: formulaVersions.id });
  await writeAudit(tx, { actorId: actor.id, action: "formula.created", entity: "formulas", entityId: f!.id, after: { code, name, label } });
  return { formulaId: f!.id, versionId: v!.id, code, label };
}

async function draftVersion(tx: Tx, versionId: string) {
  const [v] = await tx.select().from(formulaVersions).where(eq(formulaVersions.id, versionId)).for("update").limit(1);
  if (!v) throw new UserError("Không tìm thấy phiên bản công thức");
  if (v.status !== "draft") throw new UserError(ONLY_DRAFT);
  return v;
}

export async function updateVersionParams(tx: Tx, actor: Actor, versionId: string, p: VersionParams): Promise<void> {
  assertCan(actor, "formulas.write");
  checkParams(p);
  const v = await draftVersion(tx, versionId);
  await tx
    .update(formulaVersions)
    .set({ batchSize: p.batchSize, batchUom: p.batchUom, bulkDensityMgPerMl: p.bulkDensityMgPerMl, expectedYieldBp: p.expectedYieldBp, processNote: p.processNote })
    .where(eq(formulaVersions.id, versionId));
  await writeAudit(tx, {
    actorId: actor.id,
    action: "formula_version.updated",
    entity: "formula_versions",
    entityId: versionId,
    before: { batchSize: v.batchSize, batchUom: v.batchUom, expectedYieldBp: v.expectedYieldBp },
    after: { batchSize: p.batchSize, batchUom: p.batchUom, expectedYieldBp: p.expectedYieldBp },
  });
}

// Thêm hoặc sửa một dòng (cùng hàng thì sửa dòng có sẵn), R-SX-6
export async function upsertFormulaLine(
  tx: Tx,
  actor: Actor,
  versionId: string,
  input: { itemId: string; ppm: number; isBalance: boolean; phase?: string; note?: string | null },
): Promise<void> {
  assertCan(actor, "formulas.write");
  await draftVersion(tx, versionId);
  const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, input.itemId)).limit(1);
  if (!item) throw new UserError("Không tìm thấy hàng hóa");
  const problem = checkFormulaItem({ code: item.code, kind: item.kind, baseUom: item.baseUom as BaseUom });
  if (problem) throw new UserError(problem);
  if (!input.isBalance && (!Number.isInteger(input.ppm) || input.ppm <= 0 || input.ppm > PPM_FULL)) throw new UserError("Tỷ lệ phải lớn hơn 0 và không quá 100%");
  if (input.isBalance) {
    // Mỗi phiên bản một dòng cân bằng: bỏ đánh dấu dòng cũ
    await tx.update(formulaLines).set({ isBalance: false }).where(and(eq(formulaLines.formulaVersionId, versionId), eq(formulaLines.isBalance, true)));
  }
  const [existing] = await tx.select({ id: formulaLines.id }).from(formulaLines).where(and(eq(formulaLines.formulaVersionId, versionId), eq(formulaLines.itemId, item.id))).limit(1);
  const values = { ppm: input.isBalance ? 0 : input.ppm, isBalance: input.isBalance, phase: input.phase?.trim() ?? "", note: input.note?.trim() || null };
  if (existing) await tx.update(formulaLines).set(values).where(eq(formulaLines.id, existing.id));
  else {
    const [m] = await tx.select({ m: max(formulaLines.sort) }).from(formulaLines).where(eq(formulaLines.formulaVersionId, versionId));
    await tx.insert(formulaLines).values({ formulaVersionId: versionId, itemId: item.id, sort: (m?.m ?? -1) + 1, ...values });
  }
  await writeAudit(tx, { actorId: actor.id, action: "formula_version.line_saved", entity: "formula_versions", entityId: versionId, after: { item: item.code, ppm: values.ppm, isBalance: values.isBalance } });
}

export async function removeFormulaLine(tx: Tx, actor: Actor, lineId: string): Promise<void> {
  assertCan(actor, "formulas.write");
  const [line] = await tx.select().from(formulaLines).where(eq(formulaLines.id, lineId)).limit(1);
  if (!line) throw new UserError("Không tìm thấy dòng công thức");
  await draftVersion(tx, line.formulaVersionId);
  await tx.delete(formulaLines).where(eq(formulaLines.id, lineId));
  await writeAudit(tx, { actorId: actor.id, action: "formula_version.line_removed", entity: "formula_versions", entityId: line.formulaVersionId, before: { itemId: line.itemId, ppm: line.ppm } });
}

export async function upsertPackaging(tx: Tx, actor: Actor, versionId: string, input: { itemId: string; qtyPerUnit: number; note?: string | null }): Promise<void> {
  assertCan(actor, "formulas.write");
  await draftVersion(tx, versionId);
  if (!Number.isSafeInteger(input.qtyPerUnit) || input.qtyPerUnit <= 0) throw new UserError("Định mức bao bì mỗi chai phải lớn hơn 0");
  const [item] = await tx.select({ id: inventoryItems.id, code: inventoryItems.code, kind: inventoryItems.kind }).from(inventoryItems).where(eq(inventoryItems.id, input.itemId)).limit(1);
  if (!item) throw new UserError("Không tìm thấy hàng hóa");
  if (item.kind === "finished") throw new UserError("Không dùng thành phẩm làm bao bì");
  const [existing] = await tx.select({ id: formulaPackaging.id }).from(formulaPackaging).where(and(eq(formulaPackaging.formulaVersionId, versionId), eq(formulaPackaging.itemId, item.id))).limit(1);
  if (existing) await tx.update(formulaPackaging).set({ qtyPerUnit: input.qtyPerUnit, note: input.note?.trim() || null }).where(eq(formulaPackaging.id, existing.id));
  else {
    const [m] = await tx.select({ m: max(formulaPackaging.sort) }).from(formulaPackaging).where(eq(formulaPackaging.formulaVersionId, versionId));
    await tx.insert(formulaPackaging).values({ formulaVersionId: versionId, itemId: item.id, qtyPerUnit: input.qtyPerUnit, note: input.note?.trim() || null, sort: (m?.m ?? -1) + 1 });
  }
  await writeAudit(tx, { actorId: actor.id, action: "formula_version.packaging_saved", entity: "formula_versions", entityId: versionId, after: { item: item.code, qtyPerUnit: input.qtyPerUnit } });
}

export async function removePackaging(tx: Tx, actor: Actor, packagingId: string): Promise<void> {
  assertCan(actor, "formulas.write");
  const [row] = await tx.select().from(formulaPackaging).where(eq(formulaPackaging.id, packagingId)).limit(1);
  if (!row) throw new UserError("Không tìm thấy dòng bao bì");
  await draftVersion(tx, row.formulaVersionId);
  await tx.delete(formulaPackaging).where(eq(formulaPackaging.id, packagingId));
  await writeAudit(tx, { actorId: actor.id, action: "formula_version.packaging_removed", entity: "formula_versions", entityId: row.formulaVersionId, before: { itemId: row.itemId } });
}

// ---------------------------------------------------------------------------------------------
// Vòng đời (draft → trial → approved → archived)

export async function changeVersionStatus(tx: Tx, actor: Actor, versionId: string, to: FormulaVersionStatus): Promise<void> {
  assertCan(actor, "formulas.write");
  const [v] = await tx.select().from(formulaVersions).where(eq(formulaVersions.id, versionId)).limit(1);
  if (!v) throw new UserError("Không tìm thấy phiên bản công thức");
  if (!canChangeVersionStatus(v.status, to)) throw new UserError(`Không chuyển được từ ${VERSION_STATUS_LABEL[v.status]} sang ${VERSION_STATUS_LABEL[to]}`);

  // Rời bản nháp: kiểm tổng tỷ lệ, lưu tỷ lệ dòng cân bằng (R-SX-5)
  if (v.status === "draft") {
    const lines = await tx
      .select({ id: formulaLines.id, itemId: formulaLines.itemId, ppm: formulaLines.ppm, isBalance: formulaLines.isBalance, itemCode: inventoryItems.code })
      .from(formulaLines)
      .innerJoin(inventoryItems, eq(inventoryItems.id, formulaLines.itemId))
      .where(eq(formulaLines.formulaVersionId, versionId));
    const check = checkFormulaTotals(lines);
    if (!check.ok) throw new UserError(check.message);
    const bal = lines.find((l) => l.isBalance);
    if (bal && check.balancePpm !== null) await tx.update(formulaLines).set({ ppm: check.balancePpm }).where(eq(formulaLines.id, bal.id));
  }

  const now = new Date();
  // Một bản approved mỗi công thức: bản cũ → archived trong cùng giao dịch (AC-SX-8)
  let archivedOld: string | null = null;
  if (to === "approved") {
    const old = await tx
      .update(formulaVersions)
      .set({ status: "archived" })
      .where(and(eq(formulaVersions.formulaId, v.formulaId), eq(formulaVersions.status, "approved")))
      .returning({ id: formulaVersions.id, label: formulaVersions.label });
    archivedOld = old[0]?.label ?? null;
  }
  const [row] = await tx
    .update(formulaVersions)
    .set({ status: to, ...(to === "approved" ? { approvedBy: actor.id, approvedAt: now } : {}) })
    .where(and(eq(formulaVersions.id, versionId), eq(formulaVersions.status, v.status)))
    .returning({ id: formulaVersions.id });
  if (!row) throw new UserError(STALE);
  await tx.update(formulas).set({ updatedAt: now }).where(eq(formulas.id, v.formulaId));
  await writeAudit(tx, { actorId: actor.id, action: `formula_version.${to}`, entity: "formula_versions", entityId: versionId, before: { status: v.status }, after: { status: to, label: v.label, archivedOld } });
}

// Sửa bản đã rời nháp = tạo phiên bản mới, chép dòng (R-SX-4, ghi chú thay đổi bắt buộc)
export async function createNextVersion(tx: Tx, actor: Actor, fromVersionId: string, changeNote: string): Promise<{ versionId: string; label: string }> {
  assertCan(actor, "formulas.write");
  const note = changeNote.trim();
  if (!note) throw new UserError("Ghi nội dung thay đổi của phiên bản mới");
  const src = await loadVersion(tx, fromVersionId);
  if (!src) throw new UserError("Không tìm thấy phiên bản công thức");
  const [f] = await tx
    .select({ id: formulas.id, code: formulas.code, productCode: products.code })
    .from(formulas)
    .leftJoin(products, eq(products.id, formulas.productId))
    .where(eq(formulas.id, src.formulaId))
    .for("update", { of: formulas })
    .limit(1);
  const [m] = await tx.select({ m: max(formulaVersions.version) }).from(formulaVersions).where(eq(formulaVersions.formulaId, src.formulaId));
  const version = (m?.m ?? 0) + 1;
  const label = formulaVersionLabel(f!.productCode ?? null, f!.code, version);
  const [v] = await tx
    .insert(formulaVersions)
    .values({
      formulaId: src.formulaId,
      version,
      label,
      batchSize: src.batchSize,
      batchUom: src.batchUom,
      bulkDensityMgPerMl: src.bulkDensityMgPerMl,
      expectedYieldBp: src.expectedYieldBp,
      processNote: src.processNote,
      changeNote: note,
      basedOnVersionId: src.id,
      createdBy: actor.id,
    })
    .returning({ id: formulaVersions.id });
  if (src.lines.length) {
    await tx.insert(formulaLines).values(
      src.lines.map((l) => ({ formulaVersionId: v!.id, itemId: l.itemId, ppm: l.isBalance ? 0 : l.ppm, isBalance: l.isBalance, phase: l.phase, note: l.note, sort: l.sort })),
    );
  }
  if (src.packaging.length) {
    await tx.insert(formulaPackaging).values(src.packaging.map((p) => ({ formulaVersionId: v!.id, itemId: p.itemId, qtyPerUnit: p.qtyPerUnit, note: p.note, sort: p.sort })));
  }
  await writeAudit(tx, { actorId: actor.id, action: "formula_version.created", entity: "formula_versions", entityId: v!.id, after: { label, basedOn: src.label, changeNote: note } });
  return { versionId: v!.id, label };
}

// R-SX-11: so sánh hai phiên bản
export async function compareVersions(db: Db | Tx, actor: Actor, fromId: string, toId: string): Promise<{ from: string; to: string; changes: string[]; changeNote: string }> {
  assertCan(actor, "formulas.view");
  const a = await loadVersion(db, fromId);
  const b = await loadVersion(db, toId);
  if (!a || !b) throw new UserError("Không tìm thấy phiên bản công thức");
  if (a.formulaId !== b.formulaId) throw new UserError("Hai phiên bản không cùng công thức");
  const snap = (v: NonNullable<VersionDetail>): VersionSnapshot => ({
    batchSize: v.batchSize,
    batchUom: v.batchUom as BaseUom,
    lines: v.lines.map((l) => ({ itemId: l.itemId, itemCode: l.itemCode, ppm: l.ppm, isBalance: l.isBalance })),
    packaging: v.packaging.map((p) => ({ itemId: p.itemId, itemCode: p.itemCode, qtyPerUnit: p.qtyPerUnit })),
  });
  return { from: a.label, to: b.label, changes: diffVersions(snap(a), snap(b)), changeNote: b.changeNote };
}

// Kiểm nhanh có công thức nào dùng hàng (để trang hàng hóa tra cứu)
export async function countFormulaUsage(db: Db | Tx, itemId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(formulaLines).where(eq(formulaLines.itemId, itemId));
  return Number(row?.n ?? 0);
}
