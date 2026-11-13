import type { Metadata } from "next";
import Link from "next/link";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listBundles, listChannels, listPriceLists, listVouchers } from "@/modules/sales/catalog";
import { manualOrderFormData } from "@/modules/sales/orders";
import { formatBp, formatIsoDate, isoDateVn, PRICE_LIST_KIND_LABEL, type PriceListKind } from "@/modules/sales/rules";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, Empty, PageHeader, Table } from "../../_components/ui";
import { saveBundleAction, savePriceListAction, saveVoucherAction } from "../actions";

export const metadata: Metadata = { title: "Bảng giá và khuyến mãi" };

const BUNDLE_ROWS = 4;

type Opt = { code: string; name: string };
type ProductOpt = { id: string; name: string; price: number };
type BundleLike = { id: string; code: string; name: string; price: number; channelCode: string | null; isActive: boolean; note: string | null; items: { productId: string; qty: number }[] };
type VoucherLike = {
  id: string;
  code: string;
  kind: string;
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  channelCode: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  usageLimit: number | null;
  isActive: boolean;
};

function ChannelSelect({ value, channels, label = "Kênh áp dụng" }: { value: string | null | undefined; channels: Opt[]; label?: string }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select name="channelCode" defaultValue={value ?? ""} className="field min-h-11">
        <option value="">Mọi kênh</option>
        {channels.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function BundleFields({ b, channels, products }: { b?: BundleLike; channels: Opt[]; products: ProductOpt[] }) {
  return (
    <div className="space-y-4">
      {b && <input type="hidden" name="bundleId" value={b.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Mã combo</span>
          <input name="code" required defaultValue={b?.code} className="field font-mono uppercase" />
        </label>
        <label className="block">
          <span className="field-label">Tên combo</span>
          <input name="name" required defaultValue={b?.name} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Giá combo (đ)</span>
          <input name="price" inputMode="numeric" required defaultValue={b?.price} className="field" />
        </label>
        <ChannelSelect value={b?.channelCode} channels={channels} />
      </div>
      <div className="space-y-2">
        <p className="field-label">Thành phần</p>
        {Array.from({ length: BUNDLE_ROWS }, (_, i) => {
          const it = b?.items[i];
          return (
            <div key={i} className="grid grid-cols-[1fr_5rem] gap-2">
              <select name="bundleProductId" defaultValue={it?.productId ?? ""} className="field min-h-11 min-w-0" aria-label={`Sản phẩm ${i + 1}`}>
                <option value="">— Sản phẩm —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatVnd(p.price)})
                  </option>
                ))}
              </select>
              <input name="bundleProductQty" inputMode="numeric" defaultValue={it?.qty ?? 1} className="field min-h-11" aria-label={`Số lượng ${i + 1}`} />
            </div>
          );
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Ghi chú</span>
          <input name="note" defaultValue={b?.note ?? ""} className="field" />
        </label>
        <label className="flex min-h-11 items-center gap-3 self-end">
          <input type="checkbox" name="isActive" defaultChecked={b ? b.isActive : true} className="h-5 w-5" />
          <span className="text-sm">Đang bán</span>
        </label>
      </div>
    </div>
  );
}

function VoucherFields({ v, channels }: { v?: VoucherLike; channels: Opt[] }) {
  const isPercent = v ? v.kind === "percent" : true;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {v && <input type="hidden" name="voucherId" value={v.id} />}
      <label className="block">
        <span className="field-label">Mã</span>
        <input name="code" required defaultValue={v?.code} className="field font-mono uppercase" />
      </label>
      <label className="block">
        <span className="field-label">Kiểu giảm</span>
        <select name="kind" defaultValue={isPercent ? "percent" : "amount"} className="field min-h-11">
          <option value="percent">Theo % (nhập số %)</option>
          <option value="amount">Số tiền (nhập đ)</option>
        </select>
      </label>
      <label className="block">
        <span className="field-label">Mức giảm</span>
        <input name="value" inputMode="decimal" required defaultValue={v ? (isPercent ? formatBp(v.value).replace("%", "").trim() : v.value) : ""} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Giảm tối đa (đ, để trống nếu không giới hạn)</span>
        <input name="maxDiscount" inputMode="numeric" defaultValue={v?.maxDiscount ?? ""} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Đơn tối thiểu (đ)</span>
        <input name="minOrder" inputMode="numeric" defaultValue={v?.minOrder ?? 0} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Số lượt dùng (để trống nếu không giới hạn)</span>
        <input name="usageLimit" inputMode="numeric" defaultValue={v?.usageLimit ?? ""} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Từ ngày</span>
        <input name="validFrom" type="date" defaultValue={v?.validFrom ? isoDateVn(v.validFrom) : ""} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Đến hết ngày</span>
        <input name="validTo" type="date" defaultValue={v?.validTo ? isoDateVn(v.validTo) : ""} className="field" />
      </label>
      <ChannelSelect value={v?.channelCode} channels={channels} />
      <label className="flex min-h-11 items-center gap-3 self-end">
        <input type="checkbox" name="isActive" defaultChecked={v ? v.isActive : true} className="h-5 w-5" />
        <span className="text-sm">Đang dùng</span>
      </label>
    </div>
  );
}

// Bảng giá, combo, mã giảm giá (R-BH-1…R-BH-6). Sửa cần quyền sửa giá.
export default async function PricingPage() {
  const [staff, lists, bundles, vouchers, channelRows, form] = await Promise.all([requireStaff(), listPriceLists(), listBundles(), listVouchers(), listChannels(), manualOrderFormData()]);
  const pricing = can(staff.role, "sales.pricing");
  const channels = channelRows.map((c) => ({ code: c.code, name: c.name }));
  const now = new Date();

  return (
    <>
      <Link href="/admin/ban-hang" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Bán hàng
      </Link>
      <PageHeader title="Bảng giá và khuyến mãi" description="Giá đơn tay lấy theo thứ tự: giá đại lý, bảng giá khuyến mãi còn hạn, bảng giá của kênh, rồi giá niêm yết. Đổi giá được ghi lịch sử." />

      <Card title="Bảng giá">
        {lists.length === 0 ? (
          <p className="text-sm text-ink-soft">Chưa có bảng giá.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Bảng giá</th>
                <th>Loại</th>
                <th>Kênh</th>
                <th>Hiệu lực</th>
                <th>Dòng giá</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/admin/ban-hang/bang-gia/${l.id}`} className="underline-offset-4 hover:underline">
                      {l.name}
                    </Link>
                    <span className="block font-mono text-xs text-ink-soft">{l.code}</span>
                  </td>
                  <td>{PRICE_LIST_KIND_LABEL[l.kind as PriceListKind]}</td>
                  <td>{l.channelCode ?? "Mọi kênh"}</td>
                  <td className="text-sm">{l.validFrom || l.validTo ? `${l.validFrom ? formatIsoDate(l.validFrom) : "…"} → ${l.validTo ? formatIsoDate(l.validTo) : "…"}` : "Không giới hạn"}</td>
                  <td className="tabular-nums">{l.itemCount}</td>
                  <td>
                    <Badge tone={l.isActive ? "green" : "neutral"}>{l.isActive ? "Đang dùng" : "Tạm tắt"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pricing && (
          <details className="mt-4 border-t border-line pt-4">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">Thêm bảng giá</summary>
            <ActionForm action={savePriceListAction} submitLabel="Tạo bảng giá" className="mt-3 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Mã</span>
                  <input name="code" required className="field font-mono uppercase" />
                </label>
                <label className="block">
                  <span className="field-label">Tên</span>
                  <input name="name" required className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Loại</span>
                  <select name="kind" defaultValue="retail" className="field min-h-11">
                    {(Object.keys(PRICE_LIST_KIND_LABEL) as PriceListKind[]).map((k) => (
                      <option key={k} value={k}>
                        {PRICE_LIST_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <ChannelSelect value={null} channels={channels} />
                <label className="block">
                  <span className="field-label">Từ ngày</span>
                  <input name="validFrom" type="date" className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Đến ngày</span>
                  <input name="validTo" type="date" className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Độ ưu tiên (khuyến mãi trùng thì lấy số lớn)</span>
                  <input name="priority" inputMode="numeric" defaultValue="0" className="field" />
                </label>
                <label className="flex min-h-11 items-center gap-3 self-end">
                  <input type="checkbox" name="isActive" defaultChecked className="h-5 w-5" />
                  <span className="text-sm">Đang dùng</span>
                </label>
              </div>
              <label className="block">
                <span className="field-label">Ghi chú</span>
                <input name="note" className="field" />
              </label>
            </ActionForm>
          </details>
        )}
      </Card>

      <Card title="Combo" className="mt-6">
        {bundles.length === 0 ? (
          <p className="text-sm text-ink-soft">Chưa có combo.</p>
        ) : (
          <ul className="divide-y divide-line">
            {bundles.map((b) => {
              const parts = b.items.reduce((s, i) => s + i.price * i.qty, 0);
              return (
                <li key={b.id} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{b.code}</span>
                    <span>{b.name}</span>
                    <span className="tabular-nums">{formatVnd(b.price)}</span>
                    {parts > b.price && <span className="text-xs text-ink-soft">tiết kiệm {formatVnd(parts - b.price)}</span>}
                    <Badge tone={b.isActive ? "green" : "neutral"}>{b.isActive ? "Đang bán" : "Tạm tắt"}</Badge>
                  </div>
                  <p className="text-sm text-ink-soft">
                    {b.items.map((i) => `${i.name} × ${i.qty}`).join(", ") || "Chưa có thành phần"}
                    {b.channelCode ? ` · chỉ kênh ${b.channelCode}` : ""}
                  </p>
                  {pricing && (
                    <details className="mt-2">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">Sửa combo</summary>
                      <ActionForm action={saveBundleAction} submitLabel="Lưu combo" className="mt-3 space-y-4">
                        <BundleFields b={b} channels={channels} products={form.products} />
                      </ActionForm>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {pricing && (
          <details className="mt-4 border-t border-line pt-4">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">Thêm combo</summary>
            <ActionForm action={saveBundleAction} submitLabel="Tạo combo" resetOnSuccess className="mt-3 space-y-4">
              <BundleFields channels={channels} products={form.products} />
            </ActionForm>
          </details>
        )}
      </Card>

      <section id="ma-giam-gia" className="mt-6 scroll-mt-6">
        <Card title="Mã giảm giá">
          {vouchers.length === 0 ? (
            <p className="text-sm text-ink-soft">Chưa có mã giảm giá.</p>
          ) : (
            <ul className="divide-y divide-line">
              {vouchers.map((v) => {
                const expired = v.validTo !== null && v.validTo < now;
                const used = v.usageLimit !== null && v.usedCount >= v.usageLimit;
                return (
                  <li key={v.id} className="py-3 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{v.code}</span>
                      <span>giảm {v.kind === "percent" ? formatBp(v.value) : formatVnd(v.value)}</span>
                      {v.maxDiscount !== null && <span className="text-sm text-ink-soft">tối đa {formatVnd(v.maxDiscount)}</span>}
                      {!v.isActive ? <Badge tone="neutral">Tạm tắt</Badge> : expired ? <Badge tone="red">Hết hạn</Badge> : used ? <Badge tone="amber">Hết lượt</Badge> : <Badge tone="green">Đang dùng</Badge>}
                    </div>
                    <p className="text-sm text-ink-soft">
                      Đơn từ {formatVnd(v.minOrder)} · đã dùng {v.usedCount}
                      {v.usageLimit !== null ? `/${v.usageLimit}` : ""} lượt
                      {v.validTo ? ` · hết hạn ${formatIsoDate(isoDateVn(v.validTo))}` : ""}
                      {v.channelCode ? ` · chỉ kênh ${v.channelCode}` : ""}
                    </p>
                    {pricing && (
                      <details className="mt-2">
                        <summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">Sửa mã</summary>
                        <ActionForm action={saveVoucherAction} submitLabel="Lưu mã" className="mt-3 space-y-4">
                          <VoucherFields v={v} channels={channels} />
                        </ActionForm>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {pricing && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">Thêm mã giảm giá</summary>
              <ActionForm action={saveVoucherAction} submitLabel="Tạo mã" resetOnSuccess className="mt-3 space-y-4">
                <VoucherFields channels={channels} />
              </ActionForm>
            </details>
          )}
        </Card>
      </section>
      {!pricing && <p className="mt-6 text-sm text-ink-soft">Sửa bảng giá, combo và mã giảm giá cần quyền sửa giá (chủ cửa hàng).</p>}
      {lists.length === 0 && bundles.length === 0 && vouchers.length === 0 && !pricing && <Empty>Chưa có dữ liệu giá.</Empty>}
    </>
  );
}
