// Tiêu chuẩn chất lượng có phiên bản (03-chat-luong.md R-CL-1). Quyền kiểm lại ở đây để test được.
import { and, asc, desc, eq, max } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { inventoryItems, products, qcStandardParams, qcStandards } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { nextDocCode } from "@/modules/numbering/service";
import { actorCan, DOC_STALE, PERMISSION_DENIED, type Actor } from "./rules";

export type AppliesTo = "raw_material" | "extract" | "wip" | "finished" | "packaging";
export type ParamGroup = "origin" | "sensory" | "physicochemical" | "composition" | "microbial" | "heavy_metal" | "stability" | "packaging" | "label" | "other";
export type LotTestTypeKey = "microbial" | "heavy_metals" | "stability" | "gc_ms" | "irritation" | "sensory";

export type StandardParamInput = {
  name: string;
  paramGroup: ParamGroup;
  kind: "range" | "pass_fail" | "text";
  unit?: string;
  minMilli?: number | null;
  maxMilli?: number | null;
  expectedText?: string | null;
  method?: string;
  lotTestType?: LotTestTypeKey | null;
  isCritical?: boolean;
};

export type StandardInput = {
  name: string;
  appliesTo: AppliesTo;
  itemId?: string | null;
  productId?: string | null;
  effectiveFrom?: string | null;
  fileIds?: string[];
  note?: string | null;
  params: StandardParamInput[];
};

function need(actor: Actor, p: "quality.write" | "quality.approve") {
  if (!actorCan(actor, p)) throw new UserError(PERMISSION_DENIED);
}

function checkParams(params: StandardParamInput[]) {
  for (const p of params) {
    if (!p.name.trim()) throw new UserError("Chỉ tiêu cần có tên");
    if (p.kind === "range" && p.minMilli != null && p.maxMilli != null && p.minMilli > p.maxMilli) throw new UserError(`Chỉ tiêu ${p.name}: giới hạn dưới lớn hơn giới hạn trên`);
  }
}

async function insertParams(tx: Tx, standardId: string, params: StandardParamInput[]) {
  if (params.length === 0) return;
  await tx.insert(qcStandardParams).values(
    params.map((p, i) => ({
      standardId,
      name: p.name.trim(),
      paramGroup: p.paramGroup,
      kind: p.kind,
      unit: p.unit?.trim() ?? "",
      minMilli: p.kind === "range" ? (p.minMilli ?? null) : null,
      maxMilli: p.kind === "range" ? (p.maxMilli ?? null) : null,
      expectedText: p.expectedText?.trim() || null,
      method: p.method?.trim() ?? "",
      lotTestType: p.lotTestType ?? null,
      isCritical: p.isCritical ?? true,
      sort: i,
    })),
  );
}

async function checkTarget(tx: Tx, input: StandardInput) {
  if (!input.name.trim()) throw new UserError("Nhập tên tiêu chuẩn");
  if (input.itemId && input.productId) throw new UserError("Tiêu chuẩn gắn hàng hoặc sản phẩm, không gắn cả hai");
  if (input.itemId) {
    const [i] = await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.id, input.itemId));
    if (!i) throw new UserError("Không tìm thấy hàng hóa");
  }
  if (input.productId) {
    const [p] = await tx.select({ id: products.id }).from(products).where(eq(products.id, input.productId));
    if (!p) throw new UserError("Không tìm thấy sản phẩm");
  }
  checkParams(input.params);
}

