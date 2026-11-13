import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { formatQty, type BaseUom, type DisplayUom } from "@/modules/inventory/rules";
import { getInspectionDetail, INSPECTION_STATUS_LABEL, STAGE_DESCRIPTION, STAGE_LABEL } from "@/modules/qms/admin";
import {
  DISPOSITION_LABEL,
  formatLimits,
  formatMilli,
  NCR_STATUS_LABEL,
  PARAM_GROUP_LABEL,
  PARAM_KIND_LABEL,
  QMS_DISCLAIMER,
  VERDICT_LABEL,
  type Disposition,
  type InspectionStageKey,
} from "@/modules/qms/rules";
import { LOT_STATUS_LABEL, TEST_LABEL } from "@/modules/quality/admin";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, Table } from "../../../_components/ui";
import { addParamAction, cancelInspectionAction, decideInspectionAction, saveResultsAction } from "../../actions";

export const metadata: Metadata = { title: "Phiếu kiểm" };

const STATUS_TONE = { pending: "amber", passed: "green", failed: "red", cancelled: "neutral" } as const;
const VERDICT_TONE = { pass: "green", incomplete: "amber", review: "amber", fail: "red" } as const;
const RESULT = { pass: "Đạt", fail: "Không đạt", pending: "Đang chờ" } as const;
const QC_STATUS = { pending: "Chờ kiểm", released: "Dùng được", on_hold: "Đang khóa", rejected: "Không đạt" } as const;

const DISPOSITIONS: Record<InspectionStageKey, Disposition[]> = {
  iqc: ["accept", "use_as_is", "reject", "return_to_supplier"],
  ipqc: ["accept", "use_as_is", "reject"],
  fqc: ["accept", "reject"],
  recheck: ["accept", "reject"],
};

