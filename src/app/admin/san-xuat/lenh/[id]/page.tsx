import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDate, formatDateTime, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listUsableVersions } from "@/modules/production/formulas";
import { getOrderDetail, issuableLots } from "@/modules/production/orders";
import { cancelPermission, costVariance, formatBp, KIND_LABEL, ORDER_STATUS_LABEL, type ProductionStatus } from "@/modules/production/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader } from "../../../_components/ui";
import { TapLink } from "../../../kho/_components/data-list";
import {
  addMaterialAction,
  addStepAction,
  cancelOrderAction,
  issueMaterialAction,
  moveOrderAction,
  recordOutputAction,
  removeMaterialAction,
  returnMaterialAction,
  setCostLockAction,
  setMaterialSourceAction,
  stepAction,
  updateOrderAction,
  updateOrderCostsAction,
} from "../../actions";
import { Field } from "../../_components/fields";
import { OrderFields } from "../../_components/order-fields";
import { itemOptions, productOptions, supplierOptions } from "../../_lib/data";
import { ORDER_TONE, QC_LABEL, QC_TONE, qty, qtyInput, vnToday } from "../../_lib/view";

export const metadata: Metadata = { title: "Lệnh sản xuất" };

const ROLE_LABEL: Record<string, string> = { formula: "Công thức", packaging: "Bao bì", extra: "Thêm" };
const STEP_LABEL = { pending: "Chưa làm", in_progress: "Đang làm", done: "Xong", skipped: "Bỏ qua" } as const;
const STEP_TONE = { pending: "neutral", in_progress: "amber", done: "green", skipped: "neutral" } as const;

