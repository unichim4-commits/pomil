import type { Metadata } from "next";
import Link from "next/link";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getReturnDraft } from "@/modules/sales/returns";
import { RETURN_REASON_LABEL, RETURN_RESOLUTION_LABEL, type ReturnReason, type ReturnResolution } from "@/modules/sales/rules";
import { ActionForm } from "../../../_components/action-form";
import { Card, Empty, PageHeader } from "../../../_components/ui";
import { createReturnAction } from "../../actions";

export const metadata: Metadata = { title: "Tạo đổi trả" };

// ?don=<id đơn> (mã nội bộ, không phải dữ liệu cá nhân). R-BH-19…R-BH-21
export default async function NewReturnPage({ searchParams }: { searchParams: Promise<{ don?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const orderId = /^[0-9a-f-]{36}$/i.test(sp.don ?? "") ? sp.don! : null;
  const draft = orderId ? await getReturnDraft(orderId) : null;
  const back = (
    <Link href={orderId ? `/admin/don-hang/${orderId}` : "/admin/ban-hang/doi-tra"} className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
      ← {orderId ? "Trang đơn" : "Đổi trả"}
    </Link>
  );
  if (!can(staff.role, "sales.write")) return <Empty>Tài khoản của bạn không có quyền tạo đổi trả.</Empty>;
  if (!draft)
    return (
      <>
        {back}
        <Empty>Mở trang một đơn đã giao rồi bấm “Tạo đổi trả”.</Empty>
      </>
    );
  const { order, items, refundedBefore, maxRefund } = draft;

  return (
    <>
      {back}
      <PageHeader title={`Đổi trả cho đơn ${order.code}`} description={`${order.recipientName} · tổng ${formatVnd(order.total)}${refundedBefore ? ` · đã hoàn trước ${formatVnd(refundedBefore)}` : ""}`} />
      {order.status !== "delivered" ? (
        <Empty>Chỉ tạo đổi trả cho đơn đã giao.</Empty>
      ) : (
        <ActionForm action={createReturnAction} submitLabel="Tạo yêu cầu" className="space-y-6">
          <input type="hidden" name="orderId" value={order.id} />
          <Card title="Hàng trả">
            <ul className="divide-y divide-line">
              {items.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-48 flex-1">
                    {it.productName}
                    <span className="block text-xs text-ink-soft">
                      {formatVnd(it.unitPrice)} · đã mua {it.quantity} · còn trả được {it.returnable}
                      {it.lotNo ? ` · lô ${it.lotNo}` : ""}
                    </span>
                  </span>
                  <input
                    name={`qty:${it.id}`}
                    inputMode="numeric"
                    defaultValue="0"
                    disabled={it.returnable === 0}
                    className="field min-h-11 w-20"
                    aria-label={`Số trả ${it.productName}`}
                  />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Lý do và cách giải quyết">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Lý do</span>
                <select name="reason" className="field min-h-11">
                  {(Object.keys(RETURN_REASON_LABEL) as ReturnReason[]).map((r) => (
                    <option key={r} value={r}>
                      {RETURN_REASON_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Cách giải quyết</span>
                <select name="resolution" className="field min-h-11">
                  {(Object.keys(RETURN_RESOLUTION_LABEL) as ReturnResolution[]).map((r) => (
                    <option key={r} value={r}>
                      {RETURN_RESOLUTION_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="field-label">Mô tả</span>
                <textarea name="reasonNote" rows={2} className="field" />
              </label>
              <label className="block">
                <span className="field-label">Tiền hoàn (đ)</span>
                <input name="refundAmount" inputMode="numeric" placeholder="Để trống: theo giá thực trả" className="field" />
                <span className="mt-1 block text-xs text-ink-soft">Tối đa {formatVnd(maxRefund)}.</span>
              </label>
              <label className="block">
                <span className="field-label">Chi phí phát sinh (ship hoàn, đ)</span>
                <input name="extraCost" inputMode="numeric" defaultValue="0" className="field" />
              </label>
              <label className="block sm:col-span-2">
                <span className="field-label">Ghi chú nội bộ</span>
                <input name="note" className="field" />
              </label>
            </div>
          </Card>
        </ActionForm>
      )}
    </>
  );
}
