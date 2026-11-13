// Phiếu sai lỗi NCR (03-chat-luong.md R-CL-15, R-CL-16).
import { and, count, eq, ne } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { capas, complaints, lots, ncrs, orderItems, returnRequests } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { nextDocCode } from "@/modules/numbering/service";
import { actorCan, canTransitionNcr, checkNcrClose, DOC_STALE, ncrSeverityFromComplaint, ncrTransitionPermission, NCR_STATUS_LABEL, PERMISSION_DENIED, type Actor, type NcrCategory, type NcrSeverity, type NcrStatus } from "./rules";

export type NcrLinks = {
  complaintId?: string | null;
  lotId?: string | null;
  stockLotId?: string | null;
  productionOrderId?: string | null;
  extractionRunId?: string | null;
  inspectionId?: string | null;
  supplierId?: string | null;
  returnRequestId?: string | null;
};

export type NcrInput = NcrLinks & {
  title: string;
  category: NcrCategory;
  severity: NcrSeverity;
  description: string;
  containment?: string;
  ownerId?: string | null;
  dueOn?: string | null;
};

// Ghi NCR không kiểm quyền: dùng bên trong giao dịch quyết định phiếu kiểm (người gọi đã kiểm quyền)
export async function insertNcr(tx: Tx, input: NcrInput, actorId: string | null): Promise<{ id: string; code: string }> {
  if (!input.title.trim()) throw new UserError("Nhập tiêu đề NCR");
  if (!input.description.trim()) throw new UserError("Nhập mô tả sai lỗi");
  const code = await nextDocCode(tx, "NCR");
  const [row] = await tx
    .insert(ncrs)
    .values({
      code,
      title: input.title.trim(),
      category: input.category,
      severity: input.severity,
      description: input.description.trim(),
      containment: input.containment?.trim() ?? "",
      ownerId: input.ownerId ?? null,
      dueOn: input.dueOn ?? null,
      complaintId: input.complaintId ?? null,
      lotId: input.lotId ?? null,
      stockLotId: input.stockLotId ?? null,
      productionOrderId: input.productionOrderId ?? null,
      extractionRunId: input.extractionRunId ?? null,
      inspectionId: input.inspectionId ?? null,
      supplierId: input.supplierId ?? null,
      returnRequestId: input.returnRequestId ?? null,
      createdBy: actorId,
    })
    .returning({ id: ncrs.id });
  await writeAudit(tx, { actorId, action: "ncr.created", entity: "ncrs", entityId: row!.id, after: { code, category: input.category, severity: input.severity } });
  return { id: row!.id, code };
}

export async function createNcr(tx: Tx, input: NcrInput, actor: Actor): Promise<{ id: string; code: string }> {
  if (!actorCan(actor, "quality.write")) throw new UserError(PERMISSION_DENIED);
  return insertNcr(tx, input, actor.id);
}

// R-CL-16: tạo NCR từ phản ánh. Phản ánh open/responded → investigating. Đã có NCR chưa hủy thì trả NCR đó.
export async function createNcrFromComplaint(tx: Tx, complaintId: string, actor: Actor): Promise<{ id: string; code: string; created: boolean }> {
  if (!actorCan(actor, "quality.write")) throw new UserError(PERMISSION_DENIED);
  const [c] = await tx.select().from(complaints).where(eq(complaints.id, complaintId));
  if (!c) throw new UserError("Không tìm thấy phản ánh");
  const [existing] = await tx.select({ id: ncrs.id, code: ncrs.code }).from(ncrs).where(and(eq(ncrs.complaintId, complaintId), ne(ncrs.status, "cancelled")));
  if (existing) return { ...existing, created: false };
  const lot = c.lotId ? (await tx.select({ lotNo: lots.lotNo }).from(lots).where(eq(lots.id, c.lotId)))[0] : undefined;
  const r = await insertNcr(
    tx,
    {
      title: `Phản ánh của khách${lot ? `: lô ${lot.lotNo}` : ""}`,
      category: "customer_complaint",
      severity: ncrSeverityFromComplaint(c.severity),
      description: c.symptoms,
      complaintId,
      lotId: c.lotId,
    },
    actor.id,
  );
  if (c.status === "open" || c.status === "responded") {
    await tx
      .update(complaints)
      .set({ status: "investigating", firstResponseAt: c.firstResponseAt ?? new Date() })
      .where(and(eq(complaints.id, complaintId), eq(complaints.status, c.status)));
    await writeAudit(tx, { actorId: actor.id, action: "complaint.updated", entity: "complaints", entityId: complaintId, before: { status: c.status }, after: { status: "investigating", ncr: r.code } });
  }
  return { ...r, created: true };
}

