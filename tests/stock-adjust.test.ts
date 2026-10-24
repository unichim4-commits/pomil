import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Lỗi #3 (T-2): lưu form sản phẩm hoặc sửa nhanh tồn kho ghi đè số tồn bằng số trên form.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

const ACTOR = { id: "", email: "chu@pomil.test", name: "Chủ", role: "owner" as const, totpEnabled: false };
vi.mock("@/modules/auth/service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/auth/service")>();
  return { ...original, requirePermission: async () => ACTOR };
});

const dir = mkdtempSync(path.join(tmpdir(), "pomil-stock-"));
process.env.PGLITE_DIR = dir;

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { auditLog, products, staffUsers } from "@/db/schema";
import * as productActions from "@/app/admin/san-pham/actions";
import { applyStockDelta, initialStockProblem, parseStockAdjustment, parseStockDelta, stockReasonProblem } from "@/modules/catalog/rules";
import { placeOrder } from "@/modules/orders/service";
import { parseSettings } from "@/modules/settings/schema";

let tonic: typeof products.$inferSelect;

beforeAll(async () => {
  const db = await getDb();
  const [staff] = await db.insert(staffUsers).values({ email: "chu@pomil.test", name: "Chủ", role: "owner", passwordHash: "x" }).returning();
  ACTOR.id = staff!.id;
  tonic = (await db.select().from(products).where(eq(products.code, "PST")))[0]!;
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function stockNow() {
  const db = await getDb();
  return (await db.select().from(products).where(eq(products.id, tonic.id)))[0]!.stock;
}

// Form sửa sản phẩm như trình duyệt gửi lên, kèm số tồn đang hiện lúc mở form
function productForm(p: typeof products.$inferSelect, shownStock: number) {
  const fd = new FormData();
  const fields: Record<string, string> = {
    id: p.id,
    name: p.name,
    code: p.code,
    slug: p.slug,
    subtitle: p.subtitle,
    size: p.size,
    price: String(p.price),
    stock: String(shownStock),
    status: p.status,
    sortOrder: String(p.sortOrder),
    tone: p.tone,
    description: p.description + "\n\nSửa một dòng mô tả.",
    highlights: p.highlights.join("\n"),
    ingredients: p.ingredients.map((i) => `${i.name} | ${i.purpose}`).join("\n"),
    howToUse: p.howToUse,
    notDo: p.notDo.join("\n"),
    seoTitle: p.seoTitle ?? "",
    seoDescription: p.seoDescription ?? "",
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("stock rules", () => {
  it("parses signed adjustments", () => {
    expect(parseStockDelta("+50")).toEqual({ ok: true, delta: 50 });
    expect(parseStockDelta(" -2 ")).toEqual({ ok: true, delta: -2 });
    expect(parseStockDelta("− 3")).toEqual({ ok: true, delta: -3 });
    expect(parseStockDelta("12")).toEqual({ ok: true, delta: 12 });
    expect(parseStockDelta("0").ok).toBe(false);
    expect(parseStockDelta("1.5").ok).toBe(false);
    expect(parseStockDelta("abc").ok).toBe(false);
    expect(parseStockDelta("").ok).toBe(false);
    expect(parseStockDelta("+100001").ok).toBe(false);
  });
  // T-8 / SA-1: bàn phím số iPhone không có dấu trừ → chọn chiều + số dương
  it("parses direction + positive amount", () => {
    expect(parseStockAdjustment("in", "50")).toEqual({ ok: true, delta: 50 });
    expect(parseStockAdjustment("out", "2")).toEqual({ ok: true, delta: -2 });
    expect(parseStockAdjustment("out", " 1 2 ")).toEqual({ ok: true, delta: -12 });
    expect(parseStockAdjustment("", "2")).toEqual({ ok: false, message: "Chọn Nhập thêm hoặc Bớt đi." });
    expect(parseStockAdjustment("set", "2").ok).toBe(false);
    expect(parseStockAdjustment("in", "0")).toEqual({ ok: false, message: "Số chai phải lớn hơn 0." });
    expect(parseStockAdjustment("in", "-2").ok).toBe(false);
    expect(parseStockAdjustment("in", "+2").ok).toBe(false);
    expect(parseStockAdjustment("in", "1.5").ok).toBe(false);
    expect(parseStockAdjustment("in", "").ok).toBe(false);
    expect(parseStockAdjustment("in", "100000")).toEqual({ ok: true, delta: 100_000 });
    expect(parseStockAdjustment("in", "100001").ok).toBe(false);
  });
  it("never goes below zero or above the cap", () => {
    expect(applyStockDelta(10, -10)).toEqual({ ok: true, next: 0 });
    expect(applyStockDelta(10, -11)).toEqual({ ok: false, message: "Tồn kho chỉ còn 10 chai, không trừ được 11." });
    expect(applyStockDelta(999_990, 20).ok).toBe(false);
  });
  it("needs a reason and a sane initial stock", () => {
    expect(stockReasonProblem(" ")).not.toBeNull();
    expect(stockReasonProblem("Nhập lô mới")).toBeNull();
    expect(stockReasonProblem("x".repeat(201))).not.toBeNull();
    expect(initialStockProblem(0)).toBeNull();
    expect(initialStockProblem(-1)).not.toBeNull();
    expect(initialStockProblem(1.5)).not.toBeNull();
  });
});

describe("saving a product does not overwrite stock", () => {
  it("keeps sales made while the form was open", async () => {
    const shown = await stockNow(); // admin mở form, thấy số này
    const sold = await placeOrder(
      {
        lines: [{ productId: tonic.id, quantity: 3 }],
        recipientName: "Khách",
        phoneE164: "84901112223",
        email: null,
        province: "Hà Nội",
        ward: "Phường A",
        addressLine: "1 Đường A",
        customerNote: null,
        paymentMethod: "cod",
        marketingConsent: false,
        consentTexts: { dataProcessing: "dp", marketing: "mk" },
        utm: null,
        landingVariant: null,
      },
      parseSettings({}),
    );
    expect(sold.ok).toBe(true);
    expect(await stockNow()).toBe(shown - 3);

    const result = await productActions.saveProductAction({ status: "idle" }, productForm(tonic, shown));
    expect(result.status).toBe("ok");
    expect(await stockNow()).toBe(shown - 3);
  }, 60_000);
});

describe("stock adjustment", () => {
  it("adds and subtracts atomically, refuses negative stock, writes audit with reason", async () => {
    const adjust = (productActions as Record<string, unknown>).adjustStockAction as typeof productActions.saveProductAction;
    expect(typeof adjust).toBe("function");
    const before = await stockNow();
    // Form mới: direction (in/out) + amount dương
    const fd = (direction: string, amount: string, reason: string) => {
      const f = new FormData();
      f.set("id", tonic.id);
      f.set("direction", direction);
      f.set("amount", amount);
      f.set("reason", reason);
      return f;
    };

    const added = await adjust({ status: "idle" }, fd("in", "50", "Nhập hàng lô mới"));
    expect(added).toMatchObject({ status: "ok", message: `Đã nhập thêm 50 chai, còn ${before + 50} chai.` });
    expect(await stockNow()).toBe(before + 50);

    const tooMuch = await adjust({ status: "idle" }, fd("out", String(before + 51), "Vỡ"));
    expect(tooMuch).toEqual({ status: "error", message: `Tồn kho chỉ còn ${before + 50} chai, không trừ được ${before + 51}.` });
    expect(await stockNow()).toBe(before + 50);

    expect(await adjust({ status: "idle" }, fd("", "2", "Vỡ 2 chai"))).toEqual({ status: "error", message: "Chọn Nhập thêm hoặc Bớt đi." });
    expect((await adjust({ status: "idle" }, fd("out", "-2", "Vỡ 2 chai"))).status).toBe("error");
    expect((await adjust({ status: "idle" }, fd("out", "2", ""))).status).toBe("error");
    expect(await stockNow()).toBe(before + 50);
    expect((await adjust({ status: "idle" }, fd("out", "2", "Vỡ 2 chai"))).status).toBe("ok");
    expect(await stockNow()).toBe(before + 48);

    const db = await getDb();
    const [last] = await db.select().from(auditLog).where(eq(auditLog.action, "product.stock_adjusted")).orderBy(desc(auditLog.at)).limit(1);
    expect(last?.before).toEqual({ stock: before + 50 });
    expect(last?.after).toEqual({ stock: before + 48, delta: -2, reason: "Vỡ 2 chai" });

    // Trang quản trị cũ còn mở lúc deploy vẫn gửi ô "delta" có dấu: vẫn nhận
    const legacy = new FormData();
    legacy.set("id", tonic.id);
    legacy.set("delta", "-1");
    legacy.set("reason", "Kiểm kho lệch");
    expect((await adjust({ status: "idle" }, legacy)).status).toBe("ok");
    expect(await stockNow()).toBe(before + 47);
  }, 60_000);
});
