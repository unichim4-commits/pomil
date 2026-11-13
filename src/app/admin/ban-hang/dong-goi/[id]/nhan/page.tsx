import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { displayPhone, formatVnd } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getOrderDetail } from "@/modules/orders/service";
import { getSettings } from "@/modules/settings/service";
import { customerSafe, PrintButton, PrintStyle } from "../../print";

export const metadata: Metadata = { title: "Nhãn giao" };

// Nhãn giao 100×150 mm (AC-BH-34). Mã vận đơn nhập tay ở trang đơn.
export default async function ShippingLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, detail, store] = await Promise.all([requireStaff(), getOrderDetail(id), getSettings()]);
  if (!detail) notFound();
  const { order, items } = detail;
  const showPhone = can(staff.role, "customers.view_phone");
  const collect = order.paymentMethod === "cod" && order.paymentStatus === "unpaid" ? order.total : 0;
  const qty = items.reduce((s, i) => s + i.quantity, 0);
  const note = customerSafe(order.customerNote);

  return (
    <>
      <PrintStyle size="100mm 150mm" />
      <PrintButton />
      {!showPhone && <p className="no-print mb-4 text-sm text-danger">Tài khoản của bạn không xem được số điện thoại đầy đủ: nhãn in số đã che.</p>}
      <section className="print-area mx-auto flex h-[150mm] w-[100mm] flex-col border border-graphite bg-white p-4 text-sm text-graphite">
        <div className="flex items-start justify-between border-b border-graphite pb-2">
          <div className="text-xs">
            <p className="tracking-[0.2em]">{store.storeName.toUpperCase()}</p>
            {store.hotline && <p>{store.hotline}</p>}
            {store.address && <p className="text-ink-soft">{store.address}</p>}
          </div>
          <p className="font-mono text-base">{order.code}</p>
        </div>
        <div className="mt-3 flex-1">
          <p className="text-xs text-ink-soft">Người nhận</p>
          <p className="text-lg">{order.recipientName}</p>
          <p className="font-mono text-lg">{showPhone ? displayPhone(order.phoneE164) : maskPhone(order.phoneE164)}</p>
          <p className="mt-2">
            {order.addressLine}, {order.ward}, {order.province}
          </p>
          {note && <p className="mt-2 text-xs">Ghi chú: {note}</p>}
        </div>
        <div className="border-t border-graphite pt-2">
          <p className="flex justify-between">
            <span>{order.carrier ?? "Đơn vị vận chuyển: ……"}</span>
            <span>{qty} sản phẩm</span>
          </p>
          <p className="mt-1 font-mono text-base">{order.trackingNo ?? "Mã vận đơn: ………………"}</p>
          <p className="mt-2 border border-graphite p-2 text-center text-base">{collect > 0 ? `Thu hộ ${formatVnd(collect)}` : "Không thu tiền"}</p>
        </div>
      </section>
    </>
  );
}
