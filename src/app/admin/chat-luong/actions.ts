"use server";

// Server Action phân hệ Chất lượng (03-chat-luong.md). Mỗi action: guard → requirePermission → service trong giao dịch.
// Service kiểm quyền lần nữa theo vai trò (Actor) để test được và để không vượt quyền khi gọi từ chỗ khác.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, type Tx } from "@/db/client";
import { requirePermission, type CurrentStaff } from "@/modules/auth/service";
import { addCapaAction, createCapa, createCapaFromComplaint, recordCapaEffectiveness, setCapaActionDone, transitionCapa, updateCapa } from "@/modules/qms/capa";
import { addInspectionParam, cancelInspectionByStaff, decideInspection, openFqcForLot, openIqcForStockLot, openRecheck, saveInspectionResults, type ResultEntry } from "@/modules/qms/decisions";
import { createRetainedSample, setStockLotHold } from "@/modules/qms/lots";
import { createNcr, createNcrFromComplaint, transitionNcr, updateNcr } from "@/modules/qms/ncr";
import { closeRecall, openRecall, receiveRecallReturn, recordRecallContact } from "@/modules/qms/recall";
import {
  CAPA_STATUS_LABEL,
  DISPOSITION_LABEL,
  NCR_CATEGORY_LABEL,
  NCR_STATUS_LABEL,
  parseMeasure,
  PARAM_GROUP_LABEL,
  RECALL_CONTACT_LABEL,
  SEVERITY_LABEL,
  type Actor,
  type CapaStatus,
  type Disposition,
  type NcrCategory,
  type NcrSeverity,
  type NcrStatus,
  type ParamGroupKey,
  type RecallContactStatus,
} from "@/modules/qms/rules";
import { activateStandard, archiveStandard, createStandard, newStandardVersion, updateStandardDraft, type AppliesTo, type LotTestTypeKey, type StandardInput, type StandardParamInput } from "@/modules/qms/standards";
import { fail, guard, ok, optStr, str, type ActionResult } from "../_lib/result";

const actorOf = (s: CurrentStaff): Actor => ({ id: s.id, role: s.role });
const tx = async <T>(fn: (t: Tx) => Promise<T>): Promise<T> => (await getDb()).transaction(fn);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const optDate = (fd: FormData, k: string) => {
  const v = optStr(fd, k);
  return v && DATE.test(v) ? v : null;
};

// ---------------------------------------------------------------------------------------------
// Tiêu chuẩn

const APPLIES: AppliesTo[] = ["raw_material", "extract", "wip", "finished", "packaging"];
const LOT_TESTS: LotTestTypeKey[] = ["microbial", "heavy_metals", "stability", "gc_ms", "irritation", "sensory"];

// Đọc các dòng chỉ tiêu p_<field>_<i>; dòng không có tên bị bỏ
function readStandard(fd: FormData): { input: StandardInput } | { error: string } {
  const appliesTo = str(fd, "appliesTo") as AppliesTo;
  if (!APPLIES.includes(appliesTo)) return { error: "Chọn nhóm áp dụng" };
  const target = str(fd, "target");
  const params: StandardParamInput[] = [];
  const rows = Number(str(fd, "rows")) || 0;
  for (let i = 0; i < Math.min(rows, 60); i++) {
    const name = str(fd, `p_name_${i}`);
    if (!name) continue;
    const kind = str(fd, `p_kind_${i}`) as StandardParamInput["kind"];
    if (kind !== "range" && kind !== "pass_fail" && kind !== "text") return { error: `Chỉ tiêu ${name}: chọn kiểu` };
    const group = str(fd, `p_group_${i}`) as ParamGroupKey;
    if (!(group in PARAM_GROUP_LABEL)) return { error: `Chỉ tiêu ${name}: chọn nhóm` };
    const lim = (k: string, label: string): number | null | string => {
      const raw = str(fd, `p_${k}_${i}`);
      if (!raw || kind !== "range") return null;
      const m = parseMeasure(raw);
      return m.ok ? m.milli : `Chỉ tiêu ${name}: ${label} ${m.message.toLowerCase()}`;
    };
    const min = lim("min", "giới hạn dưới");
    const max = lim("max", "giới hạn trên");
    if (typeof min === "string") return { error: min };
    if (typeof max === "string") return { error: max };
    const lt = str(fd, `p_lottest_${i}`);
    params.push({
      name,
      paramGroup: group,
      kind,
      unit: str(fd, `p_unit_${i}`),
      minMilli: min,
      maxMilli: max,
      expectedText: optStr(fd, `p_expected_${i}`),
      method: str(fd, `p_method_${i}`),
      lotTestType: LOT_TESTS.includes(lt as LotTestTypeKey) ? (lt as LotTestTypeKey) : null,
      isCritical: fd.get(`p_critical_${i}`) === "on",
    });
  }
  return {
    input: {
      name: str(fd, "name"),
      appliesTo,
      itemId: target.startsWith("item:") ? target.slice(5) : null,
      productId: target.startsWith("product:") ? target.slice(8) : null,
      effectiveFrom: optDate(fd, "effectiveFrom"),
      note: optStr(fd, "note"),
      params,
    },
  };
}

