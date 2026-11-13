import type { Metadata } from "next";
import Link from "next/link";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listChannels, listPriceLists } from "@/modules/sales/catalog";
import { CHANNEL_KIND_LABEL, formatBp, type ChannelKind } from "@/modules/sales/rules";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, Empty, PageHeader } from "../../_components/ui";
import { saveChannelAction } from "../actions";

export const metadata: Metadata = { title: "Kênh bán" };

type PriceListOpt = { id: string; code: string; name: string };
type ChannelLike = { code: string; name: string; feeRateBp: number; payoutDays: number; priceListId: string | null; isActive: boolean; sort: number; note: string | null };

function pct(bp: number) {
  return formatBp(bp).replace("%", "").trim();
}

function ChannelFields({ c, lists }: { c?: ChannelLike; lists: PriceListOpt[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="field-label">Tên kênh</span>
        <input name="name" required defaultValue={c?.name} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Bảng giá mặc định</span>
        <select name="priceListId" defaultValue={c?.priceListId ?? ""} className="field min-h-11">
          <option value="">Giá niêm yết</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} · {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="field-label">Phí nền tảng (%)</span>
        <input name="feeRate" inputMode="decimal" defaultValue={c ? pct(c.feeRateBp) : "0"} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Số ngày tiền về</span>
        <input name="payoutDays" inputMode="numeric" defaultValue={c?.payoutDays ?? 0} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Thứ tự</span>
        <input name="sort" inputMode="numeric" defaultValue={c?.sort ?? 0} className="field" />
      </label>
      <label className="flex min-h-11 items-center gap-3 self-end">
        <input type="checkbox" name="isActive" defaultChecked={c ? c.isActive : true} className="h-5 w-5" />
        <span className="text-sm">Đang dùng</span>
      </label>
      <label className="block sm:col-span-2">
        <span className="field-label">Ghi chú</span>
        <input name="note" defaultValue={c?.note ?? ""} className="field" />
      </label>
    </div>
  );
}

// Kênh bán (R-BH-8): phí nền tảng, số ngày tiền về, bảng giá mặc định. Sửa cần quyền sửa giá.
export default async function ChannelsPage() {
  const [staff, channels, lists] = await Promise.all([requireStaff(), listChannels(), listPriceLists()]);
  const pricing = can(staff.role, "sales.pricing");
  const activeLists = lists.filter((l) => l.isActive);

  return (
    <>
      <Link href="/admin/ban-hang" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Bán hàng
      </Link>
      <PageHeader title="Kênh bán" description="Phí nền tảng dùng để tính lợi nhuận góp; số ngày tiền về dùng cho công nợ sàn. Mã kênh không đổi sau khi tạo." />
      {channels.length === 0 && <Empty>Chưa có kênh nào.</Empty>}
      <div className="space-y-4">
        {channels.map((c) => (
          <Card
            key={c.code}
            title={`${c.code} · ${c.name}`}
            actions={<Badge tone={c.isActive ? "green" : "neutral"}>{c.isActive ? "Đang dùng" : "Tạm tắt"}</Badge>}
          >
            <p className="mb-3 text-sm text-ink-soft">
              {CHANNEL_KIND_LABEL[c.kind as ChannelKind]} · phí {formatBp(c.feeRateBp)} · tiền về sau {c.payoutDays} ngày · tháng này {c.month.orders} đơn, {formatVnd(c.month.revenue)}
            </p>
            {pricing ? (
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">Sửa kênh</summary>
                <ActionForm action={saveChannelAction} submitLabel="Lưu kênh" className="mt-3 space-y-4">
                  <input type="hidden" name="mode" value="update" />
                  <input type="hidden" name="code" value={c.code} />
                  <ChannelFields c={c} lists={activeLists} />
                </ActionForm>
              </details>
            ) : null}
          </Card>
        ))}
      </div>

      {pricing ? (
        <Card title="Thêm kênh" className="mt-6">
          <ActionForm action={saveChannelAction} submitLabel="Tạo kênh" resetOnSuccess className="space-y-4">
            <input type="hidden" name="mode" value="create" />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Mã kênh</span>
                <input name="code" required placeholder="SHOPEE, ZALO…" className="field font-mono uppercase" />
              </label>
              <label className="block">
                <span className="field-label">Loại</span>
                <select name="kind" defaultValue="marketplace" className="field min-h-11">
                  {(Object.keys(CHANNEL_KIND_LABEL) as ChannelKind[])
                    .filter((k) => k !== "own_web")
                    .map((k) => (
                      <option key={k} value={k}>
                        {CHANNEL_KIND_LABEL[k]}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <ChannelFields lists={activeLists} />
          </ActionForm>
        </Card>
      ) : (
        <p className="mt-6 text-sm text-ink-soft">Sửa kênh, phí và bảng giá cần quyền sửa giá (chủ cửa hàng).</p>
      )}
    </>
  );
}
