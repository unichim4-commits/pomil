import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-lot-"));
process.env.PGLITE_DIR = dir;

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { lots } from "@/db/schema";
import { checkClaims } from "@/modules/content/rules";
import { COMPLAINT_LOT_FORMAT_ERROR, LOT_COPY, LOT_FORMAT_HINT, NOT_FOUND_COPY } from "@/modules/quality/copy";
import { classifyLotLookup, LOT_NOT_PUBLIC_WARNING, lotNotPublicWarning } from "@/modules/quality/rules";
import { getPublicLot } from "@/modules/quality/service";

beforeAll(async () => {
  await getDb();
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("classifyLotLookup", () => {
  it("separates bad format, missing, pending and public lots", () => {
    expect(classifyLotLookup(false, null)).toBe("bad_format");
    expect(classifyLotLookup(true, null)).toBe("missing");
    expect(classifyLotLookup(true, { isPublic: false, releaseStatus: "released" })).toBe("pending");
    expect(classifyLotLookup(true, { isPublic: true, releaseStatus: "quarantine" })).toBe("pending");
    expect(classifyLotLookup(true, { isPublic: true, releaseStatus: "released" })).toBe("public");
    expect(classifyLotLookup(true, { isPublic: true, releaseStatus: "on_hold" })).toBe("public");
  });
});

describe("getPublicLot", () => {
  it("tells apart a missing lot, the quarantined sample lot, and a released public lot", async () => {
    expect(await getPublicLot("PST-991231-01")).toEqual({ kind: "missing" });
    // Lô mẫu trong dữ liệu chạy thử: đang cách ly, chưa công khai
    expect(await getPublicLot("PST-271101-01")).toEqual({ kind: "pending" });

    const db = await getDb();
    await db.update(lots).set({ isPublic: true, releaseStatus: "released" }).where(eq(lots.lotNo, "PST-271101-01"));
    const found = await getPublicLot("PST-271101-01");
    expect(found.kind).toBe("public");
    if (found.kind === "public") expect(found.lot.lotNo).toBe("PST-271101-01");
  });
});

describe("customer copy", () => {
  it("passes the claim filter", () => {
    const texts = [...Object.values(LOT_COPY), COMPLAINT_LOT_FORMAT_ERROR, NOT_FOUND_COPY.eyebrow, NOT_FOUND_COPY.title, NOT_FOUND_COPY.body, ...NOT_FOUND_COPY.links.map((l) => l.label)];
    expect(texts.flatMap((t) => checkClaims(t))).toEqual([]);
    // Ví dụ trong placeholder là dạng mẫu, không phải một lô có thật
    expect(LOT_COPY.badFormat).toContain("PST-YYMMDD-NN");
  });
});

// T-8 / SA-5: lô đã bán nhưng chưa bật công khai cũng rơi vào "pending"; câu cho khách không được
// khẳng định "đang chờ kiểm nghiệm" như sự thật.
describe("pending lot copy and admin warning", () => {
  it("does not state the lot is awaiting tests as a fact", () => {
    expect(LOT_COPY.pendingBody).not.toMatch(/^Lô này đang chờ kiểm nghiệm/);
    expect(LOT_COPY.pendingBody).toContain("chưa có trang công khai");
    expect(LOT_COPY.pendingBody).toContain("Thường là");
  });
  it("warns only for released lots that are not public", () => {
    expect(lotNotPublicWarning({ isPublic: false, releaseStatus: "released" })).toBe(LOT_NOT_PUBLIC_WARNING);
    expect(lotNotPublicWarning({ isPublic: true, releaseStatus: "released" })).toBeNull();
    expect(lotNotPublicWarning({ isPublic: false, releaseStatus: "quarantine" })).toBeNull();
    expect(lotNotPublicWarning({ isPublic: false, releaseStatus: "on_hold" })).toBeNull();
    expect(lotNotPublicWarning(null)).toBeNull();
  });
  it("complaint form uses the format hint, not a real-looking lot number", () => {
    expect(LOT_FORMAT_HINT).toBe("PST-YYMMDD-NN");
    expect(COMPLAINT_LOT_FORMAT_ERROR).toBe("Số lô có dạng PST-YYMMDD-NN, in dưới đáy chai. Không thấy số lô thì để trống.");
  });
});