// R-CL-16: NCR từ đổi trả lý do lỗi sản phẩm (gắn return_request_id; lô lấy từ dòng đơn nếu chỉ một lô)
export async function createNcrFromReturn(tx: Tx, returnRequestId: string, actor: Actor): Promise<{ id: string; code: string; created: boolean }> {
  if (!actorCan(actor, "quality.write")) throw new UserError(PERMISSION_DENIED);
  const [rr] = await tx.select().from(returnRequests).where(eq(returnRequests.id, returnRequestId));
  if (!rr) throw new UserError("Không tìm thấy phiếu đổi trả");
  if (rr.reason !== "defect") throw new UserError("Chỉ tạo NCR cho đổi trả lý do lỗi sản phẩm");
  const [existing] = await tx.select({ id: ncrs.id, code: ncrs.code }).from(ncrs).where(and(eq(ncrs.returnRequestId, returnRequestId), ne(ncrs.status, "cancelled")));
  if (existing) return { ...existing, created: false };
  const lotIds = [...new Set((await tx.select({ lotId: orderItems.lotId }).from(orderItems).where(eq(orderItems.orderId, rr.orderId))).map((r) => r.lotId).filter((x): x is string => !!x))];
  const r = await insertNcr(
    tx,
    {
      title: `Đổi trả lỗi sản phẩm ${rr.code}`,
      category: "product",
      severity: "major",
      description: rr.reasonNote.trim() || "Khách trả hàng vì lỗi sản phẩm",
      returnRequestId,
      complaintId: rr.complaintId,
      lotId: lotIds.length === 1 ? lotIds[0] : null,
    },
    actor.id,
  );
  return { ...r, created: true };
}

export type NcrUpdate = {
  title?: string;
  description?: string;
  severity?: NcrSeverity;
  containment?: string;
  rootCause?: string;
  correction?: string;
  verificationNote?: string;
  ownerId?: string | null;
  dueOn?: string | null;
};

export async function updateNcr(tx: Tx, ncrId: string, data: NcrUpdate, actor: Actor): Promise<void> {
  if (!actorCan(actor, "quality.write")) throw new UserError(PERMISSION_DENIED);
  const [n] = await tx.select().from(ncrs).where(eq(ncrs.id, ncrId));
  if (!n) throw new UserError("Không tìm thấy NCR");
  if (n.status === "closed" || n.status === "cancelled") throw new UserError("NCR đã đóng, không sửa được");
  if (data.title !== undefined && !data.title.trim()) throw new UserError("Nhập tiêu đề NCR");
  if (data.description !== undefined && !data.description.trim()) throw new UserError("Nhập mô tả sai lỗi");
  const [row] = await tx
    .update(ncrs)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(ncrs.id, ncrId), eq(ncrs.status, n.status)))
    .returning({ id: ncrs.id });
  if (!row) throw new UserError(DOC_STALE);
  await writeAudit(tx, { actorId: actor.id, action: "ncr.updated", entity: "ncrs", entityId: ncrId, after: { fields: Object.keys(data) } });
}

// Chuyển trạng thái (R-CL-15). Đóng: đủ nguyên nhân, biện pháp, xác nhận; critical cần CAPA. Hủy: lý do.
export async function transitionNcr(tx: Tx, ncrId: string, to: NcrStatus, actor: Actor, opts: { expectedFrom?: NcrStatus; reason?: string | null } = {}): Promise<void> {
  if (!actorCan(actor, ncrTransitionPermission(to))) throw new UserError(PERMISSION_DENIED);
  const [n] = await tx.select().from(ncrs).where(eq(ncrs.id, ncrId));
  if (!n) throw new UserError("Không tìm thấy NCR");
  const from = opts.expectedFrom ?? n.status;
  if (from !== n.status) throw new UserError(DOC_STALE);
  if (!canTransitionNcr(from, to)) throw new UserError(`Không chuyển NCR từ "${NCR_STATUS_LABEL[from]}" sang "${NCR_STATUS_LABEL[to]}"`);
  const patch: Partial<typeof ncrs.$inferInsert> = { status: to, updatedAt: new Date() };
  if (to === "closed") {
    const [{ n: capaCount } = { n: 0 }] = await tx.select({ n: count() }).from(capas).where(and(eq(capas.ncrId, ncrId), ne(capas.status, "cancelled")));
    const err = checkNcrClose({ severity: n.severity, rootCause: n.rootCause, correction: n.correction, verificationNote: n.verificationNote, capaCount });
    if (err) throw new UserError(err);
    patch.closedBy = actor.id;
    patch.closedAt = new Date();
  }
  if (to === "cancelled") {
    const why = opts.reason?.trim();
    if (!why) throw new UserError("Ghi lý do hủy NCR");
    patch.verificationNote = n.verificationNote ? `${n.verificationNote}\nHủy: ${why}` : `Hủy: ${why}`;
    patch.closedBy = actor.id;
    patch.closedAt = new Date();
  }
  const [row] = await tx
    .update(ncrs)
    .set(patch)
    .where(and(eq(ncrs.id, ncrId), eq(ncrs.status, from)))
    .returning({ id: ncrs.id });
  if (!row) throw new UserError(DOC_STALE);

  // Đóng NCR: chép nguyên nhân, biện pháp sang phản ánh nếu ô còn trống (R-CL-16)
  if (to === "closed" && n.complaintId) {
    const [c] = await tx.select().from(complaints).where(eq(complaints.id, n.complaintId));
    if (c) {
      const fill: Partial<typeof complaints.$inferInsert> = {};
      if (!c.rootCause?.trim()) fill.rootCause = n.rootCause;
      if (!c.correctiveAction?.trim()) fill.correctiveAction = n.correction;
      if (Object.keys(fill).length > 0) {
        await tx.update(complaints).set(fill).where(eq(complaints.id, c.id));
        await writeAudit(tx, { actorId: actor.id, action: "complaint.updated", entity: "complaints", entityId: c.id, after: { fromNcr: n.code, fields: Object.keys(fill) } });
      }
    }
  }
  await writeAudit(tx, { actorId: actor.id, action: `ncr.${to}`, entity: "ncrs", entityId: ncrId, before: { status: from }, after: { status: to, reason: opts.reason ?? null } });
}
