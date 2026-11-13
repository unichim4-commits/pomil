// Chất lượng: quy tắc thuần cho phiếu kiểm dùng chung (03-chat-luong.md R-CL-2, R-CL-10). Service ở inspections.ts gọi lại.
import type { DocPrefix } from "@/modules/numbering/rules";

export type InspectionStageKey = "iqc" | "ipqc" | "fqc" | "recheck";
export type QcAppliesTo = "raw_material" | "extract" | "wip" | "finished" | "packaging";
export type ItemKindKey = "raw_material" | "extract" | "packaging" | "wip" | "finished" | "other";

export const INSPECTION_PREFIX: Record<InspectionStageKey, DocPrefix> = {
  iqc: "IQC",
  ipqc: "IPQC",
  fqc: "FQC",
  recheck: "KTL",
};

// Nhóm tiêu chuẩn theo kind hàng khi IQC (R-CL-2): other → raw_material; finished không có IQC nên quy về finished.
export function appliesToForItemKind(kind: ItemKindKey): QcAppliesTo {
  switch (kind) {
    case "extract":
      return "extract";
    case "packaging":
      return "packaging";
    case "wip":
      return "wip";
    case "finished":
      return "finished";
    case "raw_material":
    case "other":
    default:
      return "raw_material";
  }
}

// Nhóm tiêu chuẩn của phiếu (R-CL-2). IPQC: có mẻ chiết (hoặc lô nguồn là hàng chiết xuất) → extract, còn lại (công đoạn lệnh SX) → wip.
export function inspectionAppliesTo(input: { stage: InspectionStageKey; itemKind?: ItemKindKey | null; extractionRunId?: string | null }): QcAppliesTo {
  switch (input.stage) {
    case "iqc":
      return appliesToForItemKind(input.itemKind ?? "raw_material");
    case "ipqc":
      return input.extractionRunId || input.itemKind === "extract" ? "extract" : "wip";
    case "fqc":
    case "recheck":
      return "finished";
  }
}

export type StandardCandidate = {
  id: string;
  status: "draft" | "active" | "archived";
  appliesTo: QcAppliesTo;
  itemId: string | null;
  productId: string | null;
  effectiveFrom: string | null;
  code: string;
};

function newestFirst(a: StandardCandidate, b: StandardCandidate): number {
  // effective_from mới nhất trước; null xếp sau; bằng nhau thì theo mã để kết quả ổn định
  if (a.effectiveFrom !== b.effectiveFrom) {
    if (a.effectiveFrom === null) return 1;
    if (b.effectiveFrom === null) return -1;
    return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
  }
  return a.code.localeCompare(b.code);
}

// Chọn tiêu chuẩn (R-CL-2): (1) active gắn đúng hàng (IQC, IPQC) hoặc đúng sản phẩm (FQC, kiểm lại);
// (2) active chung cho nhóm, không gắn hàng/sản phẩm, effective_from mới nhất. Không có → null.
export function pickStandard(
  candidates: StandardCandidate[],
  target: { stage: InspectionStageKey; appliesTo: QcAppliesTo; itemId?: string | null; productId?: string | null },
): StandardCandidate | null {
  const active = candidates.filter((c) => c.status === "active");
  const byProduct = target.stage === "fqc" || target.stage === "recheck";
  const specific = active.filter((c) => (byProduct ? !!target.productId && c.productId === target.productId : !!target.itemId && c.itemId === target.itemId));
  if (specific.length > 0) return [...specific].sort(newestFirst)[0] ?? null;
  const general = active.filter((c) => c.appliesTo === target.appliesTo && c.itemId === null && c.productId === null);
  if (general.length > 0) return [...general].sort(newestFirst)[0] ?? null;
  return null;
}

export type DecidedInspection = { key: string; status: "pending" | "passed" | "failed" | "cancelled"; decidedAt: Date | null; createdAt: Date };

// R-CL-10: chặn khi có phiếu failed của một ref (công đoạn/mẻ) mà không có phiếu passed cùng ref quyết định muộn hơn.
// Phiếu thiếu decided_at lấy created_at làm mốc.
export function isDeviationBlocking(rows: DecidedInspection[]): boolean {
  const at = (r: DecidedInspection) => (r.decidedAt ?? r.createdAt).getTime();
  const latestFailed = new Map<string, number>();
  const latestPassed = new Map<string, number>();
  for (const r of rows) {
    const map = r.status === "failed" ? latestFailed : r.status === "passed" ? latestPassed : null;
    if (!map) continue;
    const t = at(r);
    if ((map.get(r.key) ?? -Infinity) < t) map.set(r.key, t);
  }
  for (const [key, failedAt] of latestFailed) {
    const passedAt = latestPassed.get(key);
    if (passedAt === undefined || passedAt <= failedAt) return true;
  }
  return false;
}
