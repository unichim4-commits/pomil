import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { ORDER_STATUS_LABEL } from "@/modules/orders/rules";
import { getPackingView, type LotCandidate } from "@/modules/sales/packing";
import { formatIsoDate } from "@/modules/sales/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, ORDER_TONE, PageHeader } from "../../../_components/ui";
import { packAction } from "../../actions";

export const metadata: Metadata = { title: "Đóng gói đơn" };

// Gộp các vị trí của cùng một lô kho: người gói chọn lô, hệ thống lấy vị trí
function byLot(cands: LotCandidate[]) {
  const m = new Map<string, { stockLotId: string; code: string; expiresOn: string | null; qty: number; usable: boolean; locations: string[] }>();
  for (const c of cands) {
    const cur = m.get(c.stockLotId) ?? { stockLotId: c.stockLotId, code: c.code, expiresOn: c.expiresOn, qty: 0, usable: c.usable, locations: [] };
    cur.qty += c.qty;
    cur.usable = cur.usable && c.usable;
    if (!cur.locations.includes(c.locationCode)) cur.locations.push(c.locationCode);
    m.set(c.stockLotId, cur);
  }
  return [...m.values()].sort((a, b) => (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999"));
}

// R-BH-13: tích kiểm từng dòng → xuất kho FEFO (hoặc lô chọn tay) → đơn sang Đang đóng gói
export default async function PackOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, view] = await Promise.all([requireStaff(), getPackingView(id)]);
  if (!view) notFound();
  const { order, lines, packed } = view;
  const canWrite = can(staff.role, "sales.write");
  const packable = view.awaitsPacking;
  const hasTracked = lines.some((l) => l.track);
  const short = lines.filter((l) => l.track && l.suggestion === null && l.available !== null);

  return (
    <>
      <Link href="/admin/ban-hang/dong-goi" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Đóng gói
      </Link>
      <PageHeader
        title={`Đóng gói ${order.code}`}
        description={`${order.recipientName} · ${order.province}`}
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <Badge tone={ORDER_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
            <Link href={`/admin/don-hang/${order.id}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
              Trang đơn
            </Link>
          </div>
        }
      />

      {!packable ? (
        <Card>
          <p className="text-sm">{packed ? (order.stockIssuedAt ? "Đơn đã xuất kho và đóng gói." : "Đơn đã đóng gói.") : "Đơn không ở bước đóng gói."}</p>
          <div className="mt-3 flex flex-wrap gap-4">
            <Link href={`/admin/ban-hang/dong-goi/${order.id}/phieu`} target="_blank" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
              In phiếu đóng gói
            </Link>
            <Link href={`/admin/ban-hang/dong-goi/${order.id}/nhan`} target="_blank" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
              In nhãn giao
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-line text-sm">
            {lines.map((l) => (
              <li key={l.id} className="flex min-h-11 items-center justify-between gap-3">
                <span>
                  {l.productName} × {l.quantity}
                </span>
                <span className="font-mono">{l.lotNo ?? "—"}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : !canWrite ? (
        <Card>
          <p className="text-sm text-ink-soft">Tài khoản của bạn chỉ xem, không đóng gói được.</p>
        </Card>
      ) : (
        <ActionForm action={packAction} submitLabel={hasTracked ? "Xuất kho và đóng gói" : "Đã đóng gói"} pendingLabel="Đang xuất kho…" className="space-y-6">
          <input type="hidden" name="orderId" value={order.id} />
          {short.length > 0 && (
            <p className="bg-[#f1e2c4] p-3 text-sm text-[#6b4e12]" role="alert">
              Thiếu hàng dùng được trong kho thành phẩm: {short.map((l) => `${l.productName} (còn ${l.available}, cần ${l.quantity})`).join("; ")}. Nhập thêm hàng hoặc gỡ giữ lô trước khi xuất.
            </p>
          )}
          <Card title="Kiểm từng dòng">
            <ul className="divide-y divide-line">
              {lines.map((l) => (
                <li key={l.id} className="py-3 first:pt-0">
                  <label className="flex min-h-11 items-center gap-3">
                    <input type="checkbox" name="checked" value={l.id} className="size-5 shrink-0" />
                    <span className="flex-1">
                      Đã kiểm đúng <span className="font-medium">{l.productName}</span> × {l.quantity}
                    </span>
                  </label>
                  {l.track ? (
                    l.suggestion ? (
                      <p className="ml-8 text-sm text-ink-soft">
                        Gợi ý:{" "}
                        {l.suggestion.map((s) => (
                          <span key={s.stockLotId} className="mr-3 inline-block">
                            <span className="font-mono text-graphite">{s.code}</span> × {s.qty} · {s.locations.join(", ")}
                            {s.expiresOn ? ` · hạn ${formatIsoDate(s.expiresOn)}` : ""}
                          </span>
                        ))}
                      </p>
                    ) : null
                  ) : (
                    <p className="ml-8 text-sm text-ink-soft">
                      Chưa quản lý theo kho · lô {l.lotNo ? <span className="font-mono">{l.lotNo}</span> : "chưa gán (gán ở trang đơn)"}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {hasTracked && (
            <Card title="Lô xuất">
              <fieldset className="space-y-2">
                <legend className="sr-only">Cách chọn lô</legend>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="radio" name="lotMode" value="fefo" defaultChecked className="size-5" /> Theo gợi ý (hết hạn trước xuất trước)
                </label>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="radio" name="lotMode" value="manual" className="size-5" /> Chọn lô tay (nhập số chai lấy ở từng lô)
                </label>
              </fieldset>
              <div className="mt-4 space-y-4">
                {lines
                  .filter((l) => l.track)
                  .map((l) => (
                    <div key={l.id}>
                      <p className="text-sm font-medium">
                        {l.productName} · cần {l.quantity}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {byLot(l.candidates).map((c) => (
                          <li key={c.stockLotId} className="flex flex-wrap items-center gap-3 text-sm">
                            <input
                              name={`pick:${l.id}:${c.stockLotId}`}
                              inputMode="numeric"
                              defaultValue=""
                              disabled={!c.usable}
                              className="field min-h-11 w-20"
                              aria-label={`Số chai lấy ở lô ${c.code}`}
                            />
                            <span className="font-mono">{c.code}</span>
                            <span className="text-ink-soft">
                              còn {c.qty} · {c.locations.join(", ")}
                              {c.expiresOn ? ` · hạn ${formatIsoDate(c.expiresOn)}` : ""}
                            </span>
                            {!c.usable && <Badge tone="red">Không xuất được</Badge>}
                          </li>
                        ))}
                        {l.candidates.length === 0 && <li className="text-sm text-danger">Không có lô nào trong kho thành phẩm.</li>}
                      </ul>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </ActionForm>
      )}
    </>
  );
}
