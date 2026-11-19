import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { customerPasswordProblem, safeNextPath } from "@/modules/accounts/rules";
import { composeMessage, recipientsFor } from "@/modules/notify/rules";
import {
  cleanAspectRatings,
  feedbackStats,
  guestFeedbackProblem,
  isVerifiedPurchase,
  lotMatchesProduct,
  npsScore,
  pickKeys,
  publicReviewerName,
  reviewPublishProblem,
  summarizeReviews,
  ISSUE_TAGS,
} from "@/modules/reviews/rules";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

describe("account rules", () => {
  it("only redirects inside the site", () => {
    expect(safeNextPath("/san-pham/a#danh-gia")).toBe("/san-pham/a#danh-gia");
    expect(safeNextPath("//evil.com")).toBe("/tai-khoan");
    expect(safeNextPath("https://evil.com")).toBe("/tai-khoan");
    expect(safeNextPath("/\\evil.com")).toBe("/tai-khoan");
    expect(safeNextPath("/admin")).toBe("/tai-khoan");
    expect(safeNextPath(undefined, "/x")).toBe("/x");
  });

  it("rejects short, trivial and phone-number passwords", () => {
    expect(customerPasswordProblem("abc")).toMatch(/ít nhất/);
    expect(customerPasswordProblem("11111111")).toMatch(/dễ đoán/);
    expect(customerPasswordProblem("12345678")).toMatch(/dễ đoán/);
    expect(customerPasswordProblem("0901234567", "84901234567")).toMatch(/số điện thoại/);
    expect(customerPasswordProblem("vo-buoi-2027")).toBeNull();
  });
});

describe("review rules", () => {
  it("summarizes ratings, rebuy and irritation", () => {
    const s = summarizeReviews([
      { rating: 5, scentRating: 5, scalpFeel: "diu", wouldRebuy: "co" },
      { rating: 4, scentRating: 3, scalpFeel: "bet", wouldRebuy: "chua_chac" },
      { rating: 1, scentRating: null, scalpFeel: "ngua", wouldRebuy: "khong" },
      { rating: 9, scentRating: null, scalpFeel: null, wouldRebuy: null },
    ]);
    expect(s.count).toBe(3);
    expect(s.average).toBe(3.3);
    expect(s.distribution).toEqual([1, 0, 0, 1, 1]);
    expect(s.scentAverage).toBe(4);
    expect(s.rebuyRate).toBeCloseTo(1 / 3);
    expect(s.irritationRate).toBeCloseTo(1 / 3);
    expect(summarizeReviews([]).average).toBeNull();
  });

  it("blocks publishing without consent or with drug-like claims", () => {
    expect(reviewPublishProblem({ publishConsent: false, comment: "Thơm" })?.kind).toBe("no_consent");
    expect(reviewPublishProblem({ publishConsent: true, comment: "  " })?.kind).toBe("empty");
    expect(reviewPublishProblem({ publishConsent: true, comment: "Dùng 2 tuần thấy mọc tóc." })?.kind).toBe("claims");
    expect(reviewPublishProblem({ publishConsent: true, comment: "Không làm mọc tóc nhưng da đầu thoáng." })).toBeNull();
  });

  it("shortens reviewer names", () => {
    expect(publicReviewerName("Nguyễn Thị Lan")).toBe("Lan N.");
    expect(publicReviewerName("Lan")).toBe("Lan");
    expect(publicReviewerName("")).toBe("Khách Pomil");
  });

  it("counts a purchase only once delivered", () => {
    expect(isVerifiedPurchase([{ status: "shipping", productIds: ["p"] }], "p")).toBe(false);
    expect(isVerifiedPurchase([{ status: "delivered", productIds: ["p"] }], "p")).toBe(true);
  });

  it("notifies the owner only for low or irritated reviews", () => {
    const prefs = { notifyEmails: "a@pomil.vn", notifyZaloUserIds: "", notifyOnOrder: true, notifyOnComplaint: true };
    const base = { kind: "review_created" as const, reviewId: "r", productName: "Tonic", comment: "" };
    expect(recipientsFor({ ...base, rating: 5, irritation: false }, prefs).emails).toEqual([]);
    expect(recipientsFor({ ...base, rating: 2, irritation: false }, prefs).emails).toEqual(["a@pomil.vn"]);
    expect(recipientsFor({ ...base, rating: 5, irritation: true }, { ...prefs, notifyOnComplaint: false }).emails).toEqual(["a@pomil.vn"]);
    expect(composeMessage({ ...base, rating: 1, irritation: true }, "https://x").text).toContain("/admin/danh-gia");
  });
});

// ---------- Trên cơ sở dữ liệu thật ----------

const dir = mkdtempSync(path.join(tmpdir(), "pomil-acc-"));
process.env.PGLITE_DIR = dir;

