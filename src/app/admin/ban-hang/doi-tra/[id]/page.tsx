import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateTime, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getReturn } from "@/modules/sales/returns";
import {
  RETURN_CONDITION_LABEL,
  RETURN_DISPOSITION_LABEL,
  RETURN_REASON_LABEL,
  RETURN_RESOLUTION_LABEL,
  RETURN_STATUS_LABEL,
  type ReturnCondition,
  type ReturnDisposition,
  type ReturnReason,
  type ReturnResolution,
  type ReturnStatus,
} from "@/modules/sales/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader } from "../../../_components/ui";
import { approveReturnAction, cancelReturnAction, complaintFromReturnAction, completeReturnAction, receiveReturnAction, rejectReturnAction } from "../../actions";
import { returnTone } from "../tone";

export const metadata: Metadata = { title: "Đổi trả" };

const EXCHANGE_ROWS = 3;

export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, data] = await Promise.all([requireStaff(), getReturn(id)]);
  if (!data) notFound();
  const { r, order, lines, replacement, accounts, products } = data;
  const canWrite = can(staff.role, "sales.write");
  const canMoney = can(staff.role, "finance.write");
  const status = r.status as ReturnStatus;
  const open = status === "requested" || status === "approved" || status === "received";

  return (
    <>
      <Link href="/admin/ban-hang/doi-tra" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Đổi trả
      </Link>
      <PageHeader
        title={`Đổi trả ${r.code}`}
        description={`${RETURN_REASON_LABEL[r.reason as ReturnReason]} · ${RETURN_RESOLUTION_LABEL[r.resolution as ReturnResolution]} · tạo ${formatDateTime(r.requestedAt)}`}
        actions={<Badge tone={returnTone(status)}>{RETURN_STATUS_LABEL[status]}</Badge>}
      />

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card title="Hàng trả">
            {status === "approved" && canWrite ? (
              <ActionForm action={receiveReturnAction} submitLabel="Đã nhận hàng" pendingLabel="Đang nhập kho…" className="space-y-4">
                <input type="hidden" name="returnId" value={r.id} />
                <ul className="divide-y divide-line">
                  {lines.map(({ line, productName, lotNo }) => (
                    <li key={line.id} className="space-y-2 py-3 first:pt-0">
                      <input type="hidden" name="lineId" value={line.id} />
                      <p>
                        {productName} × {line.qty}
                        {lotNo && <span className="ml-2 font-mono text-xs text-ink-soft">lô {lotNo}</span>}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <select name={`condition:${line.id}`} defaultValue="" className="field min-h-11 w-auto text-sm" aria-label={`Tình trạng ${productName}`}>
                          <option value="">— Tình trạng —</option>
                          {(Object.keys(RETURN_CONDITION_LABEL) as ReturnCondition[]).map((c) => (
                            <option key={c} value={c}>
                              {RETURN_CONDITION_LABEL[c]}
                            </option>
                          ))}
                        </select>
                        <select name={`disposition:${line.id}`} defaultValue="" className="field min-h-11 w-auto text-sm" aria-label={`Xử lý ${productName}`}>
                          <option value="">— Xử lý —</option>
                          {(Object.keys(RETURN_DISPOSITION_LABEL) as ReturnDisposition[]).map((d) => (
                            <option key={d} value={d}>
                              {RETURN_DISPOSITION_LABEL[d]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ink-soft">Hàng hỏng hoặc lỗi phải đưa vào khu cách ly, không nhập lại kho bán.</p>
              </ActionForm>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {lines.map(({ line, productName, unitPrice, lotNo }) => (
                  <li key={line.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="min-w-40 flex-1">
                      {productName} × {line.qty}
                      <span className="block text-xs text-ink-soft">
                        {formatVnd(unitPrice)}
                        {lotNo ? ` · lô ${lotNo}` : ""}
                      </span>
                    </span>
                    {line.condition && <Badge tone={line.condition === "intact" ? "green" : "red"}>{RETURN_CONDITION_LABEL[line.condition as ReturnCondition]}</Badge>}
                    {line.disposition && <span className="text-ink-soft">{RETURN_DISPOSITION_LABEL[line.disposition as ReturnDisposition]}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {status === "received" && canWrite && (
            <Card title="Hoàn tất">
              <ActionForm action={completeReturnAction} submitLabel="Hoàn tất đổi trả" className="space-y-4" confirm="Hoàn tất? Hệ thống ghi phiếu chi hoặc giảm công nợ và tạo đơn đổi nếu có.">
                <input type="hidden" name="returnId" value={r.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Tiền hoàn (đ)</span>
                    <input name="refundAmount" inputMode="numeric" defaultValue={r.refundAmount} disabled={!canMoney} className="field" />
                  </label>
                  <label className="block">
                    <span className="field-label">Chi phí phát sinh (đ)</span>
                    <input name="extraCost" inputMode="numeric" defaultValue={r.extraCost} disabled={!canMoney} className="field" />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="field-label">Chi từ tài khoản</span>
                    <select name="refundAccountId" defaultValue={r.refundAccountId ?? ""} className="field min-h-11">
                      <option value="">Theo cách khách đã trả</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!canMoney && (r.refundAmount > 0 || r.extraCost > 0) && <p className="text-sm text-danger">Có tiền hoàn hoặc chi phí: cần chủ cửa hàng (quyền tài chính) hoàn tất.</p>}
                {r.resolution === "exchange" && (
                  <div className="space-y-2 border-t border-line pt-4">
                    <p className="eyebrow">Hàng gửi đổi (đơn mới 0đ)</p>
                    {Array.from({ length: EXCHANGE_ROWS }, (_, i) => (
                      <div key={i} className="grid grid-cols-[1fr_5rem] gap-2">
                        <select name="exchangeProductId" defaultValue={i < lines.length ? lines[i]!.productId : ""} className="field min-h-11 min-w-0" aria-label={`Sản phẩm đổi ${i + 1}`}>
                          <option value="">— Sản phẩm —</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <input name="exchangeQty" inputMode="numeric" defaultValue={i < lines.length ? lines[i]!.line.qty : 0} className="field min-h-11" aria-label={`Số lượng đổi ${i + 1}`} />
                      </div>
                    ))}
                    <label className="block">
                      <span className="field-label">Phí giao đơn đổi thu khách (đ)</span>
                      <input name="exchangeShippingFee" inputMode="numeric" defaultValue="0" className="field" />
                    </label>
                  </div>
                )}
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Thông tin">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Đơn</dt>
                <dd>
                  <Link href={`/admin/don-hang/${order.id}`} className="font-mono underline underline-offset-4">
                    {order.code}
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Khách</dt>
                <dd>{order.recipientName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Tiền hoàn</dt>
                <dd>{formatVnd(r.refundAmount)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Chi phí phát sinh</dt>
                <dd>{formatVnd(r.extraCost)}</dd>
              </div>
              {replacement && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">Đơn đổi</dt>
                  <dd>
                    <Link href={`/admin/don-hang/${replacement.id}`} className="font-mono underline underline-offset-4">
                      {replacement.code}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
            {r.reasonNote && <p className="mt-3 bg-pith p-3 text-sm">{r.reasonNote}</p>}
            {r.note && <p className="mt-3 whitespace-pre-line text-sm text-ink-soft">{r.note}</p>}
          </Card>

          {canWrite && (open || (r.reason === "defect" && !r.complaintId)) && (
            <Card title="Xử lý">
              <div className="space-y-4">
                {status === "requested" && (
                  <ActionForm action={approveReturnAction} submitLabel="Duyệt">
                    <input type="hidden" name="returnId" value={r.id} />
                  </ActionForm>
                )}
                {r.reason === "defect" && !r.complaintId && can(staff.role, "complaints.write") && (
                  <ActionForm action={complaintFromReturnAction} submitLabel="Tạo phản ánh chất lượng" submitClassName="btn btn-outline">
                    <input type="hidden" name="returnId" value={r.id} />
                  </ActionForm>
                )}
                {(status === "requested" || status === "approved") && (
                  <ActionForm action={cancelReturnAction} submitLabel="Hủy yêu cầu" submitClassName="btn btn-outline" confirm="Hủy yêu cầu đổi trả này?">
                    <input type="hidden" name="returnId" value={r.id} />
                  </ActionForm>
                )}
                {open && (
                  <details className="border-t border-line pt-4">
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm text-danger">Từ chối…</summary>
                    <ActionForm action={rejectReturnAction} submitLabel="Từ chối" submitClassName="btn border-danger bg-danger text-bone" className="mt-3 space-y-3">
                      <input type="hidden" name="returnId" value={r.id} />
                      <input name="reason" required placeholder="Lý do từ chối" className="field" />
                    </ActionForm>
                  </details>
                )}
              </div>
            </Card>
          )}
          {r.complaintId && (
            <p className="text-sm">
              Đã tạo phản ánh.{" "}
              <Link href="/admin/phan-anh" className="inline-flex min-h-11 items-center underline underline-offset-4">
                Mở mục Phản ánh
              </Link>
            </p>
          )}
        </div>
      </div>
    </>
  );
}