export async function createStandardAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("quality.write");
    const r = readStandard(fd);
    if ("error" in r) return fail(r.error);
    const s = await tx((t) => createStandard(t, r.input, actorOf(staff)));
    id = s.id;
    revalidatePath("/admin/chat-luong/tieu-chuan");
    return ok(`Đã tạo ${s.code} bản nháp`);
  });
  if (id) redirect(`/admin/chat-luong/tieu-chuan/${id}`);
  return result;
}

export async function updateStandardAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const id = str(fd, "id");
    const r = readStandard(fd);
    if ("error" in r) return fail(r.error);
    await tx((t) => updateStandardDraft(t, id, r.input, actorOf(staff)));
    revalidatePath(`/admin/chat-luong/tieu-chuan/${id}`);
    return ok("Đã lưu bản nháp");
  });
}

export async function standardStatusAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let goTo: string | null = null;
  const result = await guard(async () => {
    const op = str(fd, "op");
    const id = str(fd, "id");
    if (op === "activate") {
      const staff = await requirePermission("quality.approve");
      await tx((t) => activateStandard(t, id, actorOf(staff)));
      revalidatePath(`/admin/chat-luong/tieu-chuan/${id}`);
      return ok("Đã kích hoạt. Bản đang áp dụng trước đó chuyển lưu trữ.");
    }
    if (op === "archive") {
      const staff = await requirePermission("quality.approve");
      await tx((t) => archiveStandard(t, id, actorOf(staff)));
      revalidatePath(`/admin/chat-luong/tieu-chuan/${id}`);
      return ok("Đã lưu trữ");
    }
    if (op === "new_version") {
      const staff = await requirePermission("quality.write");
      const r = await tx((t) => newStandardVersion(t, id, actorOf(staff)));
      goTo = `/admin/chat-luong/tieu-chuan/${r.id}`;
      return ok(r.created ? `Đã tạo bản nháp v${r.version}` : `Đã có bản nháp v${r.version}`);
    }
    return fail("Thao tác không hợp lệ");
  });
  if (goTo) redirect(goTo);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Phiếu kiểm

export async function saveResultsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const id = str(fd, "id");
    const entries: ResultEntry[] = fd.getAll("resultId").map((v) => {
      const rid = String(v);
      const pf = str(fd, `pf_${rid}`);
      return {
        resultId: rid,
        value: fd.has(`v_${rid}`) ? str(fd, `v_${rid}`) : undefined,
        passFail: fd.has(`pf_${rid}`) ? (pf === "pass" || pf === "fail" ? pf : "") : undefined,
        text: fd.has(`t_${rid}`) ? str(fd, `t_${rid}`) : undefined,
        note: fd.has(`n_${rid}`) ? str(fd, `n_${rid}`) : undefined,
      };
    });
    const r = await tx((t) => saveInspectionResults(t, id, { entries, sampleSize: optStr(fd, "sampleSize"), note: optStr(fd, "note") }, actorOf(staff)));
    revalidatePath(`/admin/chat-luong/phieu-kiem/${id}`);
    return ok(`Đã lưu ${r.saved} kết quả`);
  });
}

export async function addParamAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const id = str(fd, "id");
    const kind = str(fd, "kind") as "range" | "pass_fail" | "text";
    if (kind !== "range" && kind !== "pass_fail" && kind !== "text") return fail("Chọn kiểu chỉ tiêu");
    const group = str(fd, "paramGroup") as ParamGroupKey;
    if (!(group in PARAM_GROUP_LABEL)) return fail("Chọn nhóm chỉ tiêu");
    await tx((t) =>
      addInspectionParam(
        t,
        id,
        { name: str(fd, "name"), paramGroup: group, kind, unit: str(fd, "unit"), min: optStr(fd, "min"), max: optStr(fd, "max"), expectedText: optStr(fd, "expectedText"), isCritical: fd.get("isCritical") === "on" },
        actorOf(staff),
      ),
    );
    revalidatePath(`/admin/chat-luong/phieu-kiem/${id}`);
    return ok("Đã thêm chỉ tiêu");
  });
}

