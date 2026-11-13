import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

const dir = mkdtempSync(path.join(tmpdir(), "pomil-numbering-"));
process.env.PGLITE_DIR = dir;

import { getDb } from "@/db/client";
import { docSequenceKey, formatDocCode, vnToday } from "@/modules/numbering/rules";
import { nextDocCode } from "@/modules/numbering/service";

beforeAll(async () => {
  await getDb();
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("formatDocCode (R-CHUNG-7, mục 4)", () => {
  it("formats by prefix width", () => {
    expect(formatDocCode("PN", "2611", 1)).toBe("PN-2611-0001");
    expect(formatDocCode("DCK", "2611", 1)).toBe("DCK-2611-001");
    expect(formatDocCode("TH", "2712", 1)).toBe("TH-2712-01");
    expect(formatDocCode("PB", "2711", 3)).toBe("PB-2711-03");
    expect(formatDocCode("CNP", "2611", 1)).toBe("CNP-2611-0001");
    expect(formatDocCode("FQC", "2711", 4)).toBe("FQC-2711-004");
  });
  it("prefixes without month", () => {
    expect(formatDocCode("FORM", null, 1)).toBe("FORM-001");
    expect(formatDocCode("TC", null, 12)).toBe("TC-012");
    expect(formatDocCode("BB", null, 4)).toBe("BB-004");
    expect(formatDocCode("DL", null, 1)).toBe("DL-001");
  });
  it("grows past the width instead of wrapping", () => {
    expect(formatDocCode("PN", "2611", 9999)).toBe("PN-2611-9999");
    expect(formatDocCode("PN", "2611", 10000)).toBe("PN-2611-10000");
  });
  it("rejects non-positive sequence", () => {
    expect(() => formatDocCode("PN", "2611", 0)).toThrow();
  });
});

describe("vnToday (R-CHUNG-6)", () => {
  it("uses Vietnam time", () => {
    // 20/11/2027 23:30 UTC = 21/11 06:30 giờ VN
    expect(vnToday(new Date("2027-11-20T23:30:00Z"))).toBe("2027-11-21");
    expect(vnToday(new Date("2027-11-20T10:00:00Z"))).toBe("2027-11-20");
  });
  it("builds sequence keys per month or global", () => {
    expect(docSequenceKey("PN", new Date("2026-11-11T05:00:00Z"))).toBe("PN-2611");
    expect(docSequenceKey("FORM", new Date("2026-11-11T05:00:00Z"))).toBe("FORM");
  });
});

describe("nextDocCode on PGlite", () => {
  it("increments per month and resets in a new month", async () => {
    const db = await getDb();
    const nov = new Date("2026-11-11T05:00:00Z");
    const dec = new Date("2026-12-02T05:00:00Z");
    const a = await db.transaction((tx) => nextDocCode(tx, "PN", nov));
    const b = await db.transaction((tx) => nextDocCode(tx, "PN", nov));
    const c = await db.transaction((tx) => nextDocCode(tx, "PN", dec));
    const d = await db.transaction((tx) => nextDocCode(tx, "FORM", nov));
    const e = await db.transaction((tx) => nextDocCode(tx, "FORM", dec));
    expect([a, b, c]).toEqual(["PN-2611-0001", "PN-2611-0002", "PN-2612-0001"]);
    expect([d, e]).toEqual(["FORM-001", "FORM-002"]);
  }, 30_000);

  it("never gives the same code to two concurrent callers", async () => {
    const db = await getDb();
    const at = new Date("2026-11-11T05:00:00Z");
    const codes = await Promise.all(Array.from({ length: 10 }, () => db.transaction((tx) => nextDocCode(tx, "LSX", at))));
    expect(new Set(codes).size).toBe(10);
    expect(codes.sort()).toEqual(Array.from({ length: 10 }, (_, i) => `LSX-2611-${String(i + 1).padStart(3, "0")}`));
  }, 30_000);
});
