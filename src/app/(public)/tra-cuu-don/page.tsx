import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { normalizeVnPhone } from "@/lib/phone";
import { lookupOrder } from "@/modules/orders/service";

export const metadata: Metadata = { title: "Tra cứu đơn hàng" };

// Gửi bằng POST để số điện thoại không nằm trên địa chỉ trang và nhật ký máy chủ.
async function lookup(formData: FormData) {
  "use server";
  const code = String(formData.get("ma") ?? "").slice(0, 40);
  const phone = normalizeVnPhone(String(formData.get("sdt") ?? ""));
  const found = phone && code ? await lookupOrder(code, phone) : null;
  if (found) redirect(`/don-hang/${found.code}?t=${found.token}`);
  redirect("/tra-cuu-don?loi=1");
}

export default async function OrderLookupPage({ searchParams }: { searchParams: Promise<{ loi?: string }> }) {
  const { loi } = await searchParams;
  return (
    <div className="mx-auto max-w-md px-4 py-20 sm:px-6">
      <p className="eyebrow text-rind">Đơn hàng</p>
      <h1 className="display mt-4 text-4xl">Tra cứu đơn hàng</h1>
      <p className="mt-3 text-ink-soft">Nhập mã đơn (ví dụ WEB-2711-0001) và số điện thoại đã dùng khi đặt.</p>
      <form action={lookup} className="mt-8 space-y-4">
        <label className="block">
          <span className="field-label">Mã đơn</span>
          <input name="ma" required className="field font-mono uppercase" />
        </label>
        <label className="block">
          <span className="field-label">Số điện thoại</span>
          <input name="sdt" required inputMode="tel" className="field" />
        </label>
        {loi && (
          <p className="text-sm text-danger" role="alert">
            Không tìm thấy đơn khớp mã và số điện thoại này.
          </p>
        )}
        <button className="btn btn-primary w-full">Tra cứu</button>
      </form>
    </div>
  );
}
