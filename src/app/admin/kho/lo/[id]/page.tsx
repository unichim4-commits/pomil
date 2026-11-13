import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDateTime, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { balanceValue, docHref, getStockLotDetail } from "@/modules/inventory/admin";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader, Stat } from "../../../_components/ui";
import { DataList, TapLink } from "../../_components/data-list";
import { lotHoldAction } from "../../actions";
import { q, viDate } from "../../_lib/fmt";
import { ITEM_KIND_LABEL, LOT_STATUS_LABEL, LOT_STATUS_TONE, MOVE_TYPE_LABEL } from "../../_lib/labels";

export const metadata: Metadata = { title: "Lô" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSPECTION_LABEL: Record<string, string> = { pending: "Chờ kết quả", passed: "Đạt", failed: "Không đạt", cancelled: "Đã hủy" };
const STAGE_LABEL: Record<string, string> = { iqc: "IQC đầu vào", ipqc: "Trong sản xuất", oqc: "Thành phẩm" };

export default async function StockLotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, staff, db] = await Promise.all([params, requireStaff(), getDb()]);
  if (!UUID.test(id)) notFound();
  const d = await getStockLotDetail(db, id);
  if (!d) notFound();
  const lot = d.lot;
  const item = { baseUom: d.baseUom, displayUom: d.displayUom };
  const status = lot.qcStatus ?? d.productLotStatus ?? "pending";
  const expiresOn = lot.expiresOn ?? d.productLotExpiresOn ?? null;
  const onHand = d.balances.reduce((s, b) => s + b.qty, 0);
  const value = d.balances.reduce((s, b) => s + balanceValue(b), 0);
  const showValue = can(staff.role, "finance.view");
  const isMaterial = lot.qcStatus !== null && !lot.productLotId;
  // Khóa: quality.write; mở khóa: quality.approve (R-KHO-36)
  const canHold = isMaterial && (lot.qcStatus === "released" || lot.qcStatus === "pending") && can(staff.role, "quality.write");
  const canRelease = isMaterial && lot.qcStatus === "on_hold" && can(staff.role, "quality.approve");

  return (
    <>
      <Link href="/admin/kho/lo" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Lô
      </Link>
      <PageHeader
        title={`Lô ${lot.code}`}
        description={`${d.itemCode} · ${d.itemName} · ${ITEM_KIND_LABEL[d.itemKind]}`}
        actions={<Badge tone={LOT_STATUS_TONE[status]}>{LOT_STATUS_LABEL[status] ?? status}</Badge>}
      />
      <div className="stagger mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Số dư" value={q(onHand, item)} hint={`Nhập ban đầu ${q(lot.receivedQty, item)}`} />
        <Stat label="HSD" value={viDate(expiresOn) || "–"} hint={lot.manufacturedOn ? `NSX ${viDate(lot.manufacturedOn)}` : undefined} />
        <Stat label="Nhà cung cấp" value={d.supplierCode ?? "–"} hint={[d.supplierName, lot.supplierLotNo ? `lô NCC ${lot.supplierLotNo}` : null].filter(Boolean).join(" · ") || undefined} />
        {showValue ? <Stat label="Giá trị còn" value={formatVnd(value)} hint={`Giá trị nhập ${formatVnd(lot.receivedCost)}`} /> : <Stat label="Nguồn" value={d.source?.label ?? "–"} />}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="Nguồn và truy xuất">
          <ul className="space-y-1 text-sm">
            <li>
              Chứng từ tạo lô:{" "}
              {d.source?.href ? (
                <TapLink href={d.source.href} className="font-mono">
                  {d.source.label}
                </TapLink>
              ) : (
                d.source?.label ?? "–"
              )}
            </li>
            {d.productLotNo && (
              <li>
                Lô sản xuất:{" "}
                <TapLink href={`/admin/lo/${lot.productLotId}`} className="font-mono">
                  {d.productLotNo}
                </TapLink>
              </li>
            )}
            {lot.productionOrderId && <li>Từ lệnh sản xuất (xem ở mục Sản xuất)</li>}
            {lot.holdReason &&
              (lot.qcStatus === "released" ? <li>Ghi chú khi duyệt: {lot.holdReason}</li> : <li className="text-danger">Lý do giữ / loại: {lot.holdReason}</li>)}
          </ul>
        </Card>
        <Card title="Phiếu kiểm">
          {d.inspections.length ? (
            <ul className="space-y-1 text-sm">
              {d.inspections.map((i) => (
                <li key={i.id}>
                  <TapLink href={`/admin/chat-luong/phieu-kiem/${i.id}`} className="font-mono">
                    {i.code}
                  </TapLink>{" "}
                  · {STAGE_LABEL[i.stage] ?? i.stage} · {INSPECTION_LABEL[i.status] ?? i.status} · {formatDateTime(i.createdAt)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">Chưa có phiếu kiểm.</p>
          )}
        </Card>
      </div>

      {(canHold || canRelease || (onHand > 0 && can(staff.role, "inventory.write"))) && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {canHold && (
            <Card title="Khóa lô">
              <p className="mb-3 text-sm text-ink-soft">Lô bị khóa không xuất dùng được tới khi người duyệt chất lượng mở khóa.</p>
              <ActionForm action={lotHoldAction} submitLabel="Khóa lô" submitClassName="btn btn-outline" confirm="Khóa lô này?">
                <input type="hidden" name="id" value={lot.id} />
                <input type="hidden" name="hold" value="1" />
                <label className="block">
                  <span className="field-label">Lý do</span>
                  <input name="reason" required className="field" />
                </label>
              </ActionForm>
            </Card>
          )}
          {canRelease && (
            <Card title="Mở khóa lô">
              <ActionForm action={lotHoldAction} submitLabel="Mở khóa" confirm="Mở khóa, cho lô dùng lại?">
                <input type="hidden" name="id" value={lot.id} />
                <input type="hidden" name="hold" value="0" />
              </ActionForm>
            </Card>
          )}
          {onHand > 0 && can(staff.role, "inventory.write") && (
            <Card title="Xuất hủy">
              <p className="mb-3 text-sm text-ink-soft">Lô hỏng, hết hạn hoặc không đạt: lập phiếu xuất hủy có sẵn lô này.</p>
              <Link href={`/admin/kho/xuat/moi?lo=${lot.id}&loai=scrap`} className="btn btn-outline">
                Lập phiếu xuất hủy
              </Link>
            </Card>
          )}
        </div>
      )}

      <h2 className="eyebrow mb-3 text-[0.68rem]">Số dư theo vị trí</h2>
      <DataList
        rows={d.balances}
        rowKey={(b) => b.locationId}
        empty="Lô đã hết hàng."
        cols={[
          { label: "Vị trí", cell: (b) => `${b.warehouseCode}/${b.locationCode}` },
          { label: "Số lượng", cell: (b) => q(b.qty, item), className: "tabular-nums" },
          ...(showValue ? [{ label: "Giá trị", cell: (b: (typeof d.balances)[number]) => formatVnd(balanceValue(b)), className: "tabular-nums" }] : []),
        ]}
      />

      <div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="eyebrow text-[0.68rem]">Biến động</h2>
        <TapLink href={`/admin/kho/so-kho?lo=${encodeURIComponent(lot.code)}`} className="text-sm underline">
          Xem sổ kho
        </TapLink>
      </div>
      <DataList
        rows={d.movements}
        rowKey={(m) => m.id}
        empty="Chưa có biến động."
        cols={[
          { label: "Lúc", cell: (m) => formatDateTime(m.occurredAt) },
          { label: "Loại", cell: (m) => MOVE_TYPE_LABEL[m.type] },
          {
            label: "Chứng từ",
            cell: (m) => {
              const href = docHref(m.docType, m.docId);
              return href ? (
                <TapLink href={href} className="font-mono">
                  {m.docCode}
                </TapLink>
              ) : (
                m.docCode
              );
            },
          },
          { label: "Vị trí", cell: (m) => `${m.warehouseCode}/${m.locationCode}` },
          { label: "±", cell: (m) => `${m.qty > 0 ? "+" : ""}${q(m.qty, item)}`, className: "tabular-nums" },
          { label: "Số dư sau", cell: (m) => q(m.balanceAfter, item), className: "tabular-nums" },
          { label: "Ghi chú", cell: (m) => m.note || "–" },
        ]}
      />
    </>
  );
}
