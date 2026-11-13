import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDateTime, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getReceiptDetail } from "@/modules/inventory/admin";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader } from "../../../_components/ui";
import { DataList, TapLink } from "../../_components/data-list";
import { PrintButton } from "../../_components/print-button";
import { cancelReceiptAction, postReceiptAction, updateLineCostAction } from "../../actions";
import { q, viDate } from "../../_lib/fmt";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE, PAYMENT_MODE_LABEL, RECEIPT_KIND_LABEL } from "../../_lib/labels";

export const metadata: Metadata = { title: "Phiếu nhập" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, staff, db] = await Promise.all([params, requireStaff(), getDb()]);
  if (!UUID.test(id)) notFound();
  const d = await getReceiptDetail(db, id);
  if (!d) notFound();
  const r = d.receipt;
  const showValue = can(staff.role, "finance.view");
  const canWrite = can(staff.role, "inventory.write");
  const approver = can(staff.role, "inventory.approve");
  const canPost = r.status === "draft" && canWrite && (r.kind !== "opening" || approver);
  const canCancelDraft = r.status === "draft" && (approver || (canWrite && r.createdBy === staff.id));
  const canCancelPosted = r.status === "posted" && approver;
  // Sửa giá sau ghi sổ (R-KHO-37): finance.write, phiếu đã ghi sổ, không trả tiền ngay
  const canEditCost = r.status === "posted" && can(staff.role, "finance.write") && r.paymentMode !== "paid_now";
  const total = d.lines.reduce((s, l) => s + l.line.lineCost, 0);
  type L = (typeof d.lines)[number];

  return (
    <>
      <Link href="/admin/kho/nhap" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite print:hidden">
        ← Nhập kho
      </Link>
      <PageHeader
        title={`Phiếu nhập ${r.code}`}
        description={`${RECEIPT_KIND_LABEL[r.kind]} · ${viDate(r.receivedOn)} · Kho ${d.warehouseCode} · ${d.warehouseName}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={DOC_STATUS_TONE[r.status]}>{DOC_STATUS_LABEL[r.status]}</Badge>
            <PrintButton />
          </span>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="Thông tin">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-soft">Nhà cung cấp</dt>
            <dd>{d.supplierName ? `${d.supplierCode} · ${d.supplierName}` : "–"}</dd>
            <dt className="text-ink-soft">Số hóa đơn</dt>
            <dd>{r.invoiceNo || "–"}</dd>
            <dt className="text-ink-soft">Trả tiền</dt>
            <dd>{PAYMENT_MODE_LABEL[r.paymentMode] ?? r.paymentMode}</dd>
            <dt className="text-ink-soft">Người lập</dt>
            <dd>{(r.createdBy && d.people.get(r.createdBy)) || "–"} · {formatDateTime(r.createdAt)}</dd>
            {r.postedAt && (
              <>
                <dt className="text-ink-soft">Ghi sổ</dt>
                <dd>
                  {(r.postedBy && d.people.get(r.postedBy)) || "–"} · {formatDateTime(r.postedAt)}
                </dd>
              </>
            )}
            {r.cancelledAt && (
              <>
                <dt className="text-ink-soft">Hủy</dt>
                <dd>
                  {formatDateTime(r.cancelledAt)} · {r.cancelReason}
                </dd>
              </>
            )}
            {r.note && (
              <>
                <dt className="text-ink-soft">Ghi chú</dt>
                <dd className="whitespace-pre-line">{r.note}</dd>
              </>
            )}
          </dl>
          {r.fileIds.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-2 text-sm print:hidden">
              {r.fileIds.map((f, i) => (
                <a key={f} href={`/api/files/${f}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">
                  Chứng từ {i + 1}
                </a>
              ))}
            </p>
          )}
        </Card>
        {showValue && (
          <Card title="Giá trị và công nợ">
            <p className="text-2xl tabular-nums">{formatVnd(r.status === "posted" ? r.totalCost : total)}</p>
            {d.debt ? (
              <p className="mt-2 text-sm">
                Công nợ phải trả: {formatVnd(d.debt.amount)} · đã trả {formatVnd(d.debt.paidAmount)}{" "}
                <Link href="/admin/tai-chinh/cong-no" className="inline-flex min-h-11 items-center underline underline-offset-4 print:hidden">
                  Xem công nợ
                </Link>
              </p>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">Không có công nợ gắn với phiếu.</p>
            )}
          </Card>
        )}
      </div>

      <h2 className="eyebrow mb-3 text-[0.68rem]">Dòng hàng</h2>
      <DataList
        rows={d.lines}
        rowKey={(l) => l.line.id}
        empty="Phiếu chưa có dòng."
        cols={[
          { label: "Hàng", cell: (l) => `${l.itemCode} · ${l.itemName}` },
          { label: "Số lượng", cell: (l) => q(l.line.qty, l), className: "tabular-nums" },
          {
            label: "Lô",
            cell: (l) =>
              l.line.stockLotId ? (
                <TapLink href={`/admin/kho/lo/${l.line.stockLotId}`} className="font-mono">
                  {l.lotCode}
                </TapLink>
              ) : (
                <span className="text-ink-soft">{l.productLotNo ?? "Tạo khi ghi sổ"}</span>
              ),
          },
          { label: "Lô NCC", cell: (l) => l.line.supplierLotNo || "–" },
          { label: "NSX / HSD", cell: (l) => `${viDate(l.line.manufacturedOn) || "–"} / ${viDate(l.line.expiresOn) || "–"}` },
          { label: "Vị trí", cell: (l) => l.locationCode ?? "Mặc định" },
          { label: "Kiểm", cell: (l) => (l.line.qcRequired ? <Badge tone="amber">Cần kiểm</Badge> : "Không") },
          ...(showValue ? [{ label: "Thành tiền", cell: (l: L) => formatVnd(l.line.lineCost), className: "tabular-nums" }] : []),
        ]}
      />

      <div className="mt-6 flex flex-wrap gap-4 print:hidden">
        {canPost && (
          <ActionForm action={postReceiptAction} submitLabel="Ghi sổ" pendingLabel="Đang ghi…" confirm="Ghi sổ phiếu nhập? Tồn kho tăng ngay." inline>
            <input type="hidden" name="id" value={r.id} />
          </ActionForm>
        )}
        {r.status === "draft" && r.kind === "opening" && canWrite && !approver && <p className="text-sm text-ink-soft">Phiếu tồn đầu kỳ cần chủ cửa hàng ghi sổ.</p>}
        {canCancelDraft && (
          <ActionForm action={cancelReceiptAction} submitLabel="Hủy nháp" submitClassName="btn btn-outline" confirm="Hủy phiếu nháp này?" inline>
            <input type="hidden" name="id" value={r.id} />
          </ActionForm>
        )}
      </div>

      {canCancelPosted && (
        <div className="mt-6 max-w-xl print:hidden">
          <Card title="Hủy phiếu đã ghi sổ">
            <p className="mb-3 text-sm text-ink-soft">Hệ thống đảo biến động và công nợ. Không hủy được nếu hàng của phiếu đã xuất dùng.</p>
            <ActionForm action={cancelReceiptAction} submitLabel="Hủy phiếu" submitClassName="btn btn-outline" confirm="Hủy phiếu nhập đã ghi sổ?">
              <input type="hidden" name="id" value={r.id} />
              <label className="block">
                <span className="field-label">Lý do</span>
                <input name="reason" required className="field" />
              </label>
            </ActionForm>
          </Card>
        </div>
      )}

      {canEditCost && (
        <div className="mt-6 max-w-3xl print:hidden">
          <Card title="Sửa giá nhập sau ghi sổ">
            <p className="mb-4 text-sm text-ink-soft">Cập nhật giá trị lô, công nợ và giá vốn lệnh sản xuất chưa khóa giá. Ghi lý do để lưu vết.</p>
            <div className="space-y-6">
              {d.lines.map((l) => (
                <ActionForm key={l.line.id} action={updateLineCostAction} submitLabel={`Sửa giá ${l.itemCode}`} submitClassName="btn btn-outline" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <input type="hidden" name="lineId" value={l.line.id} />
                  <input type="hidden" name="receiptId" value={r.id} />
                  <label className="block">
                    <span className="field-label">
                      {l.itemCode}: thành tiền mới (đang {formatVnd(l.line.lineCost)})
                    </span>
                    <input name="lineCost" inputMode="numeric" required className="field" />
                  </label>
                  <label className="block">
                    <span className="field-label">Lý do</span>
                    <input name="reason" required className="field" />
                  </label>
                </ActionForm>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