// Tạo bản nháp v1 với mã TC-NNN tự sinh
export async function createStandard(tx: Tx, input: StandardInput, actor: Actor): Promise<{ id: string; code: string }> {
  need(actor, "quality.write");
  await checkTarget(tx, input);
  const code = await nextDocCode(tx, "TC");
  const [row] = await tx
    .insert(qcStandards)
    .values({
      code,
      version: 1,
      name: input.name.trim(),
      appliesTo: input.appliesTo,
      itemId: input.itemId ?? null,
      productId: input.productId ?? null,
      effectiveFrom: input.effectiveFrom ?? null,
      fileIds: input.fileIds ?? [],
      note: input.note ?? null,
      createdBy: actor.id,
    })
    .returning({ id: qcStandards.id });
  await insertParams(tx, row!.id, input.params);
  await writeAudit(tx, { actorId: actor.id, action: "qc_standard.created", entity: "qc_standards", entityId: row!.id, after: { code, version: 1, params: input.params.length } });
  return { id: row!.id, code };
}

// Sửa bản nháp: thay toàn bộ chỉ tiêu
export async function updateStandardDraft(tx: Tx, standardId: string, input: StandardInput, actor: Actor): Promise<void> {
  need(actor, "quality.write");
  const [s] = await tx.select().from(qcStandards).where(eq(qcStandards.id, standardId));
  if (!s) throw new UserError("Không tìm thấy tiêu chuẩn");
  if (s.status !== "draft") throw new UserError("Chỉ sửa được bản nháp. Bản đang dùng: tạo phiên bản mới.");
  await checkTarget(tx, input);
  const [row] = await tx
    .update(qcStandards)
    .set({
      name: input.name.trim(),
      appliesTo: input.appliesTo,
      itemId: input.itemId ?? null,
      productId: input.productId ?? null,
      effectiveFrom: input.effectiveFrom ?? null,
      fileIds: input.fileIds ?? s.fileIds,
      note: input.note ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(qcStandards.id, standardId), eq(qcStandards.status, "draft")))
    .returning({ id: qcStandards.id });
  if (!row) throw new UserError(DOC_STALE);
  await tx.delete(qcStandardParams).where(eq(qcStandardParams.standardId, standardId));
  await insertParams(tx, standardId, input.params);
  await writeAudit(tx, { actorId: actor.id, action: "qc_standard.updated", entity: "qc_standards", entityId: standardId, after: { params: input.params.length } });
}

// Kích hoạt (quality.approve): bản active cũ cùng mã → archived trong cùng giao dịch
export async function activateStandard(tx: Tx, standardId: string, actor: Actor): Promise<void> {
  need(actor, "quality.approve");
  const [s] = await tx.select().from(qcStandards).where(eq(qcStandards.id, standardId));
  if (!s) throw new UserError("Không tìm thấy tiêu chuẩn");
  if (s.status !== "draft") throw new UserError(DOC_STALE);
  const archived = await tx
    .update(qcStandards)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(qcStandards.code, s.code), eq(qcStandards.status, "active")))
    .returning({ id: qcStandards.id, version: qcStandards.version });
  const [row] = await tx
    .update(qcStandards)
    .set({ status: "active", approvedBy: actor.id, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(qcStandards.id, standardId), eq(qcStandards.status, "draft")))
    .returning({ id: qcStandards.id });
  if (!row) throw new UserError(DOC_STALE);
  for (const a of archived) {
    await writeAudit(tx, { actorId: actor.id, action: "qc_standard.archived", entity: "qc_standards", entityId: a.id, before: { status: "active" }, after: { status: "archived", replacedBy: standardId } });
  }
  await writeAudit(tx, { actorId: actor.id, action: "qc_standard.activated", entity: "qc_standards", entityId: standardId, before: { status: "draft" }, after: { status: "active", code: s.code, version: s.version } });
}

export async function archiveStandard(tx: Tx, standardId: string, actor: Actor): Promise<void> {
  need(actor, "quality.approve");
  const [s] = await tx.select().from(qcStandards).where(eq(qcStandards.id, standardId));
  if (!s) throw new UserError("Không tìm thấy tiêu chuẩn");
  if (s.status === "archived") throw new UserError(DOC_STALE);
  const [row] = await tx
    .update(qcStandards)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(qcStandards.id, standardId), eq(qcStandards.status, s.status)))
    .returning({ id: qcStandards.id });
  if (!row) throw new UserError(DOC_STALE);
  await writeAudit(tx, { actorId: actor.id, action: "qc_standard.archived", entity: "qc_standards", entityId: standardId, before: { status: s.status }, after: { status: "archived" } });
}

