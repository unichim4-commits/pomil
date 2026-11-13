// CAPA: hành động khắc phục, phòng ngừa (03-chat-luong.md R-CL-17).
import { and, asc, eq, max } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { capaActions, capas, complaints, ncrs } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { nextDocCode } from "@/modules/numbering/service";
import { actorCan, CAPA_STATUS_LABEL, CAPA_SUGGESTED_STEPS, canTransitionCapa, checkCapaClose, checkCapaVerifying, DOC_STALE, PERMISSION_DENIED, type Actor, type CapaStatus } from "./rules";

export type CapaInput = {
  type: "corrective" | "preventive";
  title: string;
  problem: string;
  ncrId?: string | null;
  complaintId?: string | null;
  lotId?: string | null;
  rootCauseMethod?: string;
  rootCause?: string;
  actionPlan?: string;
  ownerId?: string | null;
  dueOn?: string | null;
  effectivenessCriteria?: string;
  effectivenessCheckOn?: string | null;
  steps?: { description: string; ownerId?: string | null; dueOn?: string | null }[];
};

function need(actor: Actor, p: "quality.write" | "quality.approve") {
  if (!actorCan(actor, p)) throw new UserError(PERMISSION_DENIED);
}

export async function createCapa(tx: Tx, input: CapaInput, actor: Actor): Promise<{ id: string; code: string }> {
  need(actor, "quality.write");
  if (!input.title.trim()) throw new UserError("Nhập tiêu đề CAPA");
  if (!input.problem.trim()) throw new UserError("Mô tả vấn đề");
  if (input.ncrId) {
    const [n] = await tx.select({ id: ncrs.id }).from(ncrs).where(eq(ncrs.id, input.ncrId));
    if (!n) throw new UserError("Không tìm thấy NCR");
  }
  const code = await nextDocCode(tx, "CAPA");
  const [row] = await tx
    .insert(capas)
    .values({
      code,
      type: input.type,
      title: input.title.trim(),
      problem: input.problem.trim(),
      ncrId: input.ncrId ?? null,
      complaintId: input.complaintId ?? null,
      lotId: input.lotId ?? null,
      rootCauseMethod: input.rootCauseMethod ?? "",
      rootCause: input.rootCause ?? "",
      actionPlan: input.actionPlan ?? "",
      ownerId: input.ownerId ?? null,
      dueOn: input.dueOn ?? null,
      effectivenessCriteria: input.effectivenessCriteria ?? "",
      effectivenessCheckOn: input.effectivenessCheckOn ?? null,
      createdBy: actor.id,
    })
    .returning({ id: capas.id });
  const steps = (input.steps ?? []).filter((s) => s.description.trim());
  if (steps.length > 0) {
    await tx.insert(capaActions).values(steps.map((s, i) => ({ capaId: row!.id, description: s.description.trim(), ownerId: s.ownerId ?? null, dueOn: s.dueOn ?? null, sort: i })));
  }
  await writeAudit(tx, { actorId: actor.id, action: "capa.created", entity: "capas", entityId: row!.id, after: { code, type: input.type, ncrId: input.ncrId ?? null, steps: steps.length } });
  return { id: row!.id, code };
}

// Tạo CAPA từ phản ánh: gợi ý sẵn 7 bước, gắn lô và NCR của phản ánh (nếu có)
export async function createCapaFromComplaint(tx: Tx, complaintId: string, actor: Actor, opts: { ownerId?: string | null; dueOn?: string | null } = {}): Promise<{ id: string; code: string }> {
  need(actor, "quality.write");
  const [c] = await tx.select().from(complaints).where(eq(complaints.id, complaintId));
  if (!c) throw new UserError("Không tìm thấy phản ánh");
  const [ncr] = await tx.select({ id: ncrs.id }).from(ncrs).where(eq(ncrs.complaintId, complaintId)).limit(1);
  return createCapa(
    tx,
    {
      type: "corrective",
      title: "Khắc phục theo phản ánh của khách",
      problem: c.symptoms,
      complaintId,
      lotId: c.lotId,
      ncrId: ncr?.id ?? null,
      ownerId: opts.ownerId ?? actor.id,
      dueOn: opts.dueOn ?? null,
      steps: CAPA_SUGGESTED_STEPS.map((d) => ({ description: d, ownerId: opts.ownerId ?? actor.id, dueOn: opts.dueOn ?? null })),
    },
    actor,
  );
}

