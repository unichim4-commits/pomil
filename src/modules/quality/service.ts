import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { complaints, lots, lotTests, notifications } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { classifyLotLookup, evaluateLotRelease, HOLD_WINDOW_DAYS, shouldHoldLot } from "./rules";

export type ComplaintInput = {
  lotNo: string | null;
  sampleCode: string | null;
  contactPhone: string | null;
  startedUsingOn: string | null;
  symptoms: string;
  severity: "mild" | "moderate" | "severe";
};

// Ghi phản ánh (có thể không có lô, D-3); nếu chạm ngưỡng thì chuyển lô sang giữ lại.
// Ngưỡng giữ lô chỉ đếm phản ánh đã khớp một lô.
export async function submitComplaint(input: ComplaintInput): Promise<{ complaintId: string; lotHeld: boolean }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const lot = input.lotNo ? await tx.query.lots.findFirst({ where: eq(lots.lotNo, input.lotNo) }) : undefined;

    const [row] = await tx
      .insert(complaints)
      .values({
        lotId: lot?.id ?? null,
        reportedLotNo: input.lotNo,
        sampleCode: input.sampleCode,
        contactPhone: input.contactPhone,
        startedUsingOn: input.startedUsingOn,
        symptoms: input.symptoms,
        severity: input.severity,
      })
      .returning({ id: complaints.id, openedAt: complaints.openedAt });

    let lotHeld = false;
    if (lot && lot.releaseStatus === "released") {
      const since = new Date(Date.now() - HOLD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const recent = await tx
        .select({ openedAt: complaints.openedAt })
        .from(complaints)
        .where(and(eq(complaints.lotId, lot.id), gt(complaints.openedAt, since)));

      if (shouldHoldLot(recent.map((r) => r.openedAt))) {
        await tx
          .update(lots)
          .set({ releaseStatus: "on_hold", holdReason: `Tự động: ${recent.length} phản ánh trong ${HOLD_WINDOW_DAYS} ngày` })
          .where(eq(lots.id, lot.id));
        await writeAudit(tx, {
          actorId: null,
          action: "lot.auto_hold",
          entity: "lots",
          entityId: lot.id,
          before: { releaseStatus: lot.releaseStatus },
          after: { releaseStatus: "on_hold", complaints: recent.length },
        });
        lotHeld = true;
      }
    }

    // Thông báo cho chủ cửa hàng gửi ở tầng action (notifyInBackground), sau khi giao dịch đã ghi xong
    return { complaintId: row!.id, lotHeld };
  });
}

// Duyệt xuất kho: chỉ khi qua hết điều kiện ở evaluateLotRelease.
export async function releaseLot(lotId: string, actorId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const lot = await tx.query.lots.findFirst({ where: eq(lots.id, lotId) });
    if (!lot) throw new UserError("Không tìm thấy lô");

    const tests = await tx.select({ type: lotTests.type, result: lotTests.result }).from(lotTests).where(eq(lotTests.lotId, lotId));
    const notification = await tx.query.notifications.findFirst({ where: eq(notifications.productId, lot.productId) });

    const verdict = evaluateLotRelease({
      status: lot.releaseStatus,
      expiresOn: new Date(lot.expiresOn),
      tests,
      notificationExpiresAt: notification ? new Date(notification.expiresAt) : null,
    });
    if (!verdict.ok) return verdict;

    await tx.update(lots).set({ releaseStatus: "released", releasedBy: actorId, releasedAt: new Date() }).where(eq(lots.id, lotId));
    await writeAudit(tx, {
      actorId,
      action: "lot.released",
      entity: "lots",
      entityId: lotId,
      before: { releaseStatus: lot.releaseStatus },
      after: { releaseStatus: "released" },
    });
    return verdict;
  });
}

// Dữ liệu cho trang lô công khai. Phân biệt: không có lô, lô chưa mở (chưa công khai hoặc đang
// cách ly, không lộ thông tin gì) và lô xem được.
export type PublicLotView = {
  lotNo: string;
  manufacturedOn: string;
  expiresOn: string;
  status: (typeof lots.$inferSelect)["releaseStatus"];
  info: (typeof lots.$inferSelect)["publicInfo"];
  tests: { type: string; result: string; lab: string | null; reportNo: string | null; testedOn: string | null }[];
};

export async function getPublicLot(lotNo: string): Promise<{ kind: "missing" } | { kind: "pending" } | { kind: "public"; lot: PublicLotView }> {
  const db = await getDb();
  const lot = await db.query.lots.findFirst({ where: eq(lots.lotNo, lotNo) });
  const kind = classifyLotLookup(true, lot ?? null);
  if (!lot || kind === "missing") return { kind: "missing" };
  if (kind === "pending") return { kind: "pending" };
  const tests = await db
    .select({ type: lotTests.type, result: lotTests.result, lab: lotTests.lab, reportNo: lotTests.reportNo, testedOn: lotTests.testedOn })
    .from(lotTests)
    .where(and(eq(lotTests.lotId, lot.id), eq(lotTests.isPublic, true)));
  return {
    kind: "public" as const,
    lot: {
      lotNo: lot.lotNo,
      manufacturedOn: lot.manufacturedOn,
      expiresOn: lot.expiresOn,
      status: lot.releaseStatus,
      info: lot.publicInfo,
      tests,
    },
  };
}
