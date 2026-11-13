import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getPriceList, listChannels } from "@/modules/sales/catalog";
import { manualOrderFormData } from "@/modules/sales/orders";
import { formatIsoDate, PRICE_LIST_KIND_LABEL, type PriceListKind } from "@/modules/sales/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader, Table } from "../../../_components/ui";
import { deletePriceItemAction, priceItemAction, savePriceListAction } from "../../actions";

export const metadata: Metadata = { title: "Bảng giá" };

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, data, channels, form] = await Promise.all([requireStaff(), getPriceList(id), listChannels(), manualOrderFormData()]);
  if (!data) notFound();
  const { list: l, items } = data;
  const pricing = can(staff.role, "sales.pricing");

  return (
    <>
      <Link href="/admin/ban-hang/bang-gia" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Bảng giá
      </Link>
      <PageHeader
        title={l.name}
        description={`${l.code} · ${PRICE_LIST_KIND_LABEL[l.kind as PriceListKind]} · ${l.channelCode ?? "mọi kênh"}${l.validFrom || l.validTo ? ` · ${l.validFrom ? formatIsoDate(l.validFrom) : "…"} → ${l.validTo ? formatIsoDate(l.validTo) : "…"}` : ""}`}
        actions={<Badge tone={l.isActive ? "green" : "neutral"}>{l.isActive ? "Đang dùng" : "Tạm tắt"}</Badge>}
      />

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Dòng giá">
          {items.length === 0 ? (
            <p className="text-sm text-ink-soft">Chưa có dòng giá. Sản phẩm không có trong bảng dùng giá niêm yết.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Sản phẩm</th>
                  <th>Từ (chai)</th>
                  <th>Đơn giá</th>
                  <th>Niêm yết</th>
                  {pricing && <th />}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      {it.productName}
                      <span className="block font-mono text-xs text-ink-soft">{it.productCode}</span>
                    </td>
                    <td className="tabular-nums">{it.minQty}</td>
                    <td className="tabular-nums">{formatVnd(it.unitPrice)}</td>
                    <td className="tabular-nums text-ink-soft">{formatVnd(it.retail)}</td>
                    {pricing && (
                      <td>
                        <ActionForm action={deletePriceItemAction} submitLabel="Xóa" submitClassName="btn btn-outline min-h-11" confirm="Xóa dòng giá này?" inline>
                          <input type="hidden" name="itemId" value={it.id} />
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {pricing && (
            <ActionForm action={priceItemAction} submitLabel="Lưu giá" resetOnSuccess className="mt-4 space-y-4 border-t border-line pt-4">
              <input type="hidden" name="priceListId" value={l.id} />
              <p className="text-sm text-ink-soft">Cùng sản phẩm và cùng mức số lượng thì ghi đè giá cũ (có lưu lịch sử).</p>
              <div className="grid gap-4 sm:grid-cols-[1fr_6rem_9rem]">
                <label className="block min-w-0">
                  <span className="field-label">Sản phẩm</span>
                  <select name="productId" required defaultValue="" className="field min-h-11">
                    <option value="">— Chọn —</option>
                    {form.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatVnd(p.price)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Từ (chai)</span>
                  <input name="minQty" inputMode="numeric" defaultValue="1" className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Đơn giá (đ)</span>
                  <input name="unitPrice" inputMode="numeric" required className="field" />
                </label>
              </div>
            </ActionForm>
          )}
        </Card>

        {pricing ? (
          <Card title="Thông tin bảng giá">
            <ActionForm action={savePriceListAction} submitLabel="Lưu" className="space-y-4">
              <input type="hidden" name="priceListId" value={l.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Mã</span>
                  <input name="code" required defaultValue={l.code} className="field font-mono uppercase" />
                </label>
                <label className="block">
                  <span className="field-label">Tên</span>
                  <input name="name" required defaultValue={l.name} className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Loại</span>
                  <select name="kind" defaultValue={l.kind} className="field min-h-11">
                    {(Object.keys(PRICE_LIST_KIND_LABEL) as PriceListKind[]).map((k) => (
                      <option key={k} value={k}>
                        {PRICE_LIST_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Kênh áp dụng</span>
                  <select name="channelCode" defaultValue={l.channelCode ?? ""} className="field min-h-11">
                    <option value="">Mọi kênh</option>
                    {channels.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Từ ngày</span>
                  <input name="validFrom" type="date" defaultValue={l.validFrom ?? ""} className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Đến ngày</span>
                  <input name="validTo" type="date" defaultValue={l.validTo ?? ""} className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Độ ưu tiên</span>
                  <input name="priority" inputMode="numeric" defaultValue={l.priority} className="field" />
                </label>
                <label className="flex min-h-11 items-center gap-3 self-end">
                  <input type="checkbox" name="isActive" defaultChecked={l.isActive} className="h-5 w-5" />
                  <span className="text-sm">Đang dùng</span>
                </label>
              </div>
              <label className="block">
                <span className="field-label">Ghi chú</span>
                <input name="note" defaultValue={l.note ?? ""} className="field" />
              </label>
            </ActionForm>
          </Card>
        ) : (
          <Card title="Thông tin bảng giá">
            <p className="text-sm text-ink-soft">Sửa bảng giá cần quyền sửa giá (chủ cửa hàng).</p>
            {l.note && <p className="mt-2 text-sm">{l.note}</p>}
          </Card>
        )}
      </div>
    </>
  );
}
