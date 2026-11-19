import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { customerAccounts, customers, lots, orderItems, orders, productReviews, products } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import {
  describePublishProblem,
  feedbackStats,
  isVerifiedPurchase,
  lotMatchesProduct,
  publicReviewerName,
  reviewPublishProblem,
  summarizeReviews,
  type ActionStatus,
  type AgeRange,
  type AspectRatings,
  type Channel,
  type ComparedBefore,
  type Concern,
  type Habit,
  type IssueTag,
  type ScalpFeel,
  type ScalpType,
  type ScentIntensity,
  type UsageFrequency,
  type UsedFor,
  type WouldRebuy,
} from "./rules";

export type FeedbackDetails = {
  guestName?: string | null;
  contactPhone?: string | null;
  lotNo?: string | null;
  channel?: Channel | null;
  ageRange?: AgeRange | null;
  scalpType?: ScalpType | null;
  concerns?: Concern[];
  habits?: Habit[];
  usageFrequency?: UsageFrequency | null;
  comparedBefore?: ComparedBefore | null;
  scentIntensity?: ScentIntensity | null;
  aspectRatings?: AspectRatings;
  nps?: number | null;
  followUpConsent?: boolean;
};

export type ReviewInput = {
  // null: khách góp ý không đăng nhập (trang /gop-y, ví dụ khách mua trên sàn quét QR)
  accountId: string | null;
  productId: string;
  rating: number;
  scentRating: number | null;
  scalpFeel: ScalpFeel | null;
  wouldRebuy: WouldRebuy | null;
  usedFor: UsedFor | null;
  comment: string;
  suggestion: string;
  publishConsent: boolean;
  // Trường chi tiết từ trang /gop-y; không truyền thì giữ nguyên dữ liệu đã có
  details?: FeedbackDetails;
};

// Mỗi tài khoản một đánh giá cho mỗi sản phẩm; gửi lại thì cập nhật và chờ duyệt lại.
// Khách không đăng nhập: mỗi lần gửi là một dòng mới, không bao giờ là "đã mua".
export async function submitReview(input: ReviewInput): Promise<{ reviewId: string; updated: boolean; productName: string; lotMatched: boolean }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const product = await tx.query.products.findFirst({ where: eq(products.id, input.productId) });
    if (!product || product.status === "draft" || product.status === "archived") throw new UserError("Không tìm thấy sản phẩm.");

    const accountId = input.accountId;
    const bought = accountId
      ? await tx
          .select({ status: orders.status, productId: orderItems.productId })
          .from(orders)
          .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
          .where(eq(orders.accountId, accountId))
      : [];
    const verified = isVerifiedPurchase(
      bought.map((b) => ({ status: b.status, productIds: [b.productId] })),
      input.productId,
    );

    const d = input.details ?? {};
    const lotNo = d.lotNo?.trim().toUpperCase() || null;
    const lot = lotNo ? await tx.query.lots.findFirst({ where: eq(lots.lotNo, lotNo) }) : undefined;
    const lotMatched = lotMatchesProduct(lot, input.productId);
    const detailValues = {
      guestName: accountId ? null : d.guestName?.trim() || null,
      contactPhone: d.contactPhone ?? null,
      lotId: lotMatched ? lot!.id : null,
      reportedLotNo: lotNo,
      channel: d.channel ?? null,
      ageRange: d.ageRange ?? null,
      scalpType: d.scalpType ?? null,
      concerns: d.concerns ?? [],
      habits: d.habits ?? [],
      usageFrequency: d.usageFrequency ?? null,
      comparedBefore: d.comparedBefore ?? null,
      scentIntensity: d.scentIntensity ?? null,
      aspectRatings: d.aspectRatings ?? {},
      nps: d.nps ?? null,
      followUpConsent: d.followUpConsent ?? false,
    };

    const values = {
      rating: input.rating,
      scentRating: input.scentRating,
      scalpFeel: input.scalpFeel,
      wouldRebuy: input.wouldRebuy,
      usedFor: input.usedFor,
      comment: input.comment,
      suggestion: input.suggestion,
      publishConsent: input.publishConsent,
      verifiedPurchase: verified,
      status: "new" as const,
      updatedAt: new Date(),
      ...(input.details ? detailValues : {}),
    };
    const existing = accountId
      ? await tx.query.productReviews.findFirst({
          where: and(eq(productReviews.accountId, accountId), eq(productReviews.productId, input.productId)),
        })
      : undefined;
    if (existing) {
      await tx.update(productReviews).set(values).where(eq(productReviews.id, existing.id));
      return { reviewId: existing.id, updated: true, productName: product.name, lotMatched };
    }
    const [row] = await tx
      .insert(productReviews)
      .values({ accountId, productId: input.productId, ...detailValues, ...values })
      .returning({ id: productReviews.id });
    return { reviewId: row!.id, updated: false, productName: product.name, lotMatched };
  });
}

export async function getMyReview(accountId: string, productId: string) {
  const db = await getDb();
  return (
    (await db.query.productReviews.findFirst({ where: and(eq(productReviews.accountId, accountId), eq(productReviews.productId, productId)) })) ?? null
  );
}

export async function listMyReviews(accountId: string) {
  const db = await getDb();
  return db
    .select({ id: productReviews.id, rating: productReviews.rating, status: productReviews.status, updatedAt: productReviews.updatedAt, productName: products.name, productSlug: products.slug })
    .from(productReviews)
    .innerJoin(products, eq(productReviews.productId, products.id))
    .where(eq(productReviews.accountId, accountId))
    .orderBy(desc(productReviews.updatedAt));
}