export async function decideInspectionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.approve");
    const id = str(fd, "id");
    const disposition = str(fd, "disposition") as Disposition;
    if (!(disposition in DISPOSITION_LABEL)) return fail("Chọn quyết định");
    const r = await tx((t) => decideInspection(t, id, { disposition, note: optStr(fd, "note") }, actorOf(staff)));
    revalidatePath(`/admin/chat-luong/phieu-kiem/${id}`);
    revalidatePath("/admin/chat-luong");
    const parts = [`Đã ghi quyết định: ${DISPOSITION_LABEL[disposition]}.`];
    if (r.movedQty > 0) parts.push("Số dư đã chuyển sang kho cách ly REJ.");
    if (r.ncr) parts.push(`Đã mở ${r.ncr.code}.`);
    if (r.supplierReturn) parts.push(`Phiếu xuất trả NCC ${r.supplierReturn.code} đang nháp, ghi sổ ở phân hệ Kho.`);
    return ok(parts.join(" "));
  });
}

export async function cancelInspectionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const id = str(fd, "id");
    const reason = str(fd, "reason");
    if (!reason) return fail("Ghi lý do hủy phiếu");
    await tx((t) => cancelInspectionByStaff(t, id, reason, actorOf(staff)));
    revalidatePath(`/admin/chat-luong/phieu-kiem/${id}`);
    return ok("Đã hủy phiếu");
  });
}

export async function openIqcAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let goTo: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("quality.write");
    const r = await tx((t) => openIqcForStockLot(t, str(fd, "stockLotId"), actorOf(staff)));
    goTo = `/admin/chat-luong/phieu-kiem/${r.id}`;
    return ok(`Đã mở ${r.code}`);
  });
  if (goTo) redirect(goTo);
  return result;
}

// R-CL-14: "Mở phiếu FQC" trên trang lô thay cho nút duyệt trực tiếp
export async function openFqcAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let goTo: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("quality.write");
    const r = await tx((t) => openFqcForLot(t, str(fd, "lotId"), actorOf(staff)));
    goTo = `/admin/chat-luong/phieu-kiem/${r.id}`;
    return ok(r.created ? `Đã mở ${r.code}` : `Lô đã có phiếu ${r.code} đang chờ`);
  });
  if (goTo) redirect(goTo);
  return result;
}

export async function openRecheckAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let goTo: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("quality.write");
    const lotId = str(fd, "lotId");
    if (!lotId) return fail("Phản ánh chưa gắn lô, chưa kiểm lại được");
    const r = await tx((t) => openRecheck(t, { lotId, complaintId: optStr(fd, "complaintId") }, actorOf(staff)));
    goTo = `/admin/chat-luong/phieu-kiem/${r.id}`;
    return ok(`Đã mở ${r.code}`);
  });
  if (goTo) redirect(goTo);
  return result;
}

// ---------------------------------------------------------------------------------------------
// NCR

export async function createNcrAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let goTo: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("quality.write");
    const category = str(fd, "category") as NcrCategory;
    const severity = str(fd, "severity") as NcrSeverity;
    if (!(category in NCR_CATEGORY_LABEL)) return fail("Chọn loại sai lỗi");
    if (!(severity in SEVERITY_LABEL)) return fail("Chọn mức độ");
    const r = await tx((t) =>
      createNcr(
        t,
        { title: str(fd, "title"), category, severity, description: str(fd, "description"), containment: str(fd, "containment"), dueOn: optDate(fd, "dueOn"), lotId: optStr(fd, "lotId"), ownerId: staff.id },
        actorOf(staff),
      ),
    );
    goTo = `/admin/chat-luong/ncr/${r.id}`;
    return ok(`Đã tạo ${r.code}`);
  });
  if (goTo) redirect(goTo);
  return result;
}

export async function createNcrFromComplaintAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let goTo: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("quality.write");
    const r = await tx((t) => createNcrFromComplaint(t, str(fd, "complaintId"), actorOf(staff)));
    revalidatePath("/admin/phan-anh");
    goTo = `/admin/chat-luong/ncr/${r.id}`;
    return ok(r.created ? `Đã tạo ${r.code}` : `Phản ánh đã có ${r.code}`);
  });
  if (goTo) redirect(goTo);
  return result;
}