describe("detailed feedback rules", () => {
  it("keeps only known keys, once each", () => {
    expect(pickKeys(ISSUE_TAGS, ["mui", "xxx", "mui", 3, "gia"])).toEqual(["mui", "gia"]);
  });

  it("keeps aspect scores 1-5 only", () => {
    expect(cleanAspectRatings({ texture: "4", dryness: 6, ease: 0, packaging: 2.5, value: 5, other: 3 })).toEqual({ texture: 4, value: 5 });
  });

  it("computes NPS from 0-10 answers", () => {
    expect(npsScore([10, 9, 8, 6, 0])).toBe(0);
    expect(npsScore([10, 10, 7])).toBe(67);
    expect(npsScore([null, 11])).toBeNull();
  });

  it("asks guests for a name and a phone when they accept follow-up", () => {
    expect(guestFeedbackProblem({ loggedIn: false, guestName: "A", contactPhone: null, followUpConsent: false })).toMatch(/tên/);
    expect(guestFeedbackProblem({ loggedIn: false, guestName: "Lan", contactPhone: null, followUpConsent: true })).toMatch(/điện thoại/);
    expect(guestFeedbackProblem({ loggedIn: false, guestName: "Lan", contactPhone: null, followUpConsent: false })).toBeNull();
    expect(guestFeedbackProblem({ loggedIn: true, guestName: "", contactPhone: null, followUpConsent: false })).toBeNull();
  });

  it("matches a lot only to its own product", () => {
    expect(lotMatchesProduct({ productId: "p1" }, "p1")).toBe(true);
    expect(lotMatchesProduct({ productId: "p2" }, "p1")).toBe(false);
    expect(lotMatchesProduct(undefined, "p1")).toBe(false);
  });

  it("summarizes aspects, NPS, comparison, scent strength and issues", () => {
    const base = { scentRating: null, scalpFeel: null, wouldRebuy: null };
    const s = feedbackStats([
      { ...base, rating: 5, aspectRatings: { texture: 5, dryness: 4 }, nps: 10, comparedBefore: "de_chiu_hon", scentIntensity: "dam_qua", issueTags: ["mui"] },
      { ...base, rating: 3, aspectRatings: { texture: 4 }, nps: 5, comparedBefore: "nhu_cu", scentIntensity: "vua", issueTags: ["mui", "dau_xit"] },
      { ...base, rating: 4, aspectRatings: null, nps: null, comparedBefore: "chua_ro", scentIntensity: "nhe_qua", issueTags: null },
    ]);
    expect(s.count).toBe(3);
    expect(s.aspects.texture).toBe(4.5);
    expect(s.aspects.dryness).toBe(4);
    expect(s.aspects.value).toBeNull();
    expect(s.nps).toBe(0);
    expect(s.better).toBe(0.5);
    expect(s.scentTooStrong).toBe(1);
    expect(s.scentTooLight).toBe(1);
    expect(s.issues[0]).toMatchObject({ tag: "mui", count: 2 });
  });
});

