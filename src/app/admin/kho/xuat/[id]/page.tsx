import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDateTime, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getIssueDetail } from "@/modules/inventory/admin";
import { addDays, costOfQty } from "@/modules/inventory/rules";
import { vnToday } from "@/modules/numbering/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader } from "../../../_components/ui";
import { DataList, TapLink } from "../../_components/data-list";
import { PrintButton } from "../../_components/print-button";
import { postIssueAction, rejectIssueAction, retainedSampleAction, submitIssueAction } from "../../actions";
import { q, viDate } from "../../_lib/fmt";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE, ISSUE_KIND_LABEL } from "../../_lib/labels";

export const metadata: Metadata = { title: "Phiếu xuất" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANUAL = new Set(["sample", "qc_sample", "scrap", "research", "supplier_return", "other"]);

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, staff, db] = await Promise.all([params, requireStaff(), getDb()]);
  if (!UUID.test(id)) notFound();
  const today = vnToday();
  const d = await getIssueDetail(db, id, today);
  if (!d) notFound();
  const is = d.issue;
  const showValue = can(staff.role, "finance.view");
  const canWrite = can(staff.role, "inventory.write");
  const approver = can(staff.role, "inventory.approve");
  const manual = MANUAL.has(is.kind);
  const mine = is.requestedBy === staff.id;
  type L = (typeof d.lines)[number];

  // Mẫu lưu (R-KHO-17): phiếu qc_sample đã ghi sổ, có lô thành phẩm
  const productLots = new Map<string, { code: string; qty: number }>();
  for (const l of d.lines) {
    if (!l.productLotId || !l.lotCode) continue;
    const cur = productLots.get(l.productLotId) ?? { code: l.lotCode, qty: 0 };
    cur.qty += l.line.qty;
    productLots.set(l.productLotId, cur);
  }
  const canSample = is.kind === "qc_sample" && is.status === "posted" && canWrite && productLots.size > 0;

  return (
    <>
      <Link href="/admin/kho/xuat" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite print:hidden">
        ← Xuất kho
      </Link>
      <PageHeader
        title={`Phiếu xuất ${is.code}`}
        description={`${ISSUE_KIND_LABEL[is.kind]}${is.purpose ? ` · ${is.purpose}` : ""}${d.warehouseCode ? ` · Kho ${d.warehouseCode}` : ""}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={DOC_STATUS_TONE[is.status]}>{DOC_STATUS_LABEL[is.status]}</Badge>
            <PrintButton />
          </span>
        }
      />

      <Card title="Thông tin" className="mb-6 max-w-2xl">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-soft">Người lập</dt>
          <dd>
            {(is.requestedBy && d.people.get(is.requestedBy)) || "–"} · {formatDateTime(is.createdAt)}
          </dd>
          {is.approvedAt && (
            <>
              <dt className="text-ink-soft">Người duyệt</dt>
              <dd>
                {(is.approvedBy && d.people.get(is.approvedBy)) || "–"} · {formatDateTime(is.approvedAt)}
              </dd>
            </>
          )}
          {is.postedAt && (
            <>
              <dt className="text-ink-soft">Ghi sổ</dt>
              <dd>
                {(is.postedBy && d.people.get(is.postedBy)) || "–"} · {formatDateTime(is.postedAt)}
              </dd>
            </>
          )}
          {is.cancelledAt && (
            <>
              <dt className="text-ink-soft">Hủy / từ chối</dt>
              <dd>
                {formatDateTime(is.cancelledAt)} · {is.cancelReason}
              </dd>
            </>
          )}
          {is.note && (
            <>
              <dt className="text-ink-soft">Ghi chú</dt>
              <dd className="whitespace-pre-line">{is.note}</dd>
            </>
          )}
        </dl>
        {is.fileIds.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-2 text-sm print:hidden">
            {is.fileIds.map((f, i) => (
              <a key={f} href={`/api/files/${f}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">
                Chứng từ {i + 1}
              </a>
            ))}
          </p>
        )}
      </Card>

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
                  {l.locationCode ? ` · ${l.locationCode}` : ""}
                </TapLink>
              ) : (
                <span className="text-ink-soft">FEFO khi ghi sổ</span>
              ),
          },
          {
            label: "Gợi ý",
            cell: (l) => {
              const h = d.hints.get(l.line.id);
              return h ? <span className={h.startsWith("Không theo FEFO") || h.startsWith("Hiện chỉ") ? "text-danger" : "text-ink-soft"}>{h}</span> : "–";
            },
          },
          { label: "Ghi chú", cell: (l) => l.line.note || "–" },
          ...(showValue && is.status === "posted"
            ? [{ label: "Giá trị", cell: (l: L) => (l.receivedQty ? formatVnd(costOfQty(l.line.qty, l.receivedQty, l.receivedCost ?? 0)) : "–"), className: "tabular-nums" }]
            : []),
        ]}
      />

      <div className="mt-6 flex flex-wrap gap-4 print:hidden">
        {is.status === "draft" && canWrite && !approver && manual && mine && (
          <ActionForm action={submitIssueAction} submitLabel="Gửi duyệt" inline>
            <input type="hidden" name="id" value={is.id} />
          </ActionForm>
        )}
        {(is.status === "draft" || is.status === "pending_approval") && approver && (
          <ActionForm action={postIssueAction} submitLabel={is.status === "pending_approval" ? "Duyệt và ghi sổ" : "Ghi sổ"} pendingLabel="Đang ghi…" confirm="Ghi sổ phiếu xuất? Tồn kho giảm ngay." inline>
            <input type="hidden" name="id" value={is.id} />
          </ActionForm>
        )}
        {is.status === "draft" && (approver || (canWrite && mine)) && (
          <ActionForm action={rejectIssueAction} submitLabel="Hủy nháp" submitClassName="btn btn-outline" confirm="Hủy phiếu nháp này?" inline>
            <input type="hidden" name="id" value={is.id} />
            <input type="hidden" name="reason" value="Hủy nháp" />
          </ActionForm>
        )}
      </div>
      {is.status === "pending_approval" && !approver && <p className="mt-4 text-sm text-ink-soft">Đang chờ chủ cửa hàng duyệt. Tồn chưa đổi.</p>}

      {is.status === "pending_approval" && approver && (
        <div className="mt-6 max-w-xl print:hidden">
          <Card title="Từ chối phiếu">
            <ActionForm action={rejectIssueAction} submitLabel="Từ chối" submitClassName="btn btn-outline">
              <input type="hidden" name="id" value={is.id} />
              <label className="block">
                <span className="field-label">Lý do</span>
                <input name="reason" required className="field" />
              </label>
            </ActionForm>
          </Card>
        </div>
      )}

      {is.kind === "qc_sample" && (d.samples.length > 0 || canSample) && (
        <div className="mt-8 max-w-3xl">
          <Card title="Mẫu lưu">
            {d.samples.length > 0 && (
              <ul className="mb-4 space-y-1 text-sm">
                {d.samples.map((s) => (
                  <li key={s.id}>
                    {[...productLots.entries()].find(([pid]) => pid === s.lotId)?.[1].code ?? "Lô"} · {s.units} chai · {s.location} · giữ đến {viDate(s.keepUntil)}
                  </li>
                ))}
              </ul>
            )}
            {canSample && (
              <ActionForm action={retainedSampleAction} submitLabel="Ghi mẫu lưu" submitClassName="btn btn-outline" resetOnSuccess>
                <input type="hidden" name="id" value={is.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Lô thành phẩm</span>
                    <select name="productLotId" className="field">
                      {[...productLots.entries()].map(([pid, v]) => (
                        <option key={pid} value={pid}>
                          {v.code} (xuất {v.qty})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Số chai</span>
                    <input name="units" inputMode="numeric" required className="field" />
                  </label>
                  <label className="block">
                    <span className="field-label">Nơi cất</span>
                    <input name="location" required className="field" />
                  </label>
                  <label className="block">
                    <span className="field-label">Giữ đến</span>
                    <input type="date" name="keepUntil" defaultValue={addDays(today, 365 * 3)} required className="field" />
                  </label>
                </div>
              </ActionForm>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