// Nút chuyển trạng thái theo trạng thái hiện tại
const NEXT: Partial<Record<ProductionStatus, { to: string; label: string; approve?: boolean; primary?: boolean }[]>> = {
  draft: [{ to: "planned", label: "Lên kế hoạch (sinh định mức)", primary: true }],
  planned: [
    { to: "approved", label: "Duyệt lệnh", approve: true, primary: true },
    { to: "draft", label: "Đưa về nháp" },
  ],
  approved: [{ to: "in_progress", label: "Bắt đầu sản xuất", primary: true }],
  qc: [{ to: "completed", label: "Hoàn thành lệnh", primary: true }],
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, staff] = await Promise.all([params, requireStaff()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const d = await getOrderDetail(db, id);
  if (!d) notFound();
  const { order: o } = d;
  const role = staff.role;
  const canWrite = can(role, "production.write");
  const showMoney = can(role, "finance.view");
  const canFormula = can(role, "formulas.view");
  const editable = canWrite && (o.status === "draft" || o.status === "planned");
  const issuing = canWrite && (o.status === "approved" || o.status === "in_progress");
  const locked = !!o.costLockedAt;

  const [products, versions, factories, extraItems] = editable
    ? await Promise.all([productOptions(db), listUsableVersions(db), supplierOptions(db, ["factory"]), itemOptions(db, ["raw_material", "extract", "packaging", "wip"])])
    : [[], [], [], []];
  const lotsByItem = new Map<string, Awaited<ReturnType<typeof issuableLots>>>();
  if (issuing) for (const m of d.materials.filter((x) => x.suppliedBy === "pomil")) lotsByItem.set(m.itemId, await issuableLots(db, m.itemId));

  const cancel = cancelPermission(o.status);
  const canCancel = canWrite && typeof cancel === "string" && can(role, cancel);
  const variance = o.plannedCost !== null && o.goodUnits ? costVariance({ totalCost: o.totalCost, goodUnits: o.goodUnits, plannedCost: o.plannedCost, plannedUnits: o.plannedUnits }) : null;
  const itemMeta = new Map(d.materials.map((m) => [m.itemId, m]));

  return (
    <>
      <PageHeader
        title={`Lệnh ${o.code}`}
        description={`${KIND_LABEL[o.kind]} · ${d.product?.name ?? ""}${d.supplier ? ` · ${d.supplier.name}` : ""}`}
        actions={<Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>}
      />

      {d.blocked && (
        <p className="mb-6 border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Tạm dừng do sai lệch IPQC:{" "}
          {d.blockingInspections.map((q) => (
            <Link key={q.id} href={`/admin/chat-luong/phieu-kiem/${q.id}`} className="mr-2 underline">
              {q.code}
            </Link>
          ))}
          . Xử lý phiếu trước khi làm tiếp.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card title="Thông tin lệnh">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-soft">Sản phẩm</dt>
              <dd>
                {d.product ? <TapLink href={`/admin/san-pham/${d.product.id}`}>{`${d.product.name} (${d.product.code})`}</TapLink> : "—"}
              </dd>
              <dt className="text-ink-soft">Công thức</dt>
              <dd>
                {d.version ? (
                  canFormula ? (
                    <TapLink href={`/admin/san-xuat/cong-thuc/${d.version.formulaId}`}>{d.version.label}</TapLink>
                  ) : (
                    d.version.label
                  )
                ) : (
                  (o.formulaLabel ?? "—")
                )}
              </dd>
              <dt className="text-ink-soft">Số chai kế hoạch</dt>
              <dd className="tabular-nums">
                {o.plannedUnits.toLocaleString("vi-VN")}
                {o.plannedBulk ? ` · bán thành phẩm ${qty(o.plannedBulk, d.version?.batchUom ?? null)} · ${o.batchCount ?? 1} mẻ` : ""}
              </dd>
              <dt className="text-ink-soft">Lịch</dt>
              <dd>
                {o.plannedStart ? formatDate(o.plannedStart) : "—"} → {o.plannedEnd ? formatDate(o.plannedEnd) : "—"}
                {o.startedAt ? ` · bắt đầu ${formatDateTime(o.startedAt)}` : ""}
                {o.finishedAt ? ` · xong ${formatDateTime(o.finishedAt)}` : ""}
              </dd>
              {o.goodUnits !== null && (
                <>
                  <dt className="text-ink-soft">Sản lượng</dt>
                  <dd className="tabular-nums">
                    {o.goodUnits.toLocaleString("vi-VN")} chai đạt · {o.rejectedUnits.toLocaleString("vi-VN")} chai lỗi
                  </dd>
                </>
              )}
              {d.lot && (
                <>
                  <dt className="text-ink-soft">Lô</dt>
                  <dd>
                    <TapLink href={`/admin/lo/${d.lot.id}`} className="font-mono">
                      {d.lot.lotNo}
                    </TapLink>{" "}
                    · HSD {formatDate(d.lot.expiresOn)}
                  </dd>
                </>
              )}
              {d.fqc && (
                <>
                  <dt className="text-ink-soft">FQC</dt>
                  <dd>
                    <TapLink href={`/admin/chat-luong/phieu-kiem/${d.fqc.id}`} className="gap-2 font-mono">
                      {d.fqc.code} <Badge tone={QC_TONE[d.fqc.status] ?? "neutral"}>{QC_LABEL[d.fqc.status] ?? d.fqc.status}</Badge>
                    </TapLink>
                  </dd>
                </>
              )}
              {o.cancelReason && (
                <>
                  <dt className="text-ink-soft">Lý do hủy</dt>
                  <dd>{o.cancelReason}</dd>
                </>
              )}
              {o.note && (
                <>
                  <dt className="text-ink-soft">Ghi chú</dt>
                  <dd>{o.note}</dd>
                </>
              )}
            </dl>
            {canWrite && (
              <div className="mt-5 flex flex-wrap items-start gap-3 border-t border-line pt-4">
                {(NEXT[o.status] ?? [])
                  .filter((n) => !n.approve || can(role, "production.approve"))
                  .map((n) => (
                    <ActionForm key={n.to} action={moveOrderAction} submitLabel={n.label} submitClassName={n.primary ? "btn btn-primary min-h-11" : "btn btn-outline min-h-11"} inline>
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="to" value={n.to} />
                    </ActionForm>
                  ))}
                {o.status === "planned" && !can(role, "production.approve") && <p className="text-sm text-ink-soft">Chờ người có quyền duyệt lệnh.</p>}
              </div>
            )}
          </Card>

          <Card title="Định mức vật tư">
            {d.materials.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa có định mức. Lên kế hoạch để sinh từ công thức.</p>
            ) : (
              <ul className="divide-y divide-line border border-line text-sm">
                {d.materials.map((m) => {
                  const lots = lotsByItem.get(m.itemId) ?? [];
                  return (
                    <li key={m.id} className="space-y-2 px-3 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          <span className="font-mono">{m.itemCode}</span> {m.itemName}{" "}
                          <span className="text-ink-soft">
                            · {ROLE_LABEL[m.role]} · {m.suppliedBy === "pomil" ? "Pomil cấp" : "Nhà máy cấp"}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {qty(m.netIssued, m.baseUom, m.displayUom)} / {qty(m.plannedQty, m.baseUom, m.displayUom)}
                        </span>
                      </div>
                      {editable && (
                        <div className="flex flex-wrap gap-2">
                          {o.kind === "outsourced" && (
                            <ActionForm action={setMaterialSourceAction} submitLabel={m.suppliedBy === "pomil" ? "Chuyển: nhà máy cấp" : "Chuyển: Pomil cấp"} submitClassName="btn btn-outline min-h-11" inline>
                              <input type="hidden" name="id" value={m.id} />
                              <input type="hidden" name="source" value={m.suppliedBy === "pomil" ? "factory" : "pomil"} />
                            </ActionForm>
                          )}
                          {m.role === "extra" && (
                            <ActionForm action={removeMaterialAction} submitLabel="Bỏ dòng" submitClassName="btn btn-outline min-h-11" inline>
                              <input type="hidden" name="id" value={m.id} />
                            </ActionForm>
                          )}
                        </div>
                      )}
                      {issuing && m.suppliedBy === "pomil" && (
                        <ActionForm action={issueMaterialAction} submitLabel="Xuất kho" submitClassName="btn btn-outline min-h-11" resetOnSuccess className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={o.id} />
                          <input type="hidden" name="itemId" value={m.itemId} />
                          <Field label={`Lượng (${m.displayUom})`}>
                            <input name="qty" required inputMode="decimal" className="field min-h-11 w-32" defaultValue={m.plannedQty > m.netIssued ? qtyInput(m.plannedQty - m.netIssued, m.displayUom) : ""} />
                          </Field>
                          <Field label="Lô">
                            <select name="stockLotId" className="field min-h-11" defaultValue="">
                              <option value="">Tự chọn (hết hạn trước)</option>
                              {lots.map((l) => (
                                <option key={l.stockLotId} value={l.stockLotId}>
                                  {l.code} · {l.warehouseCode} · còn {qty(Number(l.qty), m.baseUom, m.displayUom)}
                                  {l.expiresOn ? ` · HSD ${formatDate(l.expiresOn)}` : ""}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Lý do (khi xuất vượt)">
                            <input name="reason" className="field min-h-11" />
                          </Field>
                        </ActionForm>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {editable && (
              <ActionForm action={addMaterialAction} submitLabel="Thêm vật tư" resetOnSuccess className="mt-4 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={o.id} />
                <Field label="Hàng">
                  <select name="itemId" required className="field min-h-11" defaultValue="">
                    <option value="" disabled>
                      Chọn hàng
                    </option>
                    {extraItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} · {it.name} ({it.displayUom})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Lượng">
                  <input name="qty" inputMode="decimal" className="field min-h-11 w-28" />
                </Field>
                <Field label="Ghi chú">
                  <input name="note" className="field min-h-11" />
                </Field>
              </ActionForm>
            )}
          </Card>

          {d.lotsIssued.length > 0 && (
            <Card title="Lô đã xuất">
              <ul className="divide-y divide-line border border-line text-sm">
                {d.lotsIssued.map((l) => {
                  const meta = itemMeta.get(l.itemId);
                  return (
                    <li key={l.stockLotId} className="flex flex-wrap items-end justify-between gap-2 px-3 py-2">
                      <span>
                        <span className="font-mono">{l.lotCode}</span> {meta?.itemCode}
                        <span className="ml-2 tabular-nums">{qty(l.net, meta?.baseUom, meta?.displayUom)}</span>
                        {showMoney && <span className="ml-2 text-ink-soft">{formatVnd(l.value)}</span>}
                      </span>
                      {canWrite && l.net > 0 && (
                        <ActionForm action={returnMaterialAction} submitLabel="Trả về kho" submitClassName="btn btn-outline min-h-11" resetOnSuccess className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={o.id} />
                          <input type="hidden" name="stockLotId" value={l.stockLotId} />
                          <Field label={`Lượng trả (${meta?.displayUom ?? ""})`}>
                            <input name="qty" required inputMode="decimal" className="field min-h-11 w-28" />
                          </Field>
                        </ActionForm>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card title="Công đoạn">
            {d.steps.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa có công đoạn.</p>
            ) : (
              <ol className="divide-y divide-line border border-line text-sm">
                {d.steps.map((s) => (
                  <li key={s.id} className="space-y-2 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {s.seq}. {s.name}
                        {s.needsQc && <span className="ml-2 text-ink-soft">· cần IPQC</span>}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        {s.ipqc && (
                          <Link href={`/admin/chat-luong/phieu-kiem/${s.ipqc.id}`} className="inline-flex min-h-11 items-center gap-2 font-mono">
                            {s.ipqc.code} <Badge tone={QC_TONE[s.ipqc.status] ?? "neutral"}>{QC_LABEL[s.ipqc.status] ?? s.ipqc.status}</Badge>
                          </Link>
                        )}
                        <Badge tone={STEP_TONE[s.status]}>{STEP_LABEL[s.status]}</Badge>
                      </span>
                    </div>
                    {s.note && <p className="text-ink-soft">{s.note}</p>}
                    {canWrite && (
                      <div className="flex flex-wrap items-end gap-2">
                        {s.status === "pending" && issuing && (
                          <StepButton stepId={s.id} op="start" label="Bắt đầu" primary />
                        )}
                        {s.status === "in_progress" && s.needsQc && (!s.ipqc || s.ipqc.status === "failed") && <StepButton stepId={s.id} op="ipqc" label="Lập phiếu IPQC" />}
                        {s.status === "in_progress" && (
                          <ActionForm action={stepAction} submitLabel="Xong công đoạn" submitClassName="btn btn-primary min-h-11" className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="stepId" value={s.id} />
                            <input type="hidden" name="op" value="finish" />
                            <Field label="Ghi chú">
                              <input name="note" className="field min-h-11" />
                            </Field>
                          </ActionForm>
                        )}
                        {(s.status === "pending" || s.status === "in_progress") && issuing && (
                          <ActionForm action={stepAction} submitLabel="Bỏ qua" submitClassName="btn btn-outline min-h-11" className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="stepId" value={s.id} />
                            <input type="hidden" name="op" value="skip" />
                            <Field label="Lý do bỏ qua">
                              <input name="note" required className="field min-h-11" />
                            </Field>
                          </ActionForm>
                        )}
                        {editable && <StepButton stepId={s.id} op="remove" label="Bỏ công đoạn" />}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {editable && (
              <ActionForm action={addStepAction} submitLabel="Thêm công đoạn" resetOnSuccess className="mt-4 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={o.id} />
                <Field label="Tên công đoạn">
                  <input name="name" required className="field min-h-11" />
                </Field>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="needsQc" className="h-5 w-5" /> Cần IPQC
                </label>
              </ActionForm>
            )}
          </Card>

          {canWrite && o.status === "in_progress" && (
            <Card title="Ghi sản lượng">
              <ActionForm action={recordOutputAction} submitLabel="Ghi sản lượng" confirm="Ghi sản lượng sẽ nhập kho thành phẩm (cách ly) và lập phiếu FQC. Tiếp tục?">
                <input type="hidden" name="id" value={o.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Số chai đạt">
                    <input name="goodUnits" required inputMode="numeric" className="field min-h-11" />
                  </Field>
                  <Field label="Số chai lỗi">
                    <input name="rejectedUnits" inputMode="numeric" className="field min-h-11" defaultValue="0" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Ngày sản xuất">
                    <input type="date" name="manufacturedOn" className="field min-h-11" defaultValue={vnToday()} />
                  </Field>
                  <Field label="Hạn dùng" hint="Bỏ trống: tính theo hạn mặc định của hàng">
                    <input type="date" name="expiresOn" className="field min-h-11" />
                  </Field>
                </div>
                {o.kind === "in_house" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Bán thành phẩm thực tế">
                      <input name="actualBulk" inputMode="decimal" className="field min-h-11" />
                    </Field>
                    <Field label="Đơn vị">
                      <select name="bulkUnit" className="field min-h-11" defaultValue={d.version?.batchUom === "mg" ? "kg" : "l"}>
                        <option value="l">lít</option>
                        <option value="kg">kg</option>
                      </select>
                    </Field>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Số lô" hint="Bỏ trống để hệ thống đặt">
                    <input name="lotNo" className="field min-h-11 font-mono" />
                  </Field>
                  {showMoney && o.kind === "outsourced" && (
                    <Field label="Chi phí gia công (đ)" hint="Bỏ trống: đơn giá × số chai đạt">
                      <input name="outsourcingCost" inputMode="numeric" className="field min-h-11" />
                    </Field>
                  )}
                </div>
              </ActionForm>
            </Card>
          )}

          {editable && (
            <Card title="Sửa lệnh">
              <ActionForm action={updateOrderAction} submitLabel="Lưu lệnh">
                <input type="hidden" name="id" value={o.id} />
                <OrderFields
                  o={o}
                  products={products.map((p) => ({ id: p.id, label: `${p.name} (${p.code})` }))}
                  versions={versions.map((v) => ({ id: v.id, label: `${v.label}${v.status === "trial" ? " (thử)" : ""}` }))}
                  factories={factories.map((s) => ({ id: s.id, label: s.name }))}
                  showMoney={showMoney}
                />
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {showMoney && (
            <Card title="Giá thành" actions={locked ? <Badge tone="dark">Đã chốt</Badge> : undefined}>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
                <dt className="text-ink-soft">Nguyên liệu</dt>
                <dd>{formatVnd(o.materialCost)}</dd>
                <dt className="text-ink-soft">Bao bì</dt>
                <dd>{formatVnd(o.packagingCost)}</dd>
                <dt className="text-ink-soft">Nhân công</dt>
                <dd>{formatVnd(o.laborCost)}</dd>
                <dt className="text-ink-soft">Chi phí chung</dt>
                <dd>{formatVnd(o.overheadCost)}</dd>
                <dt className="text-ink-soft">Gia công</dt>
                <dd>{formatVnd(o.outsourcingCost)}</dd>
                <dt className="text-ink-soft">Khác</dt>
                <dd>{formatVnd(o.otherCost)}</dd>
                <dt className="border-t border-line pt-1">Tổng</dt>
                <dd className="border-t border-line pt-1">{formatVnd(o.totalCost)}</dd>
                {o.goodUnits ? (
                  <>
                    <dt className="text-ink-soft">Giá vốn mỗi chai</dt>
                    <dd>{formatVnd(Math.round(o.totalCost / o.goodUnits))}</dd>
                  </>
                ) : null}
                {o.plannedCost !== null && (
                  <>
                    <dt className="text-ink-soft">Kế hoạch lúc duyệt</dt>
                    <dd>{formatVnd(o.plannedCost)}</dd>
                  </>
                )}
                {variance && variance.unitDiff !== null && (
                  <>
                    <dt className="text-ink-soft">Chênh lệch mỗi chai</dt>
                    <dd className={variance.unitDiff > 0 ? "text-danger" : "text-ok"}>
                      {variance.unitDiff > 0 ? "+" : ""}
                      {formatVnd(variance.unitDiff)}
                      {variance.unitDiffBp !== null ? ` (${formatBp(variance.unitDiffBp)})` : ""}
                    </dd>
                  </>
                )}
              </dl>
              {d.payable && (
                <p className="mt-3 text-sm">
                  Công nợ nhà cung cấp:{" "}
                  <TapLink href={`/admin/tai-chinh/cong-no/phai-tra/${d.payable.id}`}>
                    {formatVnd(d.payable.amount)} (đã trả {formatVnd(d.payable.paidAmount)})
                  </TapLink>
                </p>
              )}

              {locked ? (
                <p className="mt-4 text-sm text-ink-soft">Giá vốn lệnh đã chốt ngày {formatDate(o.costLockedAt!)}. Mở chốt cần quyền duyệt tài chính và lý do.</p>
              ) : (
                canWrite &&
                o.status !== "cancelled" && (
                  <ActionForm action={updateOrderCostsAction} submitLabel="Lưu chi phí" className="mt-4 space-y-3 border-t border-line pt-4">
                    <input type="hidden" name="id" value={o.id} />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Nhân công">
                        <input name="laborCost" inputMode="numeric" className="field min-h-11" defaultValue={o.laborCost} />
                      </Field>
                      <Field label="Chi phí chung">
                        <input name="overheadCost" inputMode="numeric" className="field min-h-11" defaultValue={o.overheadCost} />
                      </Field>
                      <Field label="Khác">
                        <input name="otherCost" inputMode="numeric" className="field min-h-11" defaultValue={o.otherCost} />
                      </Field>
                      {o.kind === "outsourced" && (
                        <Field label="Gia công">
                          <input name="outsourcingCost" inputMode="numeric" className="field min-h-11" defaultValue={o.outsourcingCost} />
                        </Field>
                      )}
                    </div>
                    <Field label="Lý do (khi sửa sau khi đã ghi sản lượng)">
                      <input name="reason" className="field min-h-11" />
                    </Field>
                  </ActionForm>
                )
              )}

              {can(role, "finance.approve") && o.status === "completed" && (
                <ActionForm
                  action={setCostLockAction}
                  submitLabel={locked ? "Mở chốt giá vốn" : "Chốt giá vốn"}
                  submitClassName="btn btn-outline min-h-11"
                  className="mt-4 space-y-3 border-t border-line pt-4"
                  confirm={locked ? undefined : "Chốt giá vốn lệnh này? Sau khi chốt không sửa chi phí được."}
                >
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="lock" value={locked ? "0" : "1"} />
                  {locked && (
                    <Field label="Lý do mở chốt">
                      <input name="reason" required className="field min-h-11" />
                    </Field>
                  )}
                </ActionForm>
              )}
            </Card>
          )}

          {canCancel && (
            <Card title="Hủy lệnh">
              <ActionForm action={cancelOrderAction} submitLabel="Hủy lệnh" submitClassName="btn btn-outline min-h-11 text-danger" confirm="Hủy lệnh này? Vật tư đã xuất mà không trả về sẽ tính hao hụt.">
                <input type="hidden" name="id" value={o.id} />
                <Field label="Lý do">
                  <input name="reason" required className="field min-h-11" />
                </Field>
              </ActionForm>
            </Card>
          )}

          <Card title="Lịch sử">
            {d.timeline.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa có.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {d.timeline.map((t, i) => (
                  <li key={i}>
                    <span className="text-ink-soft">{formatDateTime(t.at)}</span> · <span className="font-mono">{t.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function StepButton({ stepId, op, label, primary }: { stepId: string; op: string; label: string; primary?: boolean }) {
  return (
    <ActionForm action={stepAction} submitLabel={label} submitClassName={primary ? "btn btn-primary min-h-11" : "btn btn-outline min-h-11"} inline>
      <input type="hidden" name="stepId" value={stepId} />
      <input type="hidden" name="op" value={op} />
    </ActionForm>
  );
}
