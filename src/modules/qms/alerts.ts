// Cảnh báo Chất lượng cho Tổng quan (00-tong-quan.md mục 8.7; 03-chat-luong.md R-CL-10, R-CL-18, R-CL-23, R-CL-25).
import { and, count, eq, inArray, isNotNull, isNull, lt, notInArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { capaActions, capas, extractionRuns, lots, ncrs, orderItems, orders, productionOrders, productionOrderSteps, qcInspections, recalls, retainedSamples } from "@/db/schema";
import type { StaffRole } from "@/modules/auth/rules";
import type { AdminAlert } from "@/modules/alerts";
import { vnToday } from "@/modules/numbering/rules";
import { isDeviationBlocking } from "./inspection-rules";

export type { AdminAlert };

export async function getAlerts(role: StaffRole): Promise<AdminAlert[]> {
  void role;
  const db = await getDb();
  return computeQmsAlerts(db, vnToday());
}

const STAGE_LABEL = { iqc: "IQC", ipqc: "IPQC", fqc: "FQC", recheck: "kiểm lại" } as const;

// Tách riêng để test truyền "hôm nay"
export async function computeQmsAlerts(db: Db, today: string): Promise<AdminAlert[]> {
  const out: AdminAlert[] = [];

  // IPQC lệch còn chặn (R-CL-10): danger, nêu mã lệnh và công đoạn / mẻ chiết
  const ipqc = await db
    .select({ stepId: qcInspections.productionStepId, runId: qcInspections.extractionRunId, orderId: qcInspections.productionOrderId, status: qcInspections.status, decidedAt: qcInspections.decidedAt, createdAt: qcInspections.createdAt })
    .from(qcInspections)
    .where(and(eq(qcInspections.stage, "ipqc"), inArray(qcInspections.status, ["passed", "failed"])));
  const groups = new Map<string, typeof ipqc>();
  for (const r of ipqc) {
    const key = r.stepId ? `step:${r.stepId}` : r.runId ? `run:${r.runId}` : null;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, rows] of groups) {
    if (!isDeviationBlocking(rows.map((r) => ({ key, status: r.status, decidedAt: r.decidedAt, createdAt: r.createdAt })))) continue;
    if (key.startsWith("step:")) {
      const [s] = await db
        .select({ name: productionOrderSteps.name, code: productionOrders.code, orderId: productionOrders.id })
        .from(productionOrderSteps)
        .innerJoin(productionOrders, eq(productionOrders.id, productionOrderSteps.productionOrderId))
        .where(eq(productionOrderSteps.id, key.slice(5)));
      if (s) out.push({ module: "chat-luong", level: "danger", text: `IPQC lệch: ${s.code}, công đoạn ${s.name}`, href: `/admin/san-xuat/lenh/${s.orderId}` });
    } else {
      const [r] = await db.select({ code: extractionRuns.code, id: extractionRuns.id }).from(extractionRuns).where(eq(extractionRuns.id, key.slice(4)));
      if (r) out.push({ module: "chat-luong", level: "danger", text: `IPQC lệch: mẻ chiết ${r.code}`, href: `/admin/san-xuat/chiet-xuat/${r.id}` });
    }
  }

  // Phiếu chờ theo stage
  const pending = await db.select({ stage: qcInspections.stage, n: count() }).from(qcInspections).where(eq(qcInspections.status, "pending")).groupBy(qcInspections.stage);
  for (const p of pending) {
    if (p.n > 0) out.push({ module: "chat-luong", level: "info", text: `${p.n} phiếu ${STAGE_LABEL[p.stage]} đang chờ`, href: `/admin/chat-luong/phieu-kiem?stage=${p.stage}`, count: p.n });
  }

  // NCR, CAPA, bước CAPA quá hạn (R-CL-15, R-CL-18)
  const [ncrOver] = await db.select({ n: count() }).from(ncrs).where(and(notInArray(ncrs.status, ["closed", "cancelled"]), isNotNull(ncrs.dueOn), lt(ncrs.dueOn, today)));
  if (ncrOver && ncrOver.n > 0) out.push({ module: "chat-luong", level: "warn", text: `${ncrOver.n} NCR quá hạn`, href: "/admin/chat-luong/ncr?han=qua-han", count: ncrOver.n });
  const [capaOver] = await db.select({ n: count() }).from(capas).where(and(notInArray(capas.status, ["closed", "cancelled"]), isNotNull(capas.dueOn), lt(capas.dueOn, today)));
  if (capaOver && capaOver.n > 0) out.push({ module: "chat-luong", level: "warn", text: `${capaOver.n} CAPA quá hạn`, href: "/admin/chat-luong/capa", count: capaOver.n });
  const [stepOver] = await db
    .select({ n: count() })
    .from(capaActions)
    .innerJoin(capas, eq(capas.id, capaActions.capaId))
    .where(and(isNull(capaActions.doneAt), isNotNull(capaActions.dueOn), lt(capaActions.dueOn, today), notInArray(capas.status, ["closed", "cancelled"])));
  if (stepOver && stepOver.n > 0) out.push({ module: "chat-luong", level: "warn", text: `${stepOver.n} bước CAPA quá hạn chưa xong`, href: "/admin/chat-luong/capa", count: stepOver.n });

  // Thu hồi đang mở; đơn chưa xuất kho có lô bị thu hồi (R-CL-23)
  const openRecalls = await db.select({ id: recalls.id, code: recalls.code }).from(recalls).where(inArray(recalls.status, ["open", "in_progress"]));
  for (const r of openRecalls) out.push({ module: "chat-luong", level: "warn", text: `Thu hồi ${r.code} đang mở`, href: `/admin/chat-luong/thu-hoi/${r.id}` });
  const stuck = await db
    .selectDistinct({ id: orders.id })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(lots, eq(lots.id, orderItems.lotId))
    .where(and(eq(lots.releaseStatus, "recalled"), isNull(orders.stockIssuedAt), inArray(orders.status, ["pending", "confirmed", "packing"])));
  if (stuck.length > 0) out.push({ module: "chat-luong", level: "danger", text: `${stuck.length} đơn chưa xuất kho có lô đang thu hồi, không xuất được`, href: "/admin/don-hang", count: stuck.length });

  // Lô đang giữ
  const [held] = await db.select({ n: count() }).from(lots).where(eq(lots.releaseStatus, "on_hold"));
  if (held && held.n > 0) out.push({ module: "chat-luong", level: "warn", text: `${held.n} lô thành phẩm đang giữ lại`, href: "/admin/lo", count: held.n });

  // Mẫu lưu hết hạn giữ (R-CL-25)
  const [expiredSamples] = await db.select({ n: count() }).from(retainedSamples).where(lt(retainedSamples.keepUntil, today));
  if (expiredSamples && expiredSamples.n > 0) out.push({ module: "chat-luong", level: "info", text: `${expiredSamples.n} mẫu lưu đã hết hạn giữ, cần hủy mẫu`, href: "/admin/chat-luong", count: expiredSamples.n });

  return out;
}
