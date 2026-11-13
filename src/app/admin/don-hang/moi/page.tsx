import type { Metadata } from "next";
import Link from "next/link";
import { formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { manualOrderFormData } from "@/modules/sales/orders";
import { CHANNEL_PAYMENTS, CHANNEL_KIND_LABEL, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/modules/sales/rules";
import { ActionForm } from "../../_components/action-form";
import { Card, Empty, PageHeader } from "../../_components/ui";
import { createOrderAction } from "../../ban-hang/actions";

export const metadata: Metadata = { title: "Tạo đơn" };

const LINE_ROWS = 6;
const BUNDLE_ROWS = 2;
const METHODS: PaymentMethod[] = ["cod", "bank_transfer", "cash", "platform", "credit"];

// Đơn tay cho mọi kênh trừ WEB (R-BH-7). Giá tính lại trên máy chủ theo bảng giá (R-BH-1…R-BH-6).
export default async function NewOrderPage() {
  const [staff, data] = await Promise.all([requireStaff(), manualOrderFormData()]);
  if (!can(staff.role, "sales.write")) return <Empty>Tài khoản của bạn không có quyền tạo đơn.</Empty>;
  const pricing = can(staff.role, "sales.pricing");

  return (
    <>
      <Link href="/admin/don-hang" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Đơn hàng
      </Link>
      <PageHeader title="Tạo đơn tay" description="Đơn từ sàn, Zalo, Facebook, đại lý hoặc bán trực tiếp. Giá lấy theo bảng giá của kênh hoặc đại lý; dòng để trống được bỏ qua." />
      {data.channels.length === 0 ? (
        <Empty>Chưa có kênh bán nào ngoài web. Thêm kênh ở mục Bán hàng → Kênh.</Empty>
      ) : (
        <ActionForm action={createOrderAction} submitLabel="Tạo đơn" pendingLabel="Đang tạo…" className="space-y-6" noValidate>
          <Card title="Kênh và thanh toán">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Kênh</span>
                <select name="channelCode" required className="field min-h-11">
                  {data.channels.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} · {CHANNEL_KIND_LABEL[c.kind as keyof typeof CHANNEL_KIND_LABEL] ?? c.kind}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Thanh toán</span>
                <select name="paymentMethod" className="field min-h-11">
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Đại lý (đơn kênh đại lý)</span>
                <select name="dealerId" className="field min-h-11">
                  <option value="">Không</option>
                  {data.dealers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} · {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Mã đơn bên ngoài (mã sàn)</span>
                <input name="externalRef" className="field font-mono" />
              </label>
            </div>
            <p className="mt-3 text-xs text-ink-soft">
              Kênh nào nhận cách thanh toán nào:{" "}
              {Object.entries(CHANNEL_PAYMENTS)
                .filter(([k]) => k !== "own_web")
                .map(([k, ms]) => `${CHANNEL_KIND_LABEL[k as keyof typeof CHANNEL_KIND_LABEL]}: ${ms.map((m) => PAYMENT_METHOD_LABEL[m]).join(", ")}`)
                .join(" · ")}
              .
            </p>
          </Card>

          <Card title="Hàng">
            <div className="space-y-3">
              {Array.from({ length: LINE_ROWS }, (_, i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem] gap-2 sm:grid-cols-[1fr_5rem_9rem]">
                  <select name="productId" defaultValue="" className="field min-h-11 min-w-0" aria-label={`Sản phẩm dòng ${i + 1}`}>
                    <option value="">— Sản phẩm —</option>
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {formatVnd(p.price)} · còn {p.stock}
                      </option>
                    ))}
                  </select>
                  <input name="qty" inputMode="numeric" defaultValue="1" className="field min-h-11" aria-label={`Số lượng dòng ${i + 1}`} />
                  <input
                    name="unitPrice"
                    inputMode="numeric"
                    placeholder={pricing ? "Giá sửa tay" : "Theo bảng giá"}
                    disabled={!pricing}
                    className="field col-span-2 min-h-11 sm:col-span-1"
                    aria-label={`Đơn giá sửa tay dòng ${i + 1}`}
                  />
                </div>
              ))}
            </div>
            {pricing && (
              <label className="mt-3 block">
                <span className="field-label">Lý do sửa giá (bắt buộc nếu có dòng sửa giá)</span>
                <input name="priceOverrideReason" className="field" />
              </label>
            )}
            {data.bundles.length > 0 && (
              <div className="mt-5 space-y-3 border-t border-line pt-4">
                <p className="eyebrow">Combo</p>
                {Array.from({ length: BUNDLE_ROWS }, (_, i) => (
                  <div key={i} className="grid grid-cols-[1fr_5rem] gap-2">
                    <select name="bundleId" defaultValue="" className="field min-h-11 min-w-0" aria-label={`Combo ${i + 1}`}>
                      <option value="">— Combo —</option>
                      {data.bundles.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} · {formatVnd(b.price)}
                          {b.channelCode ? ` · chỉ kênh ${b.channelCode}` : ""}
                        </option>
                      ))}
                    </select>
                    <input name="bundleQty" inputMode="numeric" defaultValue="1" className="field min-h-11" aria-label={`Số combo ${i + 1}`} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Giảm giá và phí">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Mã giảm giá</span>
                <input name="voucherCode" className="field font-mono uppercase" />
              </label>
              <label className="block">
                <span className="field-label">Chiết khấu tay (đ)</span>
                <input name="manualDiscount" inputMode="numeric" defaultValue="0" className="field" />
                <span className="mt-1 block text-xs text-ink-soft">Vượt ngưỡng cho phép thì cần quyền sửa giá.</span>
              </label>
              <label className="block">
                <span className="field-label">Phí giao thu của khách (đ)</span>
                <input name="shippingFee" inputMode="numeric" defaultValue="0" className="field" />
              </label>
              <label className="block">
                <span className="field-label">Phí nền tảng (đ, đơn sàn)</span>
                <input name="platformFee" inputMode="numeric" placeholder="Để trống: tính theo % của kênh" className="field" />
              </label>
            </div>
          </Card>

          <Card title="Người nhận">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Tên người nhận</span>
                <input name="recipientName" required className="field" />
              </label>
              <label className="block">
                <span className="field-label">Số điện thoại</span>
                <input name="phone" inputMode="tel" className="field" />
              </label>
              <label className="block">
                <span className="field-label">Email</span>
                <input name="email" type="email" className="field" />
              </label>
              <label className="block">
                <span className="field-label">Tỉnh/thành</span>
                <input name="province" className="field" />
              </label>
              <label className="block">
                <span className="field-label">Phường/xã</span>
                <input name="ward" className="field" />
              </label>
              <label className="block">
                <span className="field-label">Số nhà, đường</span>
                <input name="addressLine" className="field" />
              </label>
              <label className="block sm:col-span-2">
                <span className="field-label">Khách ghi chú</span>
                <input name="customerNote" className="field" />
              </label>
              <label className="block sm:col-span-2">
                <span className="field-label">Ghi chú nội bộ</span>
                <input name="internalNote" className="field" />
              </label>
            </div>
            <label className="mt-4 flex min-h-11 items-start gap-3 text-sm">
              <input type="checkbox" name="consentConfirmed" className="mt-1 size-5 shrink-0" />
              <span>Khách đã đồng ý cho Pomil lưu thông tin để giao hàng (bắt buộc khi có số điện thoại).</span>
            </label>
            <label className="mt-2 block">
              <span className="field-label">Sau khi tạo</span>
              <select name="intent" defaultValue="confirm" className="field min-h-11 w-auto">
                <option value="confirm">Xác nhận đơn luôn</option>
                <option value="pending">Để chờ xác nhận</option>
              </select>
            </label>
          </Card>
        </ActionForm>
      )}
    </>
  );
}