// Sản phẩm cho trang góp ý: chỉ sản phẩm đang hiện trên web
export async function getFeedbackProduct(slug: string) {
  const db = await getDb();
  const product = await db.query.products.findFirst({ where: eq(products.slug, slug) });
  if (!product || product.status === "draft" || product.status === "archived") return null;
  return { id: product.id, slug: product.slug, name: product.name, subtitle: product.subtitle, size: product.size };
}

// Đánh giá công khai trên trang sản phẩm: chỉ bản đã duyệt. Điểm trung bình cũng tính trên bản đã duyệt
// để con số khớp với những gì khách đọc được.
export async function publicReviews(productId: string) {
  const db = await getDb();
  const rows = await db
    .select({
      id: productReviews.id,
      rating: productReviews.rating,
      scentRating: productReviews.scentRating,
      scalpFeel: productReviews.scalpFeel,
      wouldRebuy: productReviews.wouldRebuy,
      usedFor: productReviews.usedFor,
      comment: productReviews.comment,
      verifiedPurchase: productReviews.verifiedPurchase,
      hasLot: sql<boolean>`${productReviews.lotId} is not null`,
      createdAt: productReviews.createdAt,
      name: sql<string | null>`coalesce(${customers.name}, ${productReviews.guestName})`,
    })
    .from(productReviews)
    .leftJoin(customerAccounts, eq(productReviews.accountId, customerAccounts.id))
    .leftJoin(customers, eq(customerAccounts.customerId, customers.id))
    .where(and(eq(productReviews.productId, productId), eq(productReviews.status, "published")))
    .orderBy(desc(productReviews.createdAt))
    .limit(30);
  return {
    summary: summarizeReviews(rows),
    reviews: rows.map(({ name, ...r }) => ({ ...r, reviewer: publicReviewerName(name) })),
  };
}

// ---------- Quản trị ----------

export type AdminReviewFilter = { status?: "new" | "published" | "hidden"; productId?: string; actionStatus?: ActionStatus };

export async function listReviewsForAdmin(filter: AdminReviewFilter, limit = 200) {
  const db = await getDb();
  const conds = [];
  if (filter.status) conds.push(eq(productReviews.status, filter.status));
  if (filter.productId) conds.push(eq(productReviews.productId, filter.productId));
  if (filter.actionStatus) conds.push(eq(productReviews.actionStatus, filter.actionStatus));
  return db
    .select({
      review: productReviews,
      productName: products.name,
      customerId: customers.id,
      customerName: customers.name,
      phoneE164: customers.phoneE164,
      lotNo: lots.lotNo,
    })
    .from(productReviews)
    .innerJoin(products, eq(productReviews.productId, products.id))
    .leftJoin(customerAccounts, eq(productReviews.accountId, customerAccounts.id))
    .leftJoin(customers, eq(customerAccounts.customerId, customers.id))
    .leftJoin(lots, eq(productReviews.lotId, lots.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(productReviews.createdAt))
    .limit(limit);
}

// Thống kê theo sản phẩm trên mọi đánh giá (kể cả nội bộ) để biết cần sửa gì
export async function reviewStatsByProduct() {
  const db = await getDb();
  const rows = await db
    .select({
      productId: productReviews.productId,
      productName: products.name,
      rating: productReviews.rating,
      scentRating: productReviews.scentRating,
      scalpFeel: productReviews.scalpFeel,
      wouldRebuy: productReviews.wouldRebuy,
      aspectRatings: productReviews.aspectRatings,
      nps: productReviews.nps,
      comparedBefore: productReviews.comparedBefore,
      scentIntensity: productReviews.scentIntensity,
      issueTags: productReviews.issueTags,
    })
    .from(productReviews)
    .innerJoin(products, eq(productReviews.productId, products.id));
  const byProduct = new Map<string, { productName: string; rows: typeof rows }>();
  for (const r of rows) {
    const entry = byProduct.get(r.productId) ?? { productName: r.productName, rows: [] };
    entry.rows.push(r);
    byProduct.set(r.productId, entry);
  }
  return [...byProduct.entries()].map(([productId, v]) => ({ productId, productName: v.productName, summary: feedbackStats(v.rows) }));
}

export async function setReviewStatus(input: {
  id: string;
  status: "new" | "published" | "hidden";
  staffNote: string | null;
  staffId: string;
  // Không truyền thì giữ nguyên
  issueTags?: IssueTag[];
  actionStatus?: ActionStatus;
  actionTaken?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const review = await tx.query.productReviews.findFirst({ where: eq(productReviews.id, input.id) });
    if (!review) throw new UserError("Không tìm thấy đánh giá.");
    if (input.status === "published") {
      const problem = reviewPublishProblem(review);
      if (problem) throw new UserError(describePublishProblem(problem));
    }
    const next = {
      status: input.status,
      staffNote: input.staffNote,
      issueTags: input.issueTags ?? review.issueTags,
      actionStatus: input.actionStatus ?? review.actionStatus,
      actionTaken: input.actionTaken === undefined ? review.actionTaken : input.actionTaken,
    };
    await tx
      .update(productReviews)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(productReviews.id, input.id));
    await writeAudit(tx, {
      actorId: input.staffId,
      action: "review.status_changed",
      entity: "product_reviews",
      entityId: input.id,
      before: { status: review.status, issueTags: review.issueTags, actionStatus: review.actionStatus },
      after: { status: next.status, issueTags: next.issueTags, actionStatus: next.actionStatus },
    });
  });
}
