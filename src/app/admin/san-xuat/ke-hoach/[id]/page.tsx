import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listUsableVersions } from "@/modules/production/formulas";
import { getPlanDetail } from "@/modules/production/plans";
import { canChangePlanStatus, formatBp, formatHours, NO_HISTORY, ORDER_STATUS_LABEL, PLAN_STATUS_LABEL, type PlanStatus } from "@/modules/production/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader } from "../../../_components/ui";
import { DataList, TapLink } from "../../../kho/_components/data-list";
import { addPlanLineAction, createOrderFromPlanLineAction, removePlanLineAction, setPlanStatusAction } from "../../actions";
import { Field } from "../../_components/fields";
import { productOptions, supplierOptions } from "../../_lib/data";
import { ORDER_TONE, PLAN_TONE, qty } from "../../_lib/view";

export const metadata: Metadata = { title: "Kế hoạch sản xuất" };

const STATUS_BUTTON: Record<PlanStatus, string> = { draft: "Đưa về nháp", confirmed: "Xác nhận kế hoạch", closed: "Đóng kế hoạch", cancelled: "Hủy kế hoạch" };

export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, staff] = await Promise.all([params, requireStaff()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const detail = await getPlanDetail(db, id);
  if (!detail) notFound();
  const { plan, lines, need } = detail;
  const canWrite = can(staff.role, "production.write");
  const [products, versions, factories] = canWrite ? await Promise.all([productOptions(db), listUsableVersions(db), supplierOptions(db, ["factory"])]) : [[], [], []];
  const nextStatuses = (["confirmed", "closed", "cancelled"] as PlanStatus[]).filter((s) => canChangePlanStatus(plan.status, s));
  const shortCount = need.filter((n) => n.shortage > 0).length;

  return (
    <>
      <PageHeader
        title={`Kế hoạch ${plan.code}`}
        description={`${formatDate(plan.periodStart)} – ${formatDate(plan.periodEnd)}${plan.note ? ` · ${plan.note}` : ""}`}
        actions={<Badge tone={PLAN_TONE[plan.status]}>{PLAN_STATUS_LABEL[plan.status]}</Badge>}
      />

      <div className="space-y-6">
        <Card title="Sản phẩm cần làm">
          {lines.length === 0 ? (
            <p className="text-sm text-ink-soft">Chưa có dòng nào.</p>
          ) : (
            <ul className="space-y-4">
              {lines.map((l) => (
                <li key={l.id} className="border border-line p-4 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p>
                      {l.productName} <span className="font-mono text-ink-soft">{l.productCode}</span>
                    </p>
                    <p className="tabular-nums">{l.targetUnits.toLocaleString("vi-VN")} chai</p>
                  </div>
                  {l.error ? (
                    <p className="mt-1 text-danger">{l.error}</p>
                  ) : (
                    <p className="mt-1 text-ink-soft">
                      {l.versionLabel} · bán thành phẩm {qty(l.bulk, l.batchUom)} · {l.batches} mẻ · thời gian tự làm:{" "}
                      {l.estimate.inHouseHours === null ? NO_HISTORY : formatHours(l.estimate.inHouseHours)}
                    </p>
                  )}
                  <p className="mt-1">
                    Tiến độ: {l.progress.good.toLocaleString("vi-VN")} / {l.targetUnits.toLocaleString("vi-VN")} chai đạt ({formatBp(l.progress.pctBp)}) · đã ra lệnh{" "}
                    {l.progress.ordered.toLocaleString("vi-VN")} chai
                  </p>
                  {l.orders.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-2">
                      {l.orders.map((o) => (
                        <TapLink key={o.id} href={`/admin/san-xuat/lenh/${o.id}`} className="gap-2 font-mono">
                          {o.code} <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                        </TapLink>
                      ))}
                    </p>
                  )}
                  {canWrite && (plan.status === "draft" || plan.status === "confirmed") && (
                    <div className="mt-3 flex flex-wrap items-end gap-4">
                      <ActionForm action={createOrderFromPlanLineAction} submitLabel="Tạo lệnh từ dòng này" submitClassName="btn btn-outline min-h-11" className="flex flex-wrap items-end gap-3">
                        <input type="hidden" name="lineId" value={l.id} />
                        <Field label="Loại">
                          <select name="kind" className="field min-h-11" defaultValue="outsourced">
                            <option value="outsourced">Gia công</option>
                            <option value="in_house">Tự làm</option>
                          </select>
                        </Field>
                        <Field label="Nhà máy (gia công)">
                          <select name="supplierId" className="field min-h-11" defaultValue="">
                            <option value="">—</option>
                            {factories.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Đơn giá gia công (đ/chai)">
                          <input name="unitPrice" inputMode="numeric" className="field min-h-11 w-36" />
                        </Field>
                      </ActionForm>
                      {plan.status === "draft" && (
                        <ActionForm action={removePlanLineAction} submitLabel="Bỏ dòng" submitClassName="btn btn-outline min-h-11" inline confirm="Bỏ dòng này khỏi kế hoạch?">
                          <input type="hidden" name="id" value={l.id} />
                        </ActionForm>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canWrite && plan.status === "draft" && (
            <ActionForm action={addPlanLineAction} submitLabel="Thêm dòng" resetOnSuccess className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
              <input type="hidden" name="planId" value={plan.id} />
              <Field label="Sản phẩm">
                <select name="productId" required className="field min-h-11" defaultValue="">
                  <option value="" disabled>
                    Chọn sản phẩm
                  </option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Phiên bản công thức">
                <select name="formulaVersionId" className="field min-h-11" defaultValue="">
                  <option value="">Bản đã duyệt hiện hành</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                      {v.status === "trial" ? " (thử)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Số chai">
                <input name="targetUnits" required inputMode="numeric" className="field min-h-11" />
              </Field>
              <Field label="Ngày bắt đầu">
                <input type="date" name="plannedStart" className="field min-h-11" />
              </Field>
              <Field label="Ghi chú">
                <input name="note" className="field min-h-11" />
              </Field>
            </ActionForm>
          )}
        </Card>

        <Card title={shortCount ? `Nguyên vật liệu cần · thiếu ${shortCount} mã` : "Nguyên vật liệu cần"}>
          <DataList
            rows={need}
            rowKey={(n) => n.itemId}
            empty="Chưa tính được nhu cầu."
            cols={[
              {
                label: "Hàng",
                cell: (n) => (
                  <span>
                    <span className="font-mono">{n.itemCode}</span> {n.itemName}
                  </span>
                ),
              },
              { label: "Cần", cell: (n) => qty(n.need, n.baseUom, n.displayUom), className: "tabular-nums" },
              { label: "Khả dụng", cell: (n) => qty(n.available, n.baseUom, n.displayUom), className: "tabular-nums" },
              { label: "Lệnh khác giữ", cell: (n) => qty(n.committed, n.baseUom, n.displayUom), className: "tabular-nums" },
              {
                label: "Thiếu",
                cell: (n) => (n.shortage > 0 ? <span className="text-danger">{qty(n.shortage, n.baseUom, n.displayUom)}</span> : <span className="text-ok">Đủ</span>),
                className: "tabular-nums",
              },
            ]}
          />
        </Card>

        {canWrite && nextStatuses.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {nextStatuses.map((s) => (
              <ActionForm
                key={s}
                action={setPlanStatusAction}
                submitLabel={STATUS_BUTTON[s]}
                submitClassName={s === "confirmed" ? "btn btn-primary min-h-11" : "btn btn-outline min-h-11"}
                confirm={s === "cancelled" ? "Hủy kế hoạch này?" : undefined}
                inline
              >
                <input type="hidden" name="planId" value={plan.id} />
                <input type="hidden" name="to" value={s} />
              </ActionForm>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
