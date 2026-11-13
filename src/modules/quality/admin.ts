import "server-only";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { complaints, lots, lotTests, notifications, orderItems, products } from "@/db/schema";
import type { LotPublicInfo } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { syncSellableStock } from "@/modules/inventory/ledger";

export type LotTestType = (typeof lotTests.$inferSelect)["type"];

export const TEST_LABEL: Record<LotTestType, string> = {
  microbial: "Vi sinh",
  heavy_metals: "Kim loại nặng",
  stability: "Độ ổn định",
  gc_ms: "Phân tích GC-MS",
  irritation: "Kích ứng da",
  sensory: "Cảm quan",
};

export const LOT_STATUS_LABEL = {
  quarantine: "Cách ly",
  released: "Đã duyệt xuất",
  on_hold: "Đang giữ lại",
  recalled: "Thu hồi",
  rejected: "Không đạt",
} as const;

export const COMPLAINT_STATUS_LABEL = {
  open: "Mới",
  responded: "Đã phản hồi",
  investigating: "Đang điều tra",
  closed: "Đã đóng",
} as const;

export const SEVERITY_LABEL = { mild: "Nhẹ", moderate: "Vừa", severe: "Nặng" } as const;

export async function listLots() {
  const db = await getDb();
  const sold = db
    .select({ lotId: orderItems.lotId, units: sql<number>`sum(${orderItems.quantity})`.as("units") })
    .from(orderItems)
    .groupBy(orderItems.lotId)
    .as("sold");
  const rows = await db
    .select({
      id: lots.id,
      lotNo: lots.lotNo,
      productName: products.name,
      manufacturedOn: lots.manufacturedOn,
      expiresOn: lots.expiresOn,
      unitsProduced: lots.unitsProduced,
      releaseStatus: lots.releaseStatus,
      isPublic: lots.isPublic,
      sold: sql<number>`coalesce(${sold.units}, 0)`,
    })
    .from(lots)
    .innerJoin(products, eq(lots.productId, products.id))
    .leftJoin(sold, eq(sold.lotId, lots.id))
    .orderBy(desc(lots.manufacturedOn));
  return rows.map((r) => ({ ...r, sold: Number(r.sold) }));
}

export async function getLotDetail(id: string) {
  const db = await getDb();
  const lot = await db.query.lots.findFirst({ where: eq(lots.id, id) });
  if (!lot) return null;
  const [product, tests, notification, lotComplaints] = await Promise.all([
    db.query.products.findFirst({ where: eq(products.id, lot.productId) }),
    db.select().from(lotTests).where(eq(lotTests.lotId, id)),
    db.query.notifications.findFirst({ where: eq(notifications.productId, lot.productId), orderBy: desc(notifications.expiresAt) }),
    db.select().from(complaints).where(eq(complaints.lotId, id)).orderBy(desc(complaints.openedAt)),
  ]);
  return { lot, product, tests, notification, complaints: lotComplaints };
}

export async function createLot(
  input: { lotNo: string; productId: string; formulaVersion: string; factory: string | null; manufacturedOn: string; expiresOn: string; unitsProduced: number },
  actorId: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const db = await getDb();
  const dup = await db.query.lots.findFirst({ where: eq(lots.lotNo, input.lotNo) });
  if (dup) return { ok: false, message: "Số lô đã tồn tại" };
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(lots).values(input).returning({ id: lots.id });
    await writeAudit(tx, { actorId, action: "lot.created", entity: "lots", entityId: row!.id, after: { lotNo: input.lotNo } });
    return { ok: true as const, id: row!.id };
  });
}

export async function updateLotPublic(id: string, data: { isPublic: boolean; publicInfo: LotPublicInfo }, actorId: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const before = await tx.query.lots.findFirst({ where: eq(lots.id, id) });
    await tx.update(lots).set(data).where(eq(lots.id, id));
    await writeAudit(tx, { actorId, action: "lot.public_info", entity: "lots", entityId: id, before: { isPublic: before?.isPublic }, after: { isPublic: data.isPublic } });
  });
}

