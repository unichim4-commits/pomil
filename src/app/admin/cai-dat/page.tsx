import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getErpSettings, getSettings } from "@/modules/settings/service";
import { emailConfigured, zaloConfigured } from "@/modules/notify/channels";
import Link from "next/link";
import { ActionForm } from "../_components/action-form";
import { Card, PageHeader } from "../_components/ui";
import { saveErpSettingsAction, saveSettingsAction } from "./actions";
import { ERP_FIELDS, UNIT_LABEL, erpFieldValue } from "./erp-form";

export const metadata: Metadata = { title: "Cài đặt cửa hàng" };

export default async function SettingsPage() {
  const staff = await requireStaff();
  if (!can(staff.role, "settings.write")) redirect("/admin");
  const [s, erp] = await Promise.all([getSettings(), getErpSettings()]);

  const text = (name: keyof typeof s, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <label className="block">
      <span className="field-label">{label}</span>
      <input name={name} defaultValue={String(s[name] ?? "")} className="field" aria-describedby={hint ? `${name}-hint` : undefined} {...props} />
      {hint && (
        <span id={`${name}-hint`} className="mt-1 block text-xs text-ink-soft">
          {hint}
        </span>
      )}
    </label>
  );
  const check = (name: keyof typeof s, label: string, hint?: string) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={Boolean(s[name])} className="mt-1 accent-graphite" />
      <span>
        {label}
        {hint && <span className="block text-xs text-ink-soft">{hint}</span>}
      </span>
    </label>
  );

  return (
    <>
      <PageHeader title="Cài đặt cửa hàng" description="Thông tin hiện ở đầu trang, chân trang, trang thanh toán và trang đơn hàng của khách." />
      <ActionForm action={saveSettingsAction} submitLabel="Lưu cài đặt" className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <Card title="Bán hàng">
            <div className="space-y-4">
              {check("salesOpen", "Đang nhận đơn", "Tắt: mọi sản phẩm chuyển sang nút “Giữ chỗ khi mở bán”.")}
              {text(
                "launchNote",
                "Dự kiến mở bán (hiện cạnh form giữ chỗ khi đang tắt bán)",
                { maxLength: 120, placeholder: "Dự kiến mở bán tháng 11/2027" },
                "Viết cả câu khách sẽ đọc, ví dụ: Dự kiến mở bán tháng 11/2027. Để trống thì ẩn. Tự ẩn khi bật nhận đơn.",
              )}
              {text("announcement", "Dòng thông báo đầu trang (để trống thì ẩn)")}
              <div className="grid gap-4 sm:grid-cols-3">
                {text("shippingFlatFee", "Phí giao (đồng)", { type: "number", min: 0, step: 1000 })}
                {text("shippingFreeThreshold", "Miễn phí giao từ (0 = không)", { type: "number", min: 0, step: 1000 })}
                {text("maxQtyPerItem", "Tối đa mỗi sản phẩm / đơn", { type: "number", min: 1, max: 50 })}
              </div>
              {text("shippingNote", "Ghi chú giao hàng")}
            </div>
          </Card>

          <Card title="Thanh toán">
            <div className="space-y-4">
              {check("codEnabled", "Thu tiền khi nhận hàng (COD)")}
              {check("bankTransferEnabled", "Chuyển khoản (hiện mã VietQR cho khách)")}
              <div className="grid gap-4 sm:grid-cols-2">
                {text("bankName", "Ngân hàng", { placeholder: "Vietcombank" })}
                {text("bankBin", "Mã BIN ngân hàng (6 số)", { placeholder: "970436", inputMode: "numeric", className: "field font-mono" })}
                {text("bankAccountNo", "Số tài khoản", { className: "field font-mono" })}
                {text("bankAccountName", "Chủ tài khoản (không dấu)", { placeholder: "NGUYEN VAN A" })}
              </div>
              <p className="text-xs text-ink-soft">Mã BIN tra ở trang ngân hàng hoặc vietqr.io. Nội dung chuyển khoản tự điền là mã đơn để dễ đối soát.</p>
            </div>
          </Card>

          <Card title="Liên hệ">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {text("storeName", "Tên cửa hàng", { required: true })}
                {text("hotline", "Hotline")}
                {text("zalo", "Zalo")}
                {text("email", "Email", { type: "email" })}
              </div>
              {text("address", "Địa chỉ")}
              {text("tagline", "Câu khẩu hiệu ở chân trang")}
              {text("businessInfo", "Thông tin pháp lý ở chân trang", { placeholder: "Hộ kinh doanh … · MST … · Số ĐKKD …" })}
            </div>
          </Card>

          <Card title="Thông báo cho chủ cửa hàng">
            <div className="space-y-4">
              {check("notifyOnOrder", "Báo khi có đơn mới")}
              {check("notifyOnComplaint", "Báo khi có phản ánh", "Tắt vẫn báo phản ánh mức nặng và khi lô tự giữ lại.")}
              <label className="block">
                <span className="field-label">Email nhận (cách nhau bằng dấu phẩy) · {emailConfigured() ? <span className="text-ok">đã nối Resend</span> : <span className="text-danger">chưa có RESEND_API_KEY</span>}</span>
                <input name="notifyEmails" defaultValue={s.notifyEmails} placeholder="chu@pomil.vn" className="field" />
              </label>
              <label className="block">
                <span className="field-label">user_id Zalo nhận · {zaloConfigured() ? <span className="text-ok">đã nối Zalo OA</span> : <span className="text-danger">chưa cấu hình Zalo OA</span>}</span>
                <input name="notifyZaloUserIds" defaultValue={s.notifyZaloUserIds} placeholder="Dãy số, lấy ở trang Thông báo" className="field font-mono" />
              </label>
              <p className="text-xs text-ink-soft">
                Gửi thử, xem lịch sử gửi và cách lấy user_id Zalo ở <Link href="/admin/thong-bao" className="underline">trang Thông báo</Link>.
              </p>
            </div>
          </Card>

          <Card title="Mạng xã hội và sàn">
            <div className="space-y-4">
              {text("tiktok", "TikTok", { type: "url", placeholder: "https://www.tiktok.com/@…" })}
              {text("instagram", "Instagram", { type: "url" })}
              {text("facebook", "Facebook", { type: "url" })}
              {text("shopee", "Shopee", { type: "url" })}
            </div>
          </Card>
        </div>
      </ActionForm>

      <ActionForm action={saveErpSettingsAction} submitLabel="Lưu cài đặt vận hành" className="mt-10 space-y-6">
        <Card title="Vận hành: kho, sản xuất, bán hàng, tài chính">
          <p className="mb-4 text-sm text-ink-soft">Ngưỡng cảnh báo cho các phân hệ. Số mặc định là giả định, sửa theo thực tế.</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {ERP_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="field-label">
                  {f.label} ({UNIT_LABEL[f.unit]})
                </span>
                <input name={f.key} inputMode={f.unit === "percent" ? "decimal" : "numeric"} defaultValue={erpFieldValue(erp, f)} required className="field tabular-nums" aria-describedby={`${f.key}-hint`} />
                <span id={`${f.key}-hint`} className="mt-1 block text-xs text-ink-soft">
                  {f.hint}
                </span>
              </label>
            ))}
          </div>
          {erp.lastExpiryRefreshAt && <p className="mt-4 text-xs text-ink-soft">Lần cuối rà lô hết hạn: {new Date(erp.lastExpiryRefreshAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>}
        </Card>
      </ActionForm>
    </>
  );
}