async function loadOpen(tx: Tx, capaId: string) {
  const [c] = await tx.select().from(capas).where(eq(capas.id, capaId));
  if (!c) throw new UserError("Không tìm thấy CAPA");
  if (c.status === "closed" || c.status === "cancelled") throw new UserError("CAPA đã đóng");
  return c;
}

export async function updateCapa(tx: Tx, capaId: string, data: Partial<Pick<CapaInput, "title" | "problem" | "rootCauseMethod" | "rootCause" | "actionPlan" | "ownerId" | "dueOn" | "effectivenessCriteria" | "effectivenessCheckOn">>, actor: Actor): Promise<void> {
  need(actor, "quality.write");
  const c = await loadOpen(tx, capaId);
  const [row] = await tx
    .update(capas)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(capas.id, capaId), eq(capas.status, c.status)))
    .returning({ id: capas.id });
  if (!row) throw new UserError(DOC_STALE);
  await writeAudit(tx, { actorId: actor.id, action: "capa.updated", entity: "capas", entityId: capaId, after: { fields: Object.keys(data) } });
}

export async function addCapaAction(tx: Tx, capaId: string, input: { description: string; ownerId?: string | null; dueOn?: string | null }, actor: Actor): Promise<{ id: string }> {
  need(actor, "quality.write");
  const c = await loadOpen(tx, capaId);
  if (c.status === "verifying") throw new UserError("CAPA đang đánh giá hiệu quả. Chuyển về Đang làm để thêm bước.");
  if (!input.description.trim()) throw new UserError("Mô tả bước hành động");
  const [{ s } = { s: -1 }] = await tx.select({ s: max(capaActions.sort) }).from(capaActions).where(eq(capaActions.capaId, capaId));
  const [row] = await tx
    .insert(capaActions)
    .values({ capaId, description: input.description.trim(), ownerId: input.ownerId ?? null, dueOn: input.dueOn ?? null, sort: (s ?? -1) + 1 })
    .returning({ id: capaActions.id });
  await writeAudit(tx, { actorId: actor.id, action: "capa.action_added", entity: "capa_actions", entityId: row!.id, after: { capaId } });
  return { id: row!.id };
}

// Đánh dấu bước xong (hoặc mở lại khi done = false)
export async function setCapaActionDone(tx: Tx, actionId: string, done: boolean, result: string | null, actor: Actor): Promise<void> {
  need(actor, "quality.write");
  const [a] = await tx.select().from(capaActions).where(eq(capaActions.id, actionId));
  if (!a) throw new UserError("Không tìm thấy bước");
  const c = await loadOpen(tx, a.capaId);
  if (c.status === "verifying") throw new UserError("CAPA đang đánh giá hiệu quả, không sửa bước");
  await tx
    .update(capaActions)
    .set({ doneAt: done ? (a.doneAt ?? new Date()) : null, result: result ?? a.result })
    .where(eq(capaActions.id, actionId));
  // Bắt đầu làm bước đầu tiên thì CAPA chuyển "Đang làm"
  if (done && c.status === "open") {
    await tx.update(capas).set({ status: "in_progress", updatedAt: new Date() }).where(and(eq(capas.id, c.id), eq(capas.status, "open")));
  }
  await writeAudit(tx, { actorId: actor.id, action: done ? "capa.action_done" : "capa.action_reopened", entity: "capa_actions", entityId: actionId, after: { capaId: a.capaId, result } });
}

