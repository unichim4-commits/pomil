import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { customerAccounts, customers, orderItems, orders, productReviews, products } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import {
  describePublishProblem,
  isVerifiedPurchase,
  publicReviewerName,
  reviewPublishProblem,
  summarizeReviews,
  type ScalpFeel,
  type UsedFor,
  type WouldRebuy,
} from "./rules";

export type ReviewInput = {
  accountId: string;
  productId: string;
  rating: number;
  scentRating: number | null;
  scalpFeel: ScalpFeel | null;
  wouldRebuy: WouldRebuy | null;
  usedFor: UsedFor | null;
  comment: string;
  suggestion: string;
  publishConsent: boolean;
};

// Mỗi tài khoản một đánh giá cho mỗi sản phẩm; gửi lại thì cập nhật và chờ duyệt lại.
export async function submitReview(input: ReviewInput): Promise<{ reviewId: string; updated: boolean; productName: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const product = await tx.query.products.findFirst({ where: eq(products.id, input.productId) });
    if (!product || product.status === "draft" || product.status === "archived") throw new UserError("Không tìm thấy sản phẩm.");

    const bought = await tx
      .select({ status: orders.status, productId: orderItems.productId })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(eq(orders.accountId, input.accountId));
    const verified = isVerifiedPurchase(
      bought.map((b) => ({ status: b.status, productIds: [b.productId] })),
      input.productId,
    );

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
    };
    const existing = await tx.query.productReviews.findFirst({
      where: and(eq(productReviews.accountId, input.accountId), eq(productReviews.productId, input.productId)),
    });
    if (existing) {
      await tx.update(productReviews).set(values).where(eq(productReviews.id, existing.id));
      return { reviewId: existing.id, updated: true, productName: product.name };
    }
    const [row] = await tx
      .insert(productReviews)
      .values({ accountId: input.accountId, productId: input.productId, ...values })
      .returning({ id: productReviews.id });
    return { reviewId: row!.id, updated: false, productName: product.name };
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
      createdAt: productReviews.createdAt,
      name: customers.name,
    })
    .from(productReviews)
    .innerJoin(customerAccounts, eq(productReviews.accountId, customerAccounts.id))
    .innerJoin(customers, eq(customerAccounts.customerId, customers.id))
    .where(and(eq(productReviews.productId, productId), eq(productReviews.status, "published")))
    .orderBy(desc(productReviews.createdAt))
    .limit(30);
  return {
    summary: summarizeReviews(rows),
    reviews: rows.map(({ name, ...r }) => ({ ...r, reviewer: publicReviewerName(name) })),
  };
}

// ---------- Quản trị ----------

export async function listReviewsForAdmin(filter: { status?: "new" | "published" | "hidden"; productId?: string }) {
  const db = await getDb();
  const conds = [];
  if (filter.status) conds.push(eq(productReviews.status, filter.status));
  if (filter.productId) conds.push(eq(productReviews.productId, filter.productId));
  return db
    .select({
      review: productReviews,
      productName: products.name,
      customerId: customers.id,
      customerName: customers.name,
      phoneE164: customers.phoneE164,
    })
    .from(productReviews)
    .innerJoin(products, eq(productReviews.productId, products.id))
    .innerJoin(customerAccounts, eq(productReviews.accountId, customerAccounts.id))
    .innerJoin(customers, eq(customerAccounts.customerId, customers.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(productReviews.createdAt))
    .limit(200);
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
    })
    .from(productReviews)
    .innerJoin(products, eq(productReviews.productId, products.id));
  const byProduct = new Map<string, { productName: string; rows: typeof rows }>();
  for (const r of rows) {
    const entry = byProduct.get(r.productId) ?? { productName: r.productName, rows: [] };
    entry.rows.push(r);
    byProduct.set(r.productId, entry);
  }
  return [...byProduct.entries()].map(([productId, v]) => ({ productId, productName: v.productName, summary: summarizeReviews(v.rows) }));
}

export async function setReviewStatus(input: { id: string; status: "new" | "published" | "hidden"; staffNote: string | null; staffId: string }): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const review = await tx.query.productReviews.findFirst({ where: eq(productReviews.id, input.id) });
    if (!review) throw new UserError("Không tìm thấy đánh giá.");
    if (input.status === "published") {
      const problem = reviewPublishProblem(review);
      if (problem) throw new UserError(describePublishProblem(problem));
    }
    await tx.update(productReviews).set({ status: input.status, staffNote: input.staffNote, updatedAt: new Date() }).where(eq(productReviews.id, input.id));
    await writeAudit(tx, {
      actorId: input.staffId,
      action: "review.status_changed",
      entity: "product_reviews",
      entityId: input.id,
      before: { status: review.status },
      after: { status: input.status },
    });
  });
}
