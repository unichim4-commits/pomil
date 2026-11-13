// T-19 (QA): phân quyền ở mức Server Action (không tin nút bị ẩn), 5 phân hệ ERP + trang lô.
// Gọi thẳng các action thật; requirePermission dùng luật can() thật, chỉ thay phần đọc phiên đăng nhập.
// AC-TICHHOP-19 (vai trò "Chỉ xem" bị chặn ghi), 00-tong-quan.md mục 5 (ma trận quyền).
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

const ACTOR = { id: "", email: "", name: "QA", role: "viewer" as "owner" | "collaborator" | "viewer", totpEnabled: false };
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

const dir = mkdtempSync(path.join(tmpdir(), "pomil-qa-quyen-"));
process.env.PGLITE_DIR = dir;

import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { auditLog, cashTransactions, lots, stockMovements } from "@/db/schema";
import * as banHang from "@/app/admin/ban-hang/actions";
import * as chatLuong from "@/app/admin/chat-luong/actions";
import * as kho from "@/app/admin/kho/actions";
import * as lo from "@/app/admin/lo/actions";
import * as sanXuat from "@/app/admin/san-xuat/actions";
import * as taiChinh from "@/app/admin/tai-chinh/actions";
import { IDLE, type ActionResult } from "@/app/admin/_lib/result";
import { makeStaff, type TestActor } from "./_helpers";

// Action kiểm dữ liệu trước rồi mới kiểm quyền theo trạng thái đích: gửi form hợp lệ tối thiểu để tới bước kiểm quyền
const FIELDS: Record<string, Record<string, string>> = {
  standardStatusAction: { op: "activate", id: "00000000-0000-0000-0000-000000000000" },
  transitionNcrAction: { to: "investigating", id: "00000000-0000-0000-0000-000000000000" },
  transitionCapaAction: { to: "in_progress", id: "00000000-0000-0000-0000-000000000000" },
};
const DENIED = "Tài khoản của bạn không có quyền làm việc này.";
const MODULES = { kho, "san-xuat": sanXuat, "chat-luong": chatLuong, "ban-hang": banHang, "tai-chinh": taiChinh, lo } as Record<string, Record<string, unknown>>;
let staff: { owner: TestActor; collab: TestActor; viewer: TestActor };

function as(a: TestActor) {
  ACTOR.id = a.id;
  ACTOR.role = a.role;
  ACTOR.email = `${a.role}@qa.test`;
}
async function counts() {
  const db = await getDb();
  const n = async (t: typeof auditLog | typeof stockMovements | typeof cashTransactions) => (await db.select({ n: sql<number>`count(*)::int` }).from(t))[0]!.n;
  return { audit: await n(auditLog), moves: await n(stockMovements), cash: await n(cashTransactions) };
}
async function call(fn: unknown, fd = new FormData()): Promise<ActionResult | { status: "threw"; message: string }> {
  try {
    return await (fn as (p: ActionResult, f: FormData) => Promise<ActionResult>)(IDLE, fd);
  } catch (e) {
    return { status: "threw", message: e instanceof Error ? e.message : String(e) };
  }
}
function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeAll(async () => {
  await getDb();
  staff = await makeStaff("quyen");
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("vai trò Chỉ xem (AC-TICHHOP-19)", { timeout: 120_000 }, () => {
  it("AC-TICHHOP-19: mọi Server Action ghi của Kho, Sản xuất, Chất lượng, Bán hàng, Tài chính, Lô trả lỗi quyền; không ghi audit, kho, quỹ", async () => {
    as(staff.viewer);
    const before = await counts();
    const notDenied: string[] = [];
    let total = 0;
    for (const [mod, exports] of Object.entries(MODULES)) {
      for (const [name, fn] of Object.entries(exports)) {
        if (typeof fn !== "function") continue;
        total++;
        const r = await call(fn, form(FIELDS[name] ?? {}));
        if (r.status !== "error" || r.message !== DENIED) notDenied.push(`${mod}.${name}: ${r.status} ${"message" in r ? r.message : ""}`);
      }
    }
    expect(total).toBeGreaterThan(130);
    expect(notDenied).toEqual([]);
    expect(await counts()).toEqual(before);
  });
});

describe("cộng tác viên: chặn đúng quyền duyệt, giá, tài chính, công thức", { timeout: 120_000 }, () => {
  const blocked: [string, string][] = [
    ["tai-chinh", "payDebtAction"],
    ["tai-chinh", "approveCashAction"],
    ["tai-chinh", "createPayableAction"],
    ["tai-chinh", "costLockAction"],
    ["kho", "updateLineCostAction"],
    ["kho", "postIssueAction"],
    ["kho", "toggleTrackingAction"],
    ["san-xuat", "createFormulaAction"],
    ["san-xuat", "changeVersionStatusAction"],
    ["chat-luong", "decideInspectionAction"],
    ["chat-luong", "openRecallAction"],
    ["chat-luong", "closeRecallAction"],
    ["ban-hang", "savePriceListAction"],
    ["ban-hang", "priceItemAction"],
    ["ban-hang", "saveChannelAction"],
    ["ban-hang", "saveVoucherAction"],
  ];
  it.each(blocked)("%s.%s: cộng tác viên nhận lỗi quyền, không ghi gì", async (mod, name) => {
    as(staff.collab);
    const fn = MODULES[mod]![name];
    expect(typeof fn).toBe("function");
    const before = await counts();
    const r = await call(fn);
    expect(r).toMatchObject({ status: "error", message: DENIED });
    expect(await counts()).toEqual(before);
  });

  it("được phép: lập phiếu nhập kho nháp, đơn bán tay, phiếu kiểm, đề nghị chi (lỗi trả về là lỗi dữ liệu form rỗng, không phải lỗi quyền)", async () => {
    as(staff.collab);
    for (const [mod, name] of [
      ["kho", "createReceiptAction"],
      ["ban-hang", "createOrderAction"],
      ["chat-luong", "saveResultsAction"],
      ["tai-chinh", "createCashAction"],
      ["san-xuat", "createOrderAction"],
    ] as const) {
      const fn = MODULES[mod]![name];
      expect(typeof fn, `${mod}.${name}`).toBe("function");
      const r = await call(fn);
      expect("message" in r ? r.message : "", `${mod}.${name}`).not.toBe(DENIED);
    }
  });

  it("BUG-1: cộng tác viên gọi releaseLotAction (duyệt xuất lô thành phẩm, không qua FQC) bị chặn, cần quyền quality.approve (Q17)", async () => {
    as(staff.collab);
    const db = await getDb();
    const [lot] = await db.select().from(lots).where(eq(lots.lotNo, "PST-271101-01"));
    expect(lot).toBeDefined();
    const r = await call(lo.releaseLotAction, form({ lotId: lot!.id }));
    expect(r).toMatchObject({ status: "error", message: DENIED });
  });
});