// Chuyển trạng thái: verifying cần mọi bước xong; closed cần quality.approve, kết quả và effective = true.
export async function transitionCapa(
  tx: Tx,
  capaId: string,
  to: CapaStatus,
  actor: Actor,
  opts: { expectedFrom?: CapaStatus; effectivenessResult?: string; effective?: boolean | null; reason?: string | null } = {},
): Promise<void> {
  need(actor, to === "closed" ? "quality.approve" : "quality.write");
  const [c] = await tx.select().from(capas).where(eq(capas.id, capaId));
  if (!c) throw new UserError("Không tìm thấy CAPA");
  const from = opts.expectedFrom ?? c.status;
  if (from !== c.status) throw new UserError(DOC_STALE);
  if (!canTransitionCapa(from, to)) throw new UserError(`Không chuyển CAPA từ "${CAPA_STATUS_LABEL[from]}" sang "${CAPA_STATUS_LABEL[to]}"`);
  const patch: Partial<typeof capas.$inferInsert> = { status: to, updatedAt: new Date() };
  if (to === "verifying") {
    const actions = await tx.select({ doneAt: capaActions.doneAt }).from(capaActions).where(eq(capaActions.capaId, capaId)).orderBy(asc(capaActions.sort));
    const err = checkCapaVerifying(actions);
    if (err) throw new UserError(err);
  }
  if (to === "closed") {
    const result = opts.effectivenessResult ?? c.effectivenessResult;
    const effective = opts.effective === undefined ? c.effective : opts.effective;
    const err = checkCapaClose({ effectivenessResult: result, effective });
    if (err) throw new UserError(err);
    Object.assign(patch, { effectivenessResult: result, effective, closedBy: actor.id, closedAt: new Date() });
  }
  if (to === "cancelled") {
    const why = opts.reason?.trim();
    if (!why) throw new UserError("Ghi lý do hủy CAPA");
    patch.effectivenessResult = c.effectivenessResult ? `${c.effectivenessResult}\nHủy: ${why}` : `Hủy: ${why}`;
  }
  const [row] = await tx
    .update(capas)
    .set(patch)
    .where(and(eq(capas.id, capaId), eq(capas.status, from)))
    .returning({ id: capas.id });
  if (!row) throw new UserError(DOC_STALE);
  await writeAudit(tx, { actorId: actor.id, action: `capa.${to}`, entity: "capas", entityId: capaId, before: { status: from }, after: { status: to } });
}

// Ghi kết quả đánh giá hiệu quả khi đang verifying. Chưa hiệu quả → quay lại "Đang làm" để thêm bước.
export async function recordCapaEffectiveness(tx: Tx, capaId: string, input: { result: string; effective: boolean }, actor: Actor): Promise<{ status: CapaStatus }> {
  need(actor, "quality.write");
  const [c] = await tx.select().from(capas).where(eq(capas.id, capaId));
  if (!c) throw new UserError("Không tìm thấy CAPA");
  if (c.status !== "verifying") throw new UserError("Chỉ đánh giá hiệu quả khi mọi bước đã xong");
  if (!input.result.trim()) throw new UserError("Ghi kết quả đánh giá hiệu quả");
  const status: CapaStatus = input.effective ? "verifying" : "in_progress";
  const [row] = await tx
    .update(capas)
    .set({ effectivenessResult: input.result.trim(), effective: input.effective, status, updatedAt: new Date() })
    .where(and(eq(capas.id, capaId), eq(capas.status, "verifying")))
    .returning({ id: capas.id });
  if (!row) throw new UserError(DOC_STALE);
  await writeAudit(tx, { actorId: actor.id, action: "capa.effectiveness", entity: "capas", entityId: capaId, before: { status: "verifying" }, after: { status, effective: input.effective } });
  return { status };
}