export async function updateNcrAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const id = str(fd, "id");
    const severity = str(fd, "severity") as NcrSeverity;
    await tx((t) =>
      updateNcr(
        t,
        id,
        {
          title: str(fd, "title"),
          description: str(fd, "description"),
          severity: severity in SEVERITY_LABEL ? severity : undefined,
          containment: str(fd, "containment"),
          rootCause: str(fd, "rootCause"),
          correction: str(fd, "correction"),
          verificationNote: str(fd, "verificationNote"),
          dueOn: optDate(fd, "dueOn"),
        },
        actorOf(staff),
      ),
    );
    revalidatePath(`/admin/chat-luong/ncr/${id}`);
    return ok("Đã lưu");
  });
}

export async function transitionNcrAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const to = str(fd, "to") as NcrStatus;
    if (!(to in NCR_STATUS_LABEL)) return fail("Trạng thái không hợp lệ");
    const staff = await requirePermission(to === "closed" ? "quality.approve" : "quality.write");
    const id = str(fd, "id");
    const from = str(fd, "from") as NcrStatus;
    await tx((t) => transitionNcr(t, id, to, actorOf(staff), { expectedFrom: from in NCR_STATUS_LABEL ? from : undefined, reason: optStr(fd, "reason") }));
    revalidatePath(`/admin/chat-luong/ncr/${id}`);
    return ok(`Đã chuyển sang ${NCR_STATUS_LABEL[to]}`);
  });
}

// ---------------------------------------------------------------------------------------------
// CAPA

export async function createCapaAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let goTo: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("quality.write");
    const type = str(fd, "type") === "preventive" ? "preventive" : "corrective";
    const steps = str(fd, "steps")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((description) => ({ description }));
    const r = await tx((t) =>
      createCapa(
        t,
        {
          type,
          title: str(fd, "title"),
          problem: str(fd, "problem"),
          ncrId: optStr(fd, "ncrId"),
          dueOn: optDate(fd, "dueOn"),
          ownerId: staff.id,
          effectivenessCriteria: str(fd, "effectivenessCriteria"),
          steps,
        },
        actorOf(staff),
      ),
    );
    goTo = `/admin/chat-luong/capa/${r.id}`;
    return ok(`Đã tạo ${r.code}`);
  });
  if (goTo) redirect(goTo);
  return result;
}

export async function createCapaFromComplaintAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let goTo: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("quality.write");
    const r = await tx((t) => createCapaFromComplaint(t, str(fd, "complaintId"), actorOf(staff), { ownerId: staff.id }));
    revalidatePath("/admin/phan-anh");
    goTo = `/admin/chat-luong/capa/${r.id}`;
    return ok(`Đã tạo ${r.code}`);
  });
  if (goTo) redirect(goTo);
  return result;
}

export async function updateCapaAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const id = str(fd, "id");
    await tx((t) =>
      updateCapa(
        t,
        id,
        {
          title: str(fd, "title"),
          problem: str(fd, "problem"),
          rootCauseMethod: str(fd, "rootCauseMethod"),
          rootCause: str(fd, "rootCause"),
          actionPlan: str(fd, "actionPlan"),
          dueOn: optDate(fd, "dueOn"),
          effectivenessCriteria: str(fd, "effectivenessCriteria"),
          effectivenessCheckOn: optDate(fd, "effectivenessCheckOn"),
        },
        actorOf(staff),
      ),
    );
    revalidatePath(`/admin/chat-luong/capa/${id}`);
    return ok("Đã lưu");
  });
}

export async function addCapaStepAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const id = str(fd, "id");
    await tx((t) => addCapaAction(t, id, { description: str(fd, "description"), dueOn: optDate(fd, "dueOn"), ownerId: staff.id }, actorOf(staff)));
    revalidatePath(`/admin/chat-luong/capa/${id}`);
    return ok("Đã thêm bước");
  });
}

export async function capaStepDoneAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const done = str(fd, "done") === "1";
    await tx((t) => setCapaActionDone(t, str(fd, "stepId"), done, optStr(fd, "result"), actorOf(staff)));
    revalidatePath(`/admin/chat-luong/capa/${str(fd, "id")}`);
    return ok(done ? "Đã đánh dấu xong" : "Đã mở lại bước");
  });
}

export async function transitionCapaAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const to = str(fd, "to") as CapaStatus;
    if (!(to in CAPA_STATUS_LABEL)) return fail("Trạng thái không hợp lệ");
    const staff = await requirePermission(to === "closed" ? "quality.approve" : "quality.write");
    const id = str(fd, "id");
    const from = str(fd, "from") as CapaStatus;
    await tx((t) => transitionCapa(t, id, to, actorOf(staff), { expectedFrom: from in CAPA_STATUS_LABEL ? from : undefined, reason: optStr(fd, "reason") }));
    revalidatePath(`/admin/chat-luong/capa/${id}`);
    return ok(`Đã chuyển sang ${CAPA_STATUS_LABEL[to]}`);
  });
}

