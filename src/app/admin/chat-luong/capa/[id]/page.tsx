import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { CAPA_TYPE_LABEL, getCapaDetail } from "@/modules/qms/admin";
import { CAPA_STATUS_LABEL, capaNextStatuses, isOverdue } from "@/modules/qms/rules";
import { vnToday } from "@/modules/numbering";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card } from "../../../_components/ui";
import { addCapaStepAction, capaEffectivenessAction, capaStepDoneAction, transitionCapaAction, updateCapaAction } from "../../actions";

export const metadata: Metadata = { title: "CAPA" };

export default async function CapaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, d] = await Promise.all([requireStaff(), getCapaDetail(id)]);
  if (!d) notFound();
  const c = d.capa;
  const done = c.status === "closed" || c.status === "cancelled";
  const canWrite = can(staff.role, "quality.write") && !done;
  const canApprove = can(staff.role, "quality.approve");
  const today = vnToday();
  const next = capaNextStatuses(c.status).filter((s) => (s === "closed" ? canApprove : canWrite));
  const doneCount = d.steps.filter((s) => s.doneAt).length;

  return (
    <>
      <Link href="/admin/chat-luong/capa" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← CAPA
      </Link>
      <div className="mb-6 mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl">{c.code}</h1>
        <Badge tone={c.status === "closed" ? "green" : c.status === "cancelled" ? "neutral" : "amber"}>{CAPA_STATUS_LABEL[c.status]}</Badge>
        <span className="text-sm text-ink-soft">
          {CAPA_TYPE_LABEL[c.type]} · {c.title}
        </span>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card title={`Các bước · xong ${doneCount}/${d.steps.length}`}>
            {d.steps.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa có bước nào.</p>
            ) : (
              <ol className="space-y-3">
                {d.steps.map((s, i) => {
                  const late = isOverdue(s.dueOn, today, !!s.doneAt);
                  return (
                    <li key={s.id} className={`border p-3 text-sm ${late ? "border-danger" : "border-line"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p>
                          {i + 1}. {s.description}
                          {s.dueOn && <span className={`ml-2 text-xs ${late ? "text-danger" : "text-ink-soft"}`}>hạn {formatDate(s.dueOn)}</span>}
                        </p>
                        {s.doneAt ? <Badge tone="green">Xong {formatDate(s.doneAt)}</Badge> : <Badge tone="amber">Chưa xong</Badge>}
                      </div>
                      {s.result && <p className="mt-1 text-ink-soft">{s.result}</p>}
                      {canWrite && c.status !== "verifying" && (
                        <ActionForm action={capaStepDoneAction} submitLabel={s.doneAt ? "Mở lại bước" : "Đánh dấu xong"} submitClassName="btn btn-outline min-h-11" className="mt-2 flex flex-wrap items-center gap-2" inline>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="stepId" value={s.id} />
                          <input type="hidden" name="done" value={s.doneAt ? "0" : "1"} />
                          {!s.doneAt && <input name="result" placeholder="Kết quả bước" aria-label="Kết quả bước" className="field min-w-0 flex-1" />}
                        </ActionForm>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {canWrite && c.status !== "verifying" && (
              <details className="mt-4 border-t border-line pt-3">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm">Thêm bước</summary>
                <ActionForm action={addCapaStepAction} submitLabel="Thêm bước" className="mt-3 grid gap-3 sm:grid-cols-[1fr_12rem]" resetOnSuccess>
                  <input type="hidden" name="id" value={c.id} />
                  <input name="description" placeholder="Việc cần làm" aria-label="Việc cần làm" className="field" />
                  <input type="date" name="dueOn" aria-label="Hạn" className="field" />
                </ActionForm>
              </details>
            )}
          </Card>

          <Card title="Phân tích và kế hoạch">
            <ActionForm action={updateCapaAction} submitLabel={canWrite ? "Lưu" : "Chỉ xem"} submitClassName={canWrite ? "btn btn-primary" : "hidden"}>
              <input type="hidden" name="id" value={c.id} />
              <fieldset disabled={!canWrite} className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="field-label">Tiêu đề</span>
                  <input name="title" defaultValue={c.title} className="field" />
                </label>
                <Area name="problem" label="Vấn đề" value={c.problem} />
                <label className="block">
                  <span className="field-label">Phương pháp tìm nguyên nhân</span>
                  <input name="rootCauseMethod" defaultValue={c.rootCauseMethod} placeholder="5 Why, xương cá…" className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Hạn hoàn thành</span>
                  <input type="date" name="dueOn" defaultValue={c.dueOn ?? ""} className="field" />
                </label>
                <Area name="rootCause" label="Nguyên nhân gốc" value={c.rootCause} />
                <Area name="actionPlan" label="Kế hoạch hành động" value={c.actionPlan} />
                <label className="block">
                  <span className="field-label">Tiêu chí hiệu quả</span>
                  <input name="effectivenessCriteria" defaultValue={c.effectivenessCriteria} className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Ngày kiểm tra hiệu quả</span>
                  <input type="date" name="effectivenessCheckOn" defaultValue={c.effectivenessCheckOn ?? ""} className="field" />
                </label>
              </fieldset>
            </ActionForm>
          </Card>
        </div>

        <div className="space-y-6">
          {c.status === "verifying" && can(staff.role, "quality.write") && (
            <Card title="Đánh giá hiệu quả">
              <ActionForm action={capaEffectivenessAction} submitLabel="Ghi đánh giá">
                <input type="hidden" name="id" value={c.id} />
                <textarea name="result" rows={3} defaultValue={c.effectivenessResult} placeholder="Kết quả kiểm tra hiệu quả" aria-label="Kết quả" className="field" />
                <fieldset className="flex flex-wrap gap-4">
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="radio" name="effective" value="yes" defaultChecked={c.effective === true} className="accent-graphite" /> Có hiệu quả
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="radio" name="effective" value="no" defaultChecked={c.effective === false} className="accent-graphite" /> Chưa hiệu quả
                  </label>
                </fieldset>
              </ActionForm>
              {c.effective !== null && <p className="mt-3 text-sm">Đã ghi: {c.effective ? "có hiệu quả" : "chưa hiệu quả"}.</p>}
            </Card>
          )}

          {next.length > 0 && (
            <Card title="Chuyển trạng thái">
              <div className="space-y-3">
                {next.map((to) => (
                  <ActionForm
                    key={to}
                    action={transitionCapaAction}
                    submitLabel={to === "closed" ? "Đóng CAPA" : to === "cancelled" ? "Hủy CAPA" : `Chuyển sang ${CAPA_STATUS_LABEL[to]}`}
                    submitClassName={to === "cancelled" ? "btn btn-outline" : "btn btn-primary"}
                    confirm={to === "closed" ? "Đóng CAPA này?" : undefined}
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="from" value={c.status} />
                    <input type="hidden" name="to" value={to} />
                    {to === "cancelled" && <input name="reason" placeholder="Lý do hủy (bắt buộc)" aria-label="Lý do hủy" className="field" />}
                  </ActionForm>
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-soft">Chuyển sang kiểm tra hiệu quả khi mọi bước đã xong. Đóng khi đã ghi đánh giá có hiệu quả.</p>
            </Card>
          )}

          <Card title="Liên kết">
            <ul className="space-y-1 text-sm">
              {d.ncr && (
                <li>
                  NCR{" "}
                  <Link href={`/admin/chat-luong/ncr/${d.ncr.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                    {d.ncr.code}
                  </Link>
                </li>
              )}
              {d.lot && (
                <li>
                  Lô{" "}
                  <Link href={`/admin/lo/${d.lot.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                    {d.lot.lotNo}
                  </Link>
                </li>
              )}
              {d.complaint && (
                <li>
                  <Link href="/admin/phan-anh" className="inline-flex min-h-11 items-center underline underline-offset-4">
                    Phản ánh: {d.complaint.symptoms.slice(0, 80)}
                  </Link>
                </li>
              )}
              <li className="text-ink-soft">Tạo lúc {formatDateTime(c.createdAt)}</li>
              {c.dueOn && <li className={isOverdue(c.dueOn, today, done) ? "text-danger" : "text-ink-soft"}>Hạn {formatDate(c.dueOn)}</li>}
              {c.closedAt && <li className="text-ink-soft">Đóng lúc {formatDateTime(c.closedAt)}</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function Area({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="block sm:col-span-2">
      <span className="field-label">{label}</span>
      <textarea name={name} rows={2} defaultValue={value} className="field" />
    </label>
  );
}