export default async function InspectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, d] = await Promise.all([requireStaff(), getInspectionDetail(id)]);
  if (!d) notFound();
  const insp = d.inspection;
  const pending = insp.status === "pending";
  const canWrite = can(staff.role, "quality.write") && pending;
  const canApprove = can(staff.role, "quality.approve") && pending;
  const fromLot = (insp.stage === "fqc" || insp.stage === "recheck") && !!insp.lotId;

  return (
    <>
      <Link href={`/admin/chat-luong/phieu-kiem?stage=${insp.stage}`} className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Phiếu {STAGE_LABEL[insp.stage]}
      </Link>
      <div className="mb-6 mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl">{insp.code}</h1>
        <Badge tone={STATUS_TONE[insp.status]}>{INSPECTION_STATUS_LABEL[insp.status]}</Badge>
        <span className="text-sm text-ink-soft">
          {STAGE_DESCRIPTION[insp.stage]}
          {d.standard ? ` · theo ${d.standard.code} v${d.standard.version} ${d.standard.name}` : " · không có tiêu chuẩn, thêm chỉ tiêu tự do"}
        </span>
      </div>
      <p className="mb-6 border border-line bg-pith/40 p-3 text-xs text-ink-soft">{QMS_DISCLAIMER}</p>
      {insp.stage === "iqc" && d.supplier && !d.supplier.qualified && (
        <p className="mb-6 border border-[#e2c98f] bg-[#f1e2c4]/60 p-3 text-sm text-[#6b4e12]" role="status">
          Nhà cung cấp chưa được đánh giá. Vẫn quyết định được, nên ghi rõ căn cứ trong ghi chú.
        </p>
      )}
      {insp.stage === "recheck" && <p className="mb-6 border border-line p-3 text-sm text-ink-soft">Kiểm lại mẫu lưu chỉ ghi nhận kết quả, không đổi trạng thái lô.</p>}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card title={`Chỉ tiêu · kết luận gợi ý: ${VERDICT_LABEL[d.verdict]}`} actions={<Badge tone={VERDICT_TONE[d.verdict]}>{VERDICT_LABEL[d.verdict]}</Badge>}>
            {d.results.length === 0 ? (
              <p className="text-sm text-ink-soft">Phiếu chưa có chỉ tiêu. Thêm chỉ tiêu tự do ở dưới.</p>
            ) : (
              <ActionForm action={saveResultsAction} submitLabel={canWrite ? "Lưu kết quả" : "Chỉ xem"} submitClassName={canWrite ? "btn btn-primary" : "hidden"}>
                <input type="hidden" name="id" value={insp.id} />
                <fieldset disabled={!canWrite} className="space-y-3">
                  {d.results.map((r) => {
                    const linked = fromLot && !!r.lotTestType;
                    const bad = r.livePassed === false;
                    return (
                      <div key={r.id} className={`grid gap-2 border p-3 sm:grid-cols-[1.4fr_1fr_1fr] sm:items-center ${bad ? "border-danger bg-danger/5" : "border-line"}`}>
                        <div className="text-sm">
                          <p>
                            {r.name}
                            {r.isCritical && <span className="ml-2 text-xs text-danger">trọng yếu</span>}
                          </p>
                          <p className="text-xs text-ink-soft">
                            {PARAM_GROUP_LABEL[r.paramGroup]} · {PARAM_KIND_LABEL[r.kind]}
                            {r.kind === "range" && ` · ${formatLimits(r.minMilli, r.maxMilli, r.unit)}`}
                            {r.expectedText && ` · ${r.expectedText}`}
                          </p>
                        </div>
                        {linked ? (
                          <p className="text-sm">Lấy từ phiếu {TEST_LABEL[r.lotTestType!]} của lô</p>
                        ) : (
                          <>
                            <input type="hidden" name="resultId" value={r.id} />
                            {r.kind === "range" && (
                              <input
                                name={`v_${r.id}`}
                                defaultValue={r.valueMilli == null ? "" : formatMilli(r.valueMilli)}
                                inputMode="decimal"
                                placeholder={`Giá trị${r.unit ? ` (${r.unit})` : ""}`}
                                aria-label={`Giá trị ${r.name}`}
                                aria-invalid={bad}
                                className={`field ${bad ? "border-danger text-danger" : ""}`}
                              />
                            )}
                            {r.kind === "pass_fail" && (
                              <select name={`pf_${r.id}`} defaultValue={r.passed == null ? "" : r.passed ? "pass" : "fail"} aria-label={`Kết quả ${r.name}`} className={`field ${bad ? "border-danger text-danger" : ""}`}>
                                <option value="">Chưa có</option>
                                <option value="pass">Đạt</option>
                                <option value="fail">Không đạt</option>
                              </select>
                            )}
                            {r.kind === "text" && <input name={`t_${r.id}`} defaultValue={r.valueText ?? ""} aria-label={`Ghi nhận ${r.name}`} className="field" />}
                          </>
                        )}
                        <span className="text-sm">
                          {r.livePassed === true && <Badge tone="green">Đạt</Badge>}
                          {r.livePassed === false && <Badge tone="red">Ngoài giới hạn</Badge>}
                          {r.livePassed === null && <span className="text-xs text-ink-soft">{r.kind === "text" ? "Ghi nhận" : "Chưa có kết quả"}</span>}
                          {!linked && (
                            <input name={`n_${r.id}`} defaultValue={r.note ?? ""} placeholder="Ghi chú" aria-label={`Ghi chú ${r.name}`} className="field mt-2 text-sm" />
                          )}
                        </span>
                      </div>
                    );
                  })}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="field-label">Cỡ mẫu</span>
                      <input name="sampleSize" defaultValue={insp.sampleSize} className="field" />
                    </label>
                    <label className="block">
                      <span className="field-label">Ghi chú phiếu</span>
                      <input name="note" defaultValue={insp.note ?? ""} className="field" />
                    </label>
                  </div>
                </fieldset>
              </ActionForm>
            )}
            {canWrite && (
              <details className="mt-5 border-t border-line pt-4">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm">Thêm chỉ tiêu tự do</summary>
                <ActionForm action={addParamAction} submitLabel="Thêm chỉ tiêu" className="mt-3 grid gap-3 sm:grid-cols-2" resetOnSuccess>
                  <input type="hidden" name="id" value={insp.id} />
                  <input name="name" placeholder="Tên chỉ tiêu" aria-label="Tên chỉ tiêu" className="field sm:col-span-2" />
                  <select name="paramGroup" defaultValue="other" aria-label="Nhóm" className="field">
                    {Object.entries(PARAM_GROUP_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select name="kind" defaultValue="range" aria-label="Kiểu" className="field">
                    {Object.entries(PARAM_KIND_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <input name="unit" placeholder="Đơn vị" aria-label="Đơn vị" className="field" />
                  <input name="expectedText" placeholder="Yêu cầu (chữ)" aria-label="Yêu cầu" className="field" />
                  <input name="min" placeholder="Giới hạn dưới" aria-label="Giới hạn dưới" inputMode="decimal" className="field" />
                  <input name="max" placeholder="Giới hạn trên" aria-label="Giới hạn trên" inputMode="decimal" className="field" />
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" name="isCritical" defaultChecked className="accent-graphite" /> Trọng yếu
                  </label>
                </ActionForm>
              </details>
            )}
          </Card>

          {insp.stage === "fqc" && d.lot && (
            <Card title="Phiếu kiểm nghiệm lô và phiếu công bố">
              {d.tests.length === 0 ? (
                <p className="text-sm text-ink-soft">Lô chưa có phiếu kiểm nghiệm. Thêm ở trang lô.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {d.tests.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {TEST_LABEL[t.type]} {t.reportNo && <span className="font-mono text-xs text-ink-soft">{t.reportNo}</span>}
                      </span>
                      <Badge tone={t.result === "pass" ? "green" : t.result === "fail" ? "red" : "amber"}>{RESULT[t.result]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 border-t border-line pt-3 text-sm">
                {d.notification ? (
                  <>
                    Phiếu công bố <span className="font-mono">{d.notification.number}</span>, hiệu lực đến {formatDate(d.notification.expiresAt)}
                  </>
                ) : (
                  <span className="text-danger">Sản phẩm chưa có phiếu công bố</span>
                )}
              </p>
              <Link href={`/admin/lo/${d.lot.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4">
                Mở trang lô để thêm phiếu kiểm nghiệm
              </Link>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Đối tượng kiểm">
            <dl className="space-y-2 text-sm">
              {d.lot && (
                <Row label="Lô thành phẩm">
                  <Link href={`/admin/lo/${d.lot.id}`} className="font-mono underline underline-offset-4">
                    {d.lot.lotNo}
                  </Link>{" "}
                  · {LOT_STATUS_LABEL[d.lot.releaseStatus]}
                </Row>
              )}
              {d.stockLot && (
                <>
                  <Row label="Lô kho">
                    <span className="font-mono">{d.stockLot.code}</span> · {d.stockLot.qcStatus ? QC_STATUS[d.stockLot.qcStatus] : ""}
                  </Row>
                  <Row label="Hàng">
                    {d.stockLot.itemCode} {d.stockLot.itemName}
                  </Row>
                  <Row label="Số nhận">{formatQty(d.stockLot.receivedQty, d.stockLot.baseUom as BaseUom, d.stockLot.displayUom as DisplayUom)}</Row>
                  {d.stockLot.supplierLotNo && <Row label="Số lô NCC">{d.stockLot.supplierLotNo}</Row>}
                  {d.stockLot.manufacturedOn && <Row label="NSX">{formatDate(d.stockLot.manufacturedOn)}</Row>}
                  {d.stockLot.expiresOn && <Row label="HSD">{formatDate(d.stockLot.expiresOn)}</Row>}
                </>
              )}
              {d.supplier && (
                <Row label="Nhà cung cấp">
                  {d.supplier.code} {d.supplier.name}
                </Row>
              )}
              {d.receipt && (
                <Row label="Phiếu nhập">
                  <span className="font-mono">{d.receipt.code}</span>
                </Row>
              )}
              {d.order && (
                <Row label="Lệnh sản xuất">
                  <Link href={`/admin/san-xuat/lenh/${d.order.id}`} className="font-mono underline underline-offset-4">
                    {d.order.code}
                  </Link>
                </Row>
              )}
              {d.step && (
                <Row label="Công đoạn">
                  {d.step.seq}. {d.step.name}
                </Row>
              )}
              {d.run && (
                <Row label="Mẻ chiết">
                  <Link href={`/admin/san-xuat/chiet-xuat/${d.run.id}`} className="font-mono underline underline-offset-4">
                    {d.run.code}
                  </Link>
                </Row>
              )}
              {d.complaint && <Row label="Phản ánh">{d.complaint.symptoms}</Row>}
              <Row label="Tạo lúc">{formatDateTime(insp.createdAt)}</Row>
              {insp.decidedAt && <Row label="Quyết định lúc">{formatDateTime(insp.decidedAt)}</Row>}
              {insp.disposition && <Row label="Quyết định">{DISPOSITION_LABEL[insp.disposition]}</Row>}
              {insp.decisionNote && <Row label="Ghi chú quyết định">{insp.decisionNote}</Row>}
            </dl>
            {d.ncrs.length > 0 && (
              <ul className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
                {d.ncrs.map((n) => (
                  <li key={n.id}>
                    <Link href={`/admin/chat-luong/ncr/${n.id}`} className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4">
                      <span className="font-mono">{n.code}</span> · {NCR_STATUS_LABEL[n.status]}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canApprove && (
            <Card title="Quyết định">
              <p className="mb-3 text-sm text-ink-soft">
                Đạt chỉ chọn được khi kết luận gợi ý là Đạt. Không đạt và trả nhà cung cấp: số dư lô chuyển sang kho cách ly REJ và mở NCR.
                {insp.stage === "fqc" && " FQC đạt sẽ chạy kiểm tra duyệt xuất (phiếu kiểm nghiệm, phiếu công bố, hạn dùng)."}
              </p>
              <ActionForm action={decideInspectionAction} submitLabel="Ghi quyết định" confirm="Ghi quyết định cho phiếu này? Không sửa lại được.">
                <input type="hidden" name="id" value={insp.id} />
                <fieldset className="space-y-2">
                  <legend className="field-label">Quyết định</legend>
                  {DISPOSITIONS[insp.stage].map((k, i) => (
                    <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="radio" name="disposition" value={k} defaultChecked={i === 0} className="accent-graphite" /> {DISPOSITION_LABEL[k]}
                    </label>
                  ))}
                </fieldset>
                <label className="block">
                  <span className="field-label">Lý do, ghi chú (bắt buộc khi không chọn Đạt)</span>
                  <textarea name="note" rows={2} className="field" />
                </label>
              </ActionForm>
            </Card>
          )}

          {canWrite && (
            <Card title="Hủy phiếu">
              <ActionForm action={cancelInspectionAction} submitLabel="Hủy phiếu" submitClassName="btn btn-outline" confirm="Hủy phiếu kiểm này?">
                <input type="hidden" name="id" value={insp.id} />
                <input name="reason" placeholder="Lý do hủy (bắt buộc)" aria-label="Lý do hủy" className="field" />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
