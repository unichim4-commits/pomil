import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { products } from "@/db/schema";
import { formatDateTime, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { balanceBucket, balanceValue, docHref, getItemDetail, listSuppliers, listWarehouses } from "@/modules/inventory/admin";
import { vnToday } from "@/modules/numbering/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader, Stat } from "../../../_components/ui";
import { DataList, TapLink } from "../../_components/data-list";
import { InventoryTrackingBlock } from "../../_components/tracking-block";
import { saveFinishedItemAction } from "../../actions";
import { q, qPlain, viDate } from "../../_lib/fmt";
import { ITEM_KIND_LABEL, LOT_STATUS_LABEL, LOT_STATUS_TONE, MOVE_TYPE_LABEL } from "../../_lib/labels";
import { ItemForm } from "../item-form";

export const metadata: Metadata = { title: "Hàng hóa" };

const BUCKET_LABEL = { available: "Khả dụng", quarantine: "Cách ly", rejected: "Không đạt", expired: "Hết hạn" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, staff, db] = await Promise.all([params, requireStaff(), getDb()]);
  if (!UUID.test(id)) notFound();
  const today = vnToday();
  const detail = await getItemDetail(db, id, today);
  if (!detail) notFound();
  const { item, stock, balances, movements } = detail;
  const showValue = can(staff.role, "finance.view");
  const canWrite = can(staff.role, "inventory.write");
  const [sups, whs] = await Promise.all([listSuppliers(db), listWarehouses(db)]);
  const [product] = item.productId ? await db.select({ id: products.id, trackInventory: products.trackInventory }).from(products).where(eq(products.id, item.productId)) : [];
  const value = balances.reduce((s, b) => s + balanceValue(b), 0);
  type B = (typeof balances)[number];

  return (
    <>
      <Link href="/admin/kho/hang-hoa" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Hàng hóa
      </Link>
      <PageHeader
        title={`${item.code} · ${item.name}`}
        description={`${ITEM_KIND_LABEL[item.kind]}${item.spec ? ` · ${item.spec}` : ""}${item.storageCondition ? ` · Bảo quản: ${item.storageCondition}` : ""}`}
        actions={!item.isActive && <Badge>Ngừng dùng</Badge>}
      />
      <div className="stagger mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Khả dụng" value={q(stock.available, item)} hint={item.minStock !== null ? `Tối thiểu ${q(item.minStock, item)}` : undefined} />
        <Stat label="Cách ly" value={q(stock.quarantine, item)} hint={`Không đạt ${q(stock.rejected, item)} · hết hạn ${q(stock.expired, item)}`} />
        <Stat
          label={item.kind === "finished" ? "Đang giữ cho đơn" : "Đã cam kết cho lệnh SX"}
          value={q(item.kind === "finished" ? stock.reserved : stock.committed, item)}
          hint={`Tồn hiện tại ${q(stock.onHand, item)}`}
        />
        {showValue ? <Stat label="Giá trị tồn" value={formatVnd(value)} /> : <Stat label="Tồn hiện tại" value={q(stock.onHand, item)} />}
      </div>

      {product && (
        <div className="mb-6 max-w-2xl">
          <InventoryTrackingBlock productId={product.id} tracked={product.trackInventory} role={staff.role} itemId={null} />
        </div>
      )}

      <h2 className="eyebrow mb-3 text-[0.68rem]">Tồn theo lô và vị trí</h2>
      <DataList
        rows={balances}
        rowKey={(b) => `${b.locationId}:${b.stockLotId}`}
        empty="Hàng chưa có tồn."
        cols={[
          {
            label: "Lô",
            cell: (b) => (
              <TapLink href={`/admin/kho/lo/${b.stockLotId}`} className="font-mono">
                {b.lotCode}
              </TapLink>
            ),
          },
          { label: "Vị trí", cell: (b) => `${b.warehouseCode}/${b.locationCode}` },
          { label: "Số lượng", cell: (b) => q(b.qty, item), className: "tabular-nums" },
          {
            label: "Trạng thái",
            cell: (b) => {
              const st = b.qcStatus ?? b.productLotStatus ?? "pending";
              const bucket = balanceBucket(b, today);
              return (
                <span className="flex flex-wrap gap-1">
                  <Badge tone={LOT_STATUS_TONE[st]}>{LOT_STATUS_LABEL[st]}</Badge>
                  {(bucket === "rejected" || bucket === "expired") && <Badge tone="red">{BUCKET_LABEL[bucket]}</Badge>}
                </span>
              );
            },
          },
          { label: "HSD", cell: (b) => viDate(b.expiresOn) || "–" },
          ...(showValue ? [{ label: "Giá trị", cell: (b: B) => formatVnd(balanceValue(b)), className: "tabular-nums" }] : []),
        ]}
      />

      <div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="eyebrow text-[0.68rem]">Biến động gần đây</h2>
        <TapLink href={`/admin/kho/so-kho?hang=${item.id}`} className="text-sm underline">
          Xem sổ kho
        </TapLink>
      </div>
      <DataList
        rows={movements}
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
          { label: "Lô", cell: (m) => <span className="font-mono">{m.lotCode}</span> },
          { label: "Vị trí", cell: (m) => `${m.warehouseCode}/${m.locationCode}` },
          {
            label: "±",
            cell: (m) => (
              <span className={m.qty < 0 ? "text-danger" : ""}>
                {m.qty > 0 ? "+" : ""}
                {q(m.qty, item)}
              </span>
            ),
            className: "tabular-nums",
          },
          { label: "Số dư sau", cell: (m) => q(m.balanceAfter, item), className: "tabular-nums" },
        ]}
      />

      {canWrite && (
        <div className="mt-8 max-w-3xl">
          {item.kind === "finished" ? (
            <Card title="Thông tin kho của hàng thành phẩm">
              <p className="mb-4 text-sm text-ink-soft">Mã và tên theo sản phẩm, sửa ở trang sản phẩm.</p>
              <ActionForm action={saveFinishedItemAction} submitLabel="Lưu">
                <input type="hidden" name="id" value={item.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Tồn tối thiểu (chai)</span>
                    <input name="minStock" inputMode="decimal" defaultValue={item.minStock !== null ? qPlain(item.minStock, item) : ""} className="field" />
                  </label>
                  <label className="block">
                    <span className="field-label">Nhóm tự do</span>
                    <input name="groupName" defaultValue={item.groupName} className="field" />
                  </label>
                  <label className="block">
                    <span className="field-label">Quy cách</span>
                    <input name="spec" defaultValue={item.spec} className="field" />
                  </label>
                  <label className="block">
                    <span className="field-label">Điều kiện bảo quản</span>
                    <input name="storageCondition" defaultValue={item.storageCondition} className="field" />
                  </label>
                </div>
                <label className="block">
                  <span className="field-label">Ghi chú</span>
                  <textarea name="note" defaultValue={item.note ?? ""} className="field" />
                </label>
              </ActionForm>
            </Card>
          ) : (
            <Card title="Sửa hàng hóa">
              <ItemForm item={item} supplierList={sups} warehouseList={whs} canWrite />
            </Card>
          )}
        </div>
      )}
    </>
  );
}
