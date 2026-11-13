import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { compareVersions, getFormulaDetail } from "@/modules/production/formulas";
import { canChangeVersionStatus, checkFormulaTotals, effectivePpm, formatBp, formatPercent, VERSION_STATUS_LABEL, type FormulaVersionStatus } from "@/modules/production/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader } from "../../../_components/ui";
import { TapLink } from "../../../kho/_components/data-list";
import {
  changeVersionStatusAction,
  createNextVersionAction,
  removeFormulaLineAction,
  removePackagingAction,
  saveFormulaLineAction,
  savePackagingAction,
  saveVersionParamsAction,
} from "../../actions";
import { Field, VersionParamFields } from "../../_components/fields";
import { actorOf, itemOptions } from "../../_lib/data";
import { qty, VERSION_TONE } from "../../_lib/view";

export const metadata: Metadata = { title: "Công thức" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function FormulaDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tu?: string; den?: string }> }) {
  const [{ id }, sp, staff] = await Promise.all([params, searchParams, requireStaff()]);
  if (!can(staff.role, "formulas.view") || !UUID.test(id)) notFound();
  const db = await getDb();
  const actor = actorOf(staff);
  const detail = await getFormulaDetail(db, actor, id);
  if (!detail) notFound();
  const { formula, versions } = detail;
  const canWrite = can(staff.role, "formulas.write");
  const [lineItems, packItems] = canWrite ? await Promise.all([itemOptions(db, ["raw_material", "extract", "wip"]), itemOptions(db, ["packaging"])]) : [[], []];

  let compare: Awaited<ReturnType<typeof compareVersions>> | null = null;
  let compareError: string | null = null;
  if (sp.tu && sp.den && UUID.test(sp.tu) && UUID.test(sp.den)) {
    try {
      compare = await compareVersions(db, actor, sp.tu, sp.den);
    } catch (e) {
      compareError = e instanceof Error ? e.message : "Không so sánh được";
    }
  }

  return (
    <>
      <PageHeader title={formula.name} description={`${formula.code}${formula.productName ? ` · ${formula.productName}` : ""}${formula.note ? ` · ${formula.note}` : ""}`} />

      {versions.length > 1 && (
        <Card title="So sánh phiên bản" className="mb-6">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <Field label="Từ">
              <select name="tu" className="field min-h-11" defaultValue={sp.tu ?? versions[1]!.id}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Đến">
              <select name="den" className="field min-h-11" defaultValue={sp.den ?? versions[0]!.id}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn btn-outline min-h-11">So sánh</button>
          </form>
          {compareError && <p className="mt-3 text-sm text-danger">{compareError}</p>}
          {compare && (
            <div className="mt-4 text-sm">
              <p className="text-ink-soft">
                {compare.from} → {compare.to}
                {compare.changeNote ? ` · ${compare.changeNote}` : ""}
              </p>
              {compare.changes.length === 0 ? (
                <p className="mt-2">Không có khác biệt.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {compare.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="space-y-6">
        {versions.map((v) => {
          const draft = v.status === "draft";
          const editable = canWrite && draft;
          const totals = checkFormulaTotals(v.lines.map((l) => ({ itemId: l.itemId, itemCode: l.itemCode, ppm: l.ppm, isBalance: l.isBalance, sort: l.sort })));
          const eff = totals.ok ? effectivePpm(v.lines.map((l) => ({ itemId: l.itemId, ppm: l.ppm, isBalance: l.isBalance, sort: l.sort }))) : null;
          const nextStatuses = (["trial", "approved", "archived"] as FormulaVersionStatus[]).filter((s) => canChangeVersionStatus(v.status, s));
          return (
            <Card
              key={v.id}
              title={`${v.label}`}
              actions={<Badge tone={VERSION_TONE[v.status]}>{VERSION_STATUS_LABEL[v.status]}</Badge>}
            >
              <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <p>
                  <span className="text-ink-soft">Cỡ mẻ: </span>
                  {qty(v.batchSize, v.batchUom)}
                </p>
                <p>
                  <span className="text-ink-soft">Hiệu suất dự kiến: </span>
                  {formatBp(v.expectedYieldBp)}
                </p>
                <p>
                  <span className="text-ink-soft">Khối lượng riêng: </span>
                  {v.bulkDensityMgPerMl ? `${v.bulkDensityMgPerMl.toLocaleString("vi-VN")} mg/ml` : "—"}
                </p>
                <p>
                  <span className="text-ink-soft">Tạo: </span>
                  {formatDate(v.createdAt)}
                  {v.approvedAt ? ` · duyệt ${formatDate(v.approvedAt)}` : ""}
                </p>
              </div>
              {v.changeNote && <p className="mb-3 text-sm">Thay đổi: {v.changeNote}</p>}
              {v.processNote && <p className="mb-4 whitespace-pre-line text-sm text-ink-soft">{v.processNote}</p>}

              <h3 className="eyebrow mb-2 text-[0.65rem]">Nguyên liệu</h3>
              {!totals.ok && <p className="mb-2 text-sm text-danger">{totals.message}</p>}
              {v.lines.length === 0 ? (
                <p className="text-sm text-ink-soft">Chưa có dòng.</p>
              ) : (
                <ul className="divide-y divide-line border border-line text-sm">
                  {v.lines.map((l, i) => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        <span className="font-mono">{l.itemCode}</span> {l.itemName}
                        {l.phase && <span className="ml-2 text-ink-soft">pha {l.phase}</span>}
                        {l.note && <span className="ml-2 text-ink-soft">· {l.note}</span>}
                      </span>
                      <span className="flex items-center gap-3 tabular-nums">
                        {l.isBalance ? `${eff ? formatPercent(eff[i]!) : "?"} (phần còn lại)` : formatPercent(l.ppm)}
                        {editable && (
                          <ActionForm action={removeFormulaLineAction} submitLabel="Bỏ" pendingLabel="…" inline submitClassName="btn btn-outline min-h-11" confirm={`Bỏ ${l.itemCode} khỏi ${v.label}?`}>
                            <input type="hidden" name="id" value={l.id} />
                          </ActionForm>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="eyebrow mb-2 mt-5 text-[0.65rem]">Bao bì mỗi chai</h3>
              {v.packaging.length === 0 ? (
                <p className="text-sm text-ink-soft">Chưa có định mức bao bì.</p>
              ) : (
                <ul className="divide-y divide-line border border-line text-sm">
                  {v.packaging.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        <span className="font-mono">{p.itemCode}</span> {p.itemName}
                      </span>
                      <span className="flex items-center gap-3 tabular-nums">
                        {qty(p.qtyPerUnit, p.baseUom, p.displayUom)}
                        {editable && (
                          <ActionForm action={removePackagingAction} submitLabel="Bỏ" pendingLabel="…" inline submitClassName="btn btn-outline min-h-11">
                            <input type="hidden" name="id" value={p.id} />
                          </ActionForm>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {editable && (
                <div className="mt-6 grid gap-6 lg:grid-cols-3">
                  <div>
                    <h3 className="eyebrow mb-2 text-[0.65rem]">Thêm / sửa dòng nguyên liệu</h3>
                    <ActionForm action={saveFormulaLineAction} submitLabel="Lưu dòng" resetOnSuccess>
                      <input type="hidden" name="versionId" value={v.id} />
                      <Field label="Hàng">
                        <select name="itemId" required className="field min-h-11" defaultValue="">
                          <option value="" disabled>
                            Chọn hàng
                          </option>
                          {lineItems.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.code} · {it.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Tỷ lệ (%)">
                          <input name="percent" inputMode="decimal" className="field min-h-11" placeholder="15" />
                        </Field>
                        <Field label="Pha">
                          <input name="phase" className="field min-h-11" placeholder="A" />
                        </Field>
                      </div>
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <input type="checkbox" name="isBalance" className="h-5 w-5" /> Dòng bù (phần còn lại, thường là nước)
                      </label>
                      <Field label="Ghi chú">
                        <input name="note" className="field min-h-11" />
                      </Field>
                    </ActionForm>
                  </div>
                  <div>
                    <h3 className="eyebrow mb-2 text-[0.65rem]">Định mức bao bì</h3>
                    <ActionForm action={savePackagingAction} submitLabel="Lưu bao bì" resetOnSuccess>
                      <input type="hidden" name="versionId" value={v.id} />
                      <Field label="Bao bì">
                        <select name="itemId" required className="field min-h-11" defaultValue="">
                          <option value="" disabled>
                            Chọn bao bì
                          </option>
                          {packItems.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.code} · {it.name} ({it.displayUom})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Số lượng mỗi chai">
                        <input name="qty" inputMode="decimal" className="field min-h-11" defaultValue="1" />
                      </Field>
                    </ActionForm>
                  </div>
                  <div>
                    <h3 className="eyebrow mb-2 text-[0.65rem]">Thông số mẻ</h3>
                    <ActionForm action={saveVersionParamsAction} submitLabel="Lưu thông số">
                      <input type="hidden" name="versionId" value={v.id} />
                      <VersionParamFields v={v} />
                    </ActionForm>
                  </div>
                </div>
              )}

              {canWrite && (
                <div className="mt-6 flex flex-wrap items-start gap-4 border-t border-line pt-4">
                  {nextStatuses.map((s) => (
                    <ActionForm
                      key={s}
                      action={changeVersionStatusAction}
                      submitLabel={s === "approved" ? "Duyệt phiên bản" : s === "trial" ? "Chuyển dùng thử" : "Lưu trữ"}
                      submitClassName={s === "approved" ? "btn btn-primary min-h-11" : "btn btn-outline min-h-11"}
                      confirm={s === "approved" ? `Duyệt ${v.label}? Bản đang duyệt khác của công thức sẽ chuyển sang lưu trữ.` : undefined}
                      inline
                    >
                      <input type="hidden" name="versionId" value={v.id} />
                      <input type="hidden" name="to" value={s} />
                    </ActionForm>
                  ))}
                  {!draft && v.status !== "archived" && (
                    <ActionForm action={createNextVersionAction} submitLabel="Tạo phiên bản mới từ bản này" submitClassName="btn btn-outline min-h-11" className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="versionId" value={v.id} />
                      <Field label="Lý do thay đổi">
                        <input name="changeNote" required className="field min-h-11" placeholder="Giảm tinh dầu còn 12%" />
                      </Field>
                    </ActionForm>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {formula.productId && (
        <p className="mt-6 text-sm">
          <TapLink href={`/admin/san-pham/${formula.productId}`}>Xem sản phẩm {formula.productCode}</TapLink>
        </p>
      )}
    </>
  );
}