// Phiên bản mới: chép thông tin và chỉ tiêu, bản nháp version = lớn nhất + 1. Đã có nháp cùng mã thì trả bản đó.
export async function newStandardVersion(tx: Tx, standardId: string, actor: Actor): Promise<{ id: string; version: number; created: boolean }> {
  need(actor, "quality.write");
  const [s] = await tx.select().from(qcStandards).where(eq(qcStandards.id, standardId));
  if (!s) throw new UserError("Không tìm thấy tiêu chuẩn");
  const [draft] = await tx.select({ id: qcStandards.id, version: qcStandards.version }).from(qcStandards).where(and(eq(qcStandards.code, s.code), eq(qcStandards.status, "draft")));
  if (draft) return { ...draft, created: false };
  const [{ v } = { v: 0 }] = await tx.select({ v: max(qcStandards.version) }).from(qcStandards).where(eq(qcStandards.code, s.code));
  const version = (v ?? 0) + 1;
  const [row] = await tx
    .insert(qcStandards)
    .values({
      code: s.code,
      version,
      name: s.name,
      appliesTo: s.appliesTo,
      itemId: s.itemId,
      productId: s.productId,
      effectiveFrom: null,
      fileIds: s.fileIds,
      note: s.note,
      createdBy: actor.id,
    })
    .returning({ id: qcStandards.id });
  const params = await tx.select().from(qcStandardParams).where(eq(qcStandardParams.standardId, standardId)).orderBy(asc(qcStandardParams.sort));
  await insertParams(
    tx,
    row!.id,
    params.map((p) => ({ ...p, unit: p.unit, method: p.method })),
  );
  await writeAudit(tx, { actorId: actor.id, action: "qc_standard.version_created", entity: "qc_standards", entityId: row!.id, after: { code: s.code, version, from: s.version } });
  return { id: row!.id, version, created: true };
}

// ---------------------------------------------------------------------------------------------
// Đọc

export async function listStandards(db?: Db) {
  const d = db ?? (await getDb());
  return d
    .select({
      id: qcStandards.id,
      code: qcStandards.code,
      version: qcStandards.version,
      name: qcStandards.name,
      appliesTo: qcStandards.appliesTo,
      status: qcStandards.status,
      effectiveFrom: qcStandards.effectiveFrom,
      itemCode: inventoryItems.code,
      productName: products.name,
    })
    .from(qcStandards)
    .leftJoin(inventoryItems, eq(inventoryItems.id, qcStandards.itemId))
    .leftJoin(products, eq(products.id, qcStandards.productId))
    .orderBy(asc(qcStandards.appliesTo), asc(qcStandards.code), desc(qcStandards.version));
}

export async function getStandard(id: string, db?: Db) {
  const d = db ?? (await getDb());
  const [s] = await d.select().from(qcStandards).where(eq(qcStandards.id, id));
  if (!s) return null;
  const [params, versions, item, product] = await Promise.all([
    d.select().from(qcStandardParams).where(eq(qcStandardParams.standardId, id)).orderBy(asc(qcStandardParams.sort)),
    d.select({ id: qcStandards.id, version: qcStandards.version, status: qcStandards.status, approvedAt: qcStandards.approvedAt }).from(qcStandards).where(eq(qcStandards.code, s.code)).orderBy(desc(qcStandards.version)),
    s.itemId ? d.select({ code: inventoryItems.code, name: inventoryItems.name }).from(inventoryItems).where(eq(inventoryItems.id, s.itemId)) : Promise.resolve([]),
    s.productId ? d.select({ name: products.name }).from(products).where(eq(products.id, s.productId)) : Promise.resolve([]),
  ]);
  return { standard: s, params, versions, item: item[0] ?? null, product: product[0] ?? null };
}