describe("accounts and reviews on a real database", () => {
  let tonicId = "";
  beforeAll(async () => {
    const { getDb } = await import("@/db/client");
    const { products } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    tonicId = (await db.select().from(products).where(eq(products.code, "PST")))[0]!.id;
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("registers once per phone, logs in, links orders and moderates reviews", async () => {
    const { registerAccount, verifyAccountLogin, listAccountOrders, lastShippingAddress } = await import("@/modules/accounts/service");
    const { placeOrder, changeOrderStatus } = await import("@/modules/orders/service");
    const { submitReview, publicReviews, setReviewStatus } = await import("@/modules/reviews/service");
    const { parseSettings } = await import("@/modules/settings/schema");

    const reg = await registerAccount({ name: "Trần Minh Anh", phoneE164: "84912345678", password: "vo-buoi-2027", consentText: "c" });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    expect((await registerAccount({ name: "X", phoneE164: "84912345678", password: "khac-nua-2027", consentText: "c" })).ok).toBe(false);

    expect(await verifyAccountLogin("84912345678", "sai-mat-khau")).toBeNull();
    expect(await verifyAccountLogin("84999999999", "vo-buoi-2027")).toBeNull();
    expect(await verifyAccountLogin("84912345678", "vo-buoi-2027")).toBe(reg.accountId);

    // Đơn khách vãng lai cùng số: không hiện trong tài khoản
    const settings = parseSettings({ salesOpen: true });
    const order = (extra: object) => ({
      lines: [{ productId: tonicId, quantity: 1 }],
      recipientName: "Minh Anh",
      phoneE164: "84912345678",
      email: null,
      province: "Hà Nội",
      ward: "Phường A",
      addressLine: "12 Phố B",
      customerNote: null,
      paymentMethod: "cod" as const,
      marketingConsent: false,
      consentTexts: { dataProcessing: "d", marketing: "m" },
      utm: null,
      landingVariant: null,
      ...extra,
    });
    const guest = await placeOrder(order({}), settings);
    expect(guest.ok).toBe(true);
    expect(await listAccountOrders(reg.accountId)).toHaveLength(0);

    const mine = await placeOrder(order({ accountId: reg.accountId }), settings);
    expect(mine.ok).toBe(true);
    const list = await listAccountOrders(reg.accountId);
    expect(list).toHaveLength(1);
    expect(list[0]!.items[0]!.productId).toBe(tonicId);
    expect((await lastShippingAddress(reg.accountId))?.addressLine).toBe("12 Phố B");

    const review = { accountId: reg.accountId, productId: tonicId, rating: 4, scentRating: 5, scalpFeel: "diu" as const, wouldRebuy: "co" as const, usedFor: "1_4_tuan" as const, suggestion: "Chai to hơn" };
    const first = await submitReview({ ...review, comment: "Dùng thấy mọc tóc", publishConsent: true });
    expect(first.updated).toBe(false);
    await expect(setReviewStatus({ id: first.reviewId, status: "published", staffNote: null, staffId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/không được dùng/);

    // Gửi lại: cập nhật cùng dòng, đã giao thì thành "đã mua"
    if (!mine.ok) return;
    for (const s of ["confirmed", "packing", "shipping", "delivered"] as const) await changeOrderStatus(mine.orderId, s, "00000000-0000-0000-0000-000000000000", null);
    const second = await submitReview({ ...review, comment: "Xịt xong da đầu mát, khô nhanh.", publishConsent: true });
    expect(second).toMatchObject({ reviewId: first.reviewId, updated: true });
    expect((await publicReviews(tonicId)).reviews).toHaveLength(0);

    await setReviewStatus({ id: first.reviewId, status: "published", staffNote: null, staffId: "00000000-0000-0000-0000-000000000000" });
    const pub = await publicReviews(tonicId);
    expect(pub.summary.count).toBe(1);
    expect(pub.reviews[0]).toMatchObject({ reviewer: "Anh T.", verifiedPurchase: true });
    expect(pub.reviews[0]).not.toHaveProperty("suggestion");
  }, 120_000);

  it("takes detailed guest feedback, checks the lot and tracks the fix", async () => {
    const { submitReview, listReviewsForAdmin, reviewStatsByProduct, setReviewStatus, publicReviews } = await import("@/modules/reviews/service");
    const guest = {
      accountId: null,
      productId: tonicId,
      rating: 3,
      scentRating: 2,
      scalpFeel: "diu" as const,
      wouldRebuy: "chua_chac" as const,
      usedFor: "1_4_tuan" as const,
      comment: "Khô nhanh, mùi hơi gắt.",
      suggestion: "Mùi nhẹ hơn",
      publishConsent: true,
    };
    const a = await submitReview({
      ...guest,
      details: {
        guestName: "Nguyễn Lan",
        contactPhone: "84987654321",
        lotNo: "pst-271101-01",
        channel: "shopee",
        scalpType: "dau",
        concerns: ["ngua", "bet"],
        habits: ["mu_bao_hiem"],
        scentIntensity: "dam_qua",
        comparedBefore: "de_chiu_hon",
        aspectRatings: { texture: 4, dryness: 5 },
        nps: 7,
        followUpConsent: true,
      },
    });
    expect(a).toMatchObject({ updated: false, lotMatched: true });
    // Khách không tài khoản gửi lần nữa: dòng mới, lô sai thì giữ chữ khách ghi nhưng không gắn lô
    const b = await submitReview({ ...guest, details: { guestName: "Nguyễn Lan", lotNo: "PST-991231-09" } });
    expect(b.reviewId).not.toBe(a.reviewId);
    expect(b.lotMatched).toBe(false);

    const rows = await listReviewsForAdmin({ productId: tonicId });
    const rowA = rows.find((r) => r.review.id === a.reviewId)!;
    expect(rowA.customerId).toBeNull();
    expect(rowA.lotNo).toBe("PST-271101-01");
    expect(rowA.review).toMatchObject({ guestName: "Nguyễn Lan", channel: "shopee", concerns: ["ngua", "bet"], nps: 7, followUpConsent: true, actionStatus: "chua_xu_ly" });
    const rowB = rows.find((r) => r.review.id === b.reviewId)!;
    expect(rowB.lotNo).toBeNull();
    expect(rowB.review.reportedLotNo).toBe("PST-991231-09");

    await setReviewStatus({
      id: a.reviewId,
      status: "published",
      staffNote: "Mùi đậm",
      staffId: "00000000-0000-0000-0000-000000000000",
      issueTags: ["mui"],
      actionStatus: "lo_sau",
      actionTaken: "Giảm tinh dầu từ lô sau",
    });
    expect((await listReviewsForAdmin({ actionStatus: "lo_sau" })).map((r) => r.review.id)).toEqual([a.reviewId]);

    const stats = (await reviewStatsByProduct()).find((s) => s.productId === tonicId)!;
    expect(stats.summary.scentTooStrong).toBe(1);
    expect(stats.summary.issues[0]).toMatchObject({ tag: "mui", count: 1 });

    const pub = await publicReviews(tonicId);
    expect(pub.reviews.find((r) => r.id === a.reviewId)).toMatchObject({ reviewer: "Lan N.", hasLot: true, verifiedPurchase: false });
  }, 120_000);
});
