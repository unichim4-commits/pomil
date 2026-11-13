import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDate, formatDateTime, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getRunDetail } from "@/modules/production/extraction";
import { EXTRACTION_METHOD_LABEL, EXTRACTION_STATUS_LABEL, formatMilli, formatRecovery, KIND_LABEL } from "@/modules/production/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader } from "../../../_components/ui";
import { TapLink } from "../../../kho/_components/data-list";
import { completeRunAction, issuePeelAction, runOpAction, updateRunCostsAction } from "../../actions";
import { Field } from "../../_components/fields";
import { itemOptions } from "../../_lib/data";
import { QC_LABEL, QC_TONE, qty, RUN_TONE } from "../../_lib/view";

export const metadata: Metadata = { title: "Mẻ chiết" };

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, staff] = await Promise.all([params, requireStaff()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const d = await getRunDetail(db, id);
  if (!d) notFound();
  const { run: r } = d;
  const canWrite = can(staff.role, "production.write");
  const showMoney = can(staff.role, "finance.view");
  const open = r.status === "draft" || r.status === "in_progress";
  const peelItems = canWrite && open ? await itemOptions(db, ["raw_material"]) : [];
  const outUnit = d.output?.baseUom === "mg" ? "kg" : "l";

  return (
    <>
      <PageHeader
        title={`Mẻ chiết ${r.code}`}
        description={`${EXTRACTION_METHOD_LABEL[r.method]} · ${KIND_LABEL[r.kind]}${d.service ? ` · ${d.service.name}` : ""}`}
        actions={<Badge tone={RUN_TONE[r.status]}>{EXTRACTION_STATUS_LABEL[r.status]}</Badge>}
      />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card title="Thông tin mẻ">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-soft">Đầu ra</dt>
              <dd>{d.output ? `${d.output.code} · ${d.output.name}` : "—"}</dd>
              <dt className="text-ink-soft">Giống bưởi</dt>
              <dd>{r.pomeloVariety || "—"}</dd>
              <dt className="text-ink-soft">Nguồn vỏ</dt>
              <dd>
                {d.source?.name ?? "—"}
                {r.harvestOn ? ` · thu hoạch ${formatDate(r.harvestOn)}` : ""}
              </dd>
              <dt className="text-ink-soft">Tình trạng vỏ</dt>
              <dd>{r.peelCondition || "—"}</dd>
              <dt className="text-ink-soft">Thiết bị</dt>
              <dd>
                {r.equipment || "—"}
                {r.operatorName ? ` · ${r.operatorName}` : ""}
              </dd>
              <dt className="text-ink-soft">Thời gian</dt>
              <dd>
                {r.startedAt ? formatDateTime(r.startedAt) : "—"} → {r.endedAt ? formatDateTime(r.endedAt) : "—"}
              </dd>
              {r.outputQty ? (
                <>
                  <dt className="text-ink-soft">Lượng thu</dt>
                  <dd className="tabular-nums">{qty(r.outputQty, d.output?.baseUom, d.output?.displayUom)}</dd>
                </>
              ) : null}
              <dt className="text-ink-soft">Hiệu suất thu hồi</dt>
              <dd>{formatRecovery(d.recovery)}</dd>
              {d.lot && (
                <>
                  <dt className="text-ink-soft">Lô nhập kho</dt>
                  <dd>
                    <TapLink href={`/admin/kho/lo/${d.lot.id}`} className="font-mono">
                      {d.lot.code}
                    </TapLink>
                  </dd>
                </>
              )}
              {d.ipqc.length > 0 && (
                <>
                  <dt className="text-ink-soft">IPQC</dt>
                  <dd className="flex flex-wrap gap-2">
                    {d.ipqc.map((q) => (
                      <Link key={q.id} href={`/admin/chat-luong/phieu-kiem/${q.id}`} className="inline-flex min-h-11 items-center gap-2 font-mono">
                        {q.code} <Badge tone={QC_TONE[q.status] ?? "neutral"}>{QC_LABEL[q.status] ?? q.status}</Badge>
                      </Link>
                    ))}
                  </dd>
                </>
              )}
              {r.note && (
                <>
                  <dt className="text-ink-soft">Ghi chú</dt>
                  <dd>{r.note}</dd>
                </>
              )}
            </dl>
            {r.params.length > 0 && (
              <>
                <h3 className="eyebrow mb-2 mt-5 text-[0.65rem]">Thông số</h3>
                <ul className="text-sm">
                  {r.params.map((p, i) => (
                    <li key={i}>
                      {p.name}: <span className="tabular-nums">{formatMilli(p.valueMilli)}</span> {p.unit}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card title="Vỏ đã xuất">
            {d.peel.lots.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa xuất vỏ.</p>
            ) : (
              <ul className="divide-y divide-line border border-line text-sm">
                {d.peel.lots.map((l) => (
                  <li key={l.stockLotId} className="flex justify-between gap-2 px-3 py-2">
                    <span className="font-mono">{l.code}</span>
                    <span className="tabular-nums">
                      {qty(l.net, l.baseUom)}
                      {showMoney && <span className="ml-2 text-ink-soft">{formatVnd(l.value)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && open && (
              <ActionForm action={issuePeelAction} submitLabel="Xuất vỏ" resetOnSuccess className="mt-4 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={r.id} />
                <Field label="Hàng">
                  <select name="itemId" required className="field min-h-11" defaultValue="">
                    <option value="" disabled>
                      Chọn vỏ bưởi
                    </option>
                    {peelItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} · {it.name} ({it.displayUom})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Lượng">
                  <input name="qty" required inputMode="decimal" className="field min-h-11 w-28" />
                </Field>
              </ActionForm>
            )}
          </Card>

          {canWrite && r.status === "in_progress" && (
            <Card title="Hoàn thành mẻ">
              <ActionForm action={completeRunAction} submitLabel="Hoàn thành, nhập kho" confirm="Nhập lượng thu vào kho chiết xuất ở trạng thái chờ IPQC?" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={r.id} />
                <Field label="Lượng thu">
                  <input name="outputQty" required inputMode="decimal" className="field min-h-11 w-32" />
                </Field>
                <Field label="Đơn vị">
                  <select name="unit" className="field min-h-11" defaultValue={outUnit === "kg" ? "g" : "ml"}>
                    {outUnit === "kg" ? (
                      <>
                        <option value="g">g</option>
                        <option value="kg">kg</option>
                      </>
                    ) : (
                      <>
                        <option value="ml">ml</option>
                        <option value="l">lít</option>
                      </>
                    )}
                  </select>
                </Field>
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {showMoney && (
            <Card title="Giá thành mẻ">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
                <dt className="text-ink-soft">Vỏ bưởi</dt>
                <dd>{formatVnd(d.peel.cost)}</dd>
                <dt className="text-ink-soft">Phí thuê lò</dt>
                <dd>{formatVnd(r.serviceFee)}</dd>
                <dt className="text-ink-soft">Khác</dt>
                <dd>{formatVnd(r.otherCost)}</dd>
                <dt className="border-t border-line pt-1">Tổng</dt>
                <dd className="border-t border-line pt-1">{formatVnd(r.status === "completed" ? r.totalCost : d.peel.cost + r.serviceFee + r.otherCost)}</dd>
              </dl>
              {d.payable && (
                <p className="mt-3 text-sm">
                  Công nợ:{" "}
                  <TapLink href={`/admin/tai-chinh/cong-no/phai-tra/${d.payable.id}`}>
                    {formatVnd(d.payable.amount)} (đã trả {formatVnd(d.payable.paidAmount)})
                  </TapLink>
                </p>
              )}
              {canWrite && r.status !== "cancelled" && (
                <ActionForm action={updateRunCostsAction} submitLabel="Lưu chi phí" className="mt-4 space-y-3 border-t border-line pt-4">
                  <input type="hidden" name="id" value={r.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Phí thuê lò">
                      <input name="serviceFee" inputMode="numeric" className="field min-h-11" defaultValue={r.serviceFee} />
                    </Field>
                    <Field label="Khác">
                      <input name="otherCost" inputMode="numeric" className="field min-h-11" defaultValue={r.otherCost} />
                    </Field>
                  </div>
                  <Field label="Lý do">
                    <input name="reason" className="field min-h-11" />
                  </Field>
                </ActionForm>
              )}
            </Card>
          )}

          {canWrite && open && (
            <Card title="Thao tác">
              <div className="space-y-4">
                {r.status === "draft" && (
                  <ActionForm action={runOpAction} submitLabel="Bắt đầu mẻ" submitClassName="btn btn-primary min-h-11" inline>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="op" value="start" />
                  </ActionForm>
                )}
                <ActionForm action={runOpAction} submitLabel="Hủy mẻ" submitClassName="btn btn-outline min-h-11 text-danger" confirm="Hủy mẻ này? Vỏ đã xuất tính hao hụt.">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="op" value="cancel" />
                  <Field label="Lý do hủy">
                    <input name="reason" required className="field min-h-11" />
                  </Field>
                </ActionForm>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