export async function setLotHold(id: string, hold: boolean, reason: string | null, actorId: string): Promise<{ ok: boolean; message?: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const lot = await tx.query.lots.findFirst({ where: eq(lots.id, id) });
    if (!lot) return { ok: false, message: "Không tìm thấy lô" };
    if (hold && lot.releaseStatus !== "released") return { ok: false, message: "Chỉ giữ được lô đang bán" };
    if (!hold && lot.releaseStatus !== "on_hold") return { ok: false, message: "Lô không ở trạng thái giữ" };
    const next = hold ? "on_hold" : "released";
    await tx.update(lots).set({ releaseStatus: next, holdReason: hold ? reason : null }).where(eq(lots.id, id));
    await writeAudit(tx, { actorId, action: hold ? "lot.hold" : "lot.unhold", entity: "lots", entityId: id, before: { releaseStatus: lot.releaseStatus }, after: { releaseStatus: next, reason } });
    // Sản phẩm bật quản lý kho: số bán được đổi theo lô giữ/bỏ giữ (R-KHO-23)
    await syncSellableStock(tx, lot.productId);
    return { ok: true };
  });
}

export async function addLotTest(
  input: { lotId: string; type: LotTestType; result: "pass" | "fail" | "pending"; lab: string | null; reportNo: string | null; testedOn: string | null; isPublic: boolean },
  actorId: string,
) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(lotTests).values(input).returning({ id: lotTests.id });
    await writeAudit(tx, { actorId, action: "lot.test_added", entity: "lot_tests", entityId: row!.id, after: { lotId: input.lotId, type: input.type, result: input.result } });
  });
}

export async function setLotTestResult(testId: string, result: "pass" | "fail" | "pending", actorId: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(lotTests).where(eq(lotTests.id, testId));
    await tx.update(lotTests).set({ result }).where(eq(lotTests.id, testId));
    await writeAudit(tx, { actorId, action: "lot.test_result", entity: "lot_tests", entityId: testId, before: { result: before?.result }, after: { result } });
  });
}

export async function addNotification(input: { productId: string; number: string; issuedAt: string; expiresAt: string }, actorId: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(notifications).values(input).returning({ id: notifications.id });
    await writeAudit(tx, { actorId, action: "notification.added", entity: "cosmetic_notifications", entityId: row!.id, after: input });
  });
}

export async function listComplaints(status?: keyof typeof COMPLAINT_STATUS_LABEL) {
  const db = await getDb();
  return db
    .select({
      id: complaints.id,
      lotNo: lots.lotNo,
      reportedLotNo: complaints.reportedLotNo,
      sampleCode: complaints.sampleCode,
      contactPhone: complaints.contactPhone,
      symptoms: complaints.symptoms,
      severity: complaints.severity,
      status: complaints.status,
      openedAt: complaints.openedAt,
      firstResponseAt: complaints.firstResponseAt,
      rootCause: complaints.rootCause,
      correctiveAction: complaints.correctiveAction,
    })
    .from(complaints)
    .leftJoin(lots, eq(complaints.lotId, lots.id))
    .where(status ? eq(complaints.status, status) : undefined)
    .orderBy(desc(complaints.openedAt));
}

export async function countOpenComplaints(): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(complaints).where(inArray(complaints.status, ["open", "investigating", "responded"]));
  return row?.n ?? 0;
}

export async function updateComplaint(
  id: string,
  data: { status: keyof typeof COMPLAINT_STATUS_LABEL; rootCause: string | null; correctiveAction: string | null },
  actorId: string,
) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const before = await tx.query.complaints.findFirst({ where: eq(complaints.id, id) });
    if (!before) return;
    const now = new Date();
    await tx
      .update(complaints)
      .set({
        ...data,
        firstResponseAt: before.firstResponseAt ?? (data.status !== "open" ? now : null),
        closedAt: data.status === "closed" ? (before.closedAt ?? now) : null,
      })
      .where(and(eq(complaints.id, id)));
    await writeAudit(tx, { actorId, action: "complaint.updated", entity: "complaints", entityId: id, before: { status: before.status }, after: { status: data.status } });
  });
}
