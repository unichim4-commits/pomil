// T-19 kiểm lại vòng 1 (QA): AC-TC-9 / R-TC-11 qua Server Action thật payDebtAction (đúng đường form trả nợ gửi),
// không chỉ qua service. Xét cách sửa BUG-5: form mang số đã trả lúc mở trang (expectedPaidAmount).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));

const ACTOR = { id: "", email: "owner@qa.test", name: "QA", role: "owner" as "owner" | "collaborator" | "viewer", totpEnabled: false };
vi.mock("@/modules/auth/service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/auth/service")>();
  const { can } = await import("@/modules/auth/rules");
  return {
    ...original,
    requireStaff: async () => ({ ...ACTOR }),
    requirePermission: async (p: Parameters<typeof can>[1]) => {
      if (!can(ACTOR.role, p)) throw new original.PermissionError();
      return { ...ACTOR };
    },
  };
});

const dir = mkdtempSync(path.join(tmpdir(), "pomil-qa-trano-"));
process.env.PGLITE_DIR = dir;

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cashAccounts, debtPayments, financeCategories, payables, suppliers } from "@/db/schema";
import { payDebtAction } from "@/app/admin/tai-chinh/actions";
import { IDLE } from "@/app/admin/_lib/result";
import { vnToday } from "@/modules/numbering/rules";
import { addDays } from "@/modules/sales/rules";
import { checkInvariants, makeStaff } from "./_helpers";

const today = vnToday();
let accountId = "";
let n = 0;

async function newPayable(amount: number) {
  const db = await getDb();
  n += 1;
  const [sup] = await db.insert(suppliers).values({ code: `NCC-TN-${n}`, name: `NCC QA ${n}`, kind: "packaging", paymentTermsDays: 30 }).returning({ id: suppliers.id });
  const [cat] = await db.select().from(financeCategories).where(eq(financeCategories.direction, "out")).limit(1);
  const [p] = await db
    .insert(payables)
    .values({ code: `PT-TN-${n}`, supplierId: sup!.id, categoryId: cat!.id, sourceType: "manual", amount, dueOn: addDays(today, 30), issuedOn: today } as typeof payables.$inferInsert)
    .returning({ id: payables.id });
  return p!.id;
}
// Dữ liệu y như form trên trang /admin/tai-chinh/cong-no/phai-tra/[id] gửi lên
function form(debtId: string, amount: number, expectedPaidAmount: number | null) {
  const fd = new FormData();
  fd.set("kind", "payable");
  fd.set("debtId", debtId);
  if (expectedPaidAmount !== null) fd.set("expectedPaidAmount", String(expectedPaidAmount));
  fd.set("amount", String(amount));
  fd.set("accountId", accountId);
  fd.set("paidOn", today);
  return fd;
}
async function state(id: string) {
  const db = await getDb();
  const [p] = await db.select().from(payables).where(eq(payables.id, id));
  const pays = await db.select().from(debtPayments).where(eq(debtPayments.payableId, id));
  return { paid: p!.paidAmount, status: p!.status, payments: pays.length };
}

beforeAll(async () => {
  const db = await getDb();
  const { owner } = await makeStaff("trano");
  ACTOR.id = owner.id;
  const accs = await db.select().from(cashAccounts);
  accountId = (accs.find((a) => a.code === "NH") ?? accs[0])!.id;
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("AC-TC-9 qua payDebtAction (form trả nợ)", { timeout: 60_000 }, () => {
  it("AC-TC-9: cùng một form trả một phần 2.000.000đ gửi hai lần đồng thời → chỉ một lần ghi, lần kia nhận câu tải lại trang", async () => {
    const id = await newPayable(4_500_001);
    const [a, b] = await Promise.all([payDebtAction(IDLE, form(id, 2_000_000, 0)), payDebtAction(IDLE, form(id, 2_000_000, 0))]);
    const res = [a, b];
    expect(res.filter((r) => r.status === "ok")).toHaveLength(1);
    const err = res.find((r) => r.status === "error");
    expect(err && "message" in err ? err.message : "").toMatch(/Khoản nợ vừa được ghi thanh toán khác \(đã trả 2\.000\.000/);
    expect(await state(id)).toMatchObject({ paid: 2_000_000, status: "partial", payments: 1 });
  });

  it("AC-TC-9: gửi lại form cũ lần lượt (không đồng thời, như bấm Back rồi gửi) cũng bị chặn", async () => {
    const id = await newPayable(5_000_000);
    expect((await payDebtAction(IDLE, form(id, 1_000_000, 0))).status).toBe("ok");
    const again = await payDebtAction(IDLE, form(id, 1_000_000, 0));
    expect(again.status).toBe("error");
    expect(await state(id)).toMatchObject({ paid: 1_000_000, payments: 1 });
  });

  it("R-TC-11: trả một phần hai lần hợp lệ (lần hai sau khi tải lại trang, form mang số mới) → ghi đủ cả hai, rồi trả đủ → paid", async () => {
    const id = await newPayable(3_000_000);
    expect((await payDebtAction(IDLE, form(id, 1_000_000, 0))).status).toBe("ok");
    expect((await payDebtAction(IDLE, form(id, 1_500_000, 1_000_000))).status).toBe("ok");
    expect(await state(id)).toMatchObject({ paid: 2_500_000, status: "partial", payments: 2 });
    expect((await payDebtAction(IDLE, form(id, 500_000, 2_500_000))).status).toBe("ok");
    expect(await state(id)).toMatchObject({ paid: 3_000_000, status: "paid", payments: 3 });
  });

  it("form thiếu expectedPaidAmount (trang cũ trước bản sửa) → từ chối 'Trang đã cũ', không ghi gì", async () => {
    const id = await newPayable(1_000_000);
    const r = await payDebtAction(IDLE, form(id, 500_000, null));
    expect(r.status).toBe("error");
    expect("message" in r ? r.message : "").toBe("Trang đã cũ, tải lại trang rồi ghi lại.");
    expect(await state(id)).toMatchObject({ paid: 0, payments: 0 });
  });

  it("bất biến INV-1…INV-9 sau các lần trả nợ", async () => {
    expect(await checkInvariants()).toEqual([]);
  });
});