export async function capaEffectivenessAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const id = str(fd, "id");
    const eff = str(fd, "effective");
    if (eff !== "yes" && eff !== "no") return fail("Chọn có hiệu quả hay không");
    const r = await tx((t) => recordCapaEffectiveness(t, id, { result: str(fd, "result"), effective: eff === "yes" }, actorOf(staff)));
    revalidatePath(`/admin/chat-luong/capa/${id}`);
    return ok(r.status === "in_progress" ? "Chưa hiệu quả: CAPA quay lại Đang thực hiện, thêm bước mới." : "Đã ghi kết quả hiệu quả");
  });
}

// ---------------------------------------------------------------------------------------------
// Lô: khóa lô vật tư, mẫu lưu

export async function stockLotHoldAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const hold = str(fd, "hold") === "1";
    const staff = await requirePermission(hold ? "quality.write" : "quality.approve");
    const reason = optStr(fd, "reason");
    if (hold && !reason) return fail("Ghi lý do khóa lô");
    await tx((t) => setStockLotHold(t, str(fd, "stockLotId"), hold, reason, actorOf(staff)));
    revalidatePath("/admin/chat-luong/truy-xuat");
    return ok(hold ? "Đã khóa lô" : "Đã mở khóa lô");
  });
}

export async function retainedSampleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const lotId = str(fd, "lotId");
    const units = Number(str(fd, "units"));
    const r = await tx((t) => createRetainedSample(t, { lotId, units, location: str(fd, "location"), keepUntil: str(fd, "keepUntil"), note: optStr(fd, "note") }, actorOf(staff)));
    revalidatePath(`/admin/lo/${lotId}`);
    return ok(r.status === "posted" ? `Đã xuất mẫu lưu qua phiếu ${r.issueCode}` : `Phiếu ${r.issueCode} đang chờ duyệt xuất`);
  });
}

// ---------------------------------------------------------------------------------------------
// Thu hồi

export async function openRecallAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let goTo: string | null = null;
  const result = await guard(async () => {
    const staff = await requirePermission("quality.approve");
    const severity = str(fd, "severity") as NcrSeverity;
    if (!(severity in SEVERITY_LABEL)) return fail("Chọn mức độ");
    const lotIds = fd.getAll("lotIds").map(String).filter(Boolean);
    const r = await tx((t) => openRecall(t, { reason: str(fd, "reason"), severity, lotIds, ncrId: optStr(fd, "ncrId"), note: optStr(fd, "note") }, actorOf(staff)));
    revalidatePath("/admin/chat-luong/thu-hoi");
    goTo = `/admin/chat-luong/thu-hoi/${r.id}`;
    return ok(`Đã mở ${r.code}: ${r.contacts} đơn cần liên hệ`);
  });
  if (goTo) redirect(goTo);
  return result;
}

export async function recallContactAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const status = str(fd, "status") as RecallContactStatus;
    if (!(status in RECALL_CONTACT_LABEL) || status === "pending") return fail("Chọn kết quả liên hệ");
    await tx((t) => recordRecallContact(t, str(fd, "contactId"), { status, note: optStr(fd, "note") }, actorOf(staff)));
    revalidatePath(`/admin/chat-luong/thu-hoi/${str(fd, "recallId")}`);
    return ok("Đã ghi liên hệ");
  });
}

export async function recallReceiveAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.write");
    const lines: { orderItemId: string; qty: number }[] = [];
    for (const v of fd.getAll("orderItemId")) {
      const id = String(v);
      const qty = Number(str(fd, `qty_${id}`) || "0");
      if (!Number.isInteger(qty) || qty < 0) return fail("Số chai phải là số nguyên không âm");
      if (qty > 0) lines.push({ orderItemId: id, qty });
    }
    const r = await tx((t) => receiveRecallReturn(t, str(fd, "contactId"), lines, actorOf(staff)));
    revalidatePath(`/admin/chat-luong/thu-hoi/${str(fd, "recallId")}`);
    return ok(`Đã nhập cách ly qua phiếu ${r.code}`);
  });
}

export async function closeRecallAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const staff = await requirePermission("quality.approve");
    const id = str(fd, "id");
    await tx((t) => closeRecall(t, id, actorOf(staff), optStr(fd, "note")));
    revalidatePath(`/admin/chat-luong/thu-hoi/${id}`);
    return ok("Đã đóng hồ sơ thu hồi");
  });
}
