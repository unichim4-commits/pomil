import type { Metadata } from "next";
import Link from "next/link";
import { can, ROLE_LABEL } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { logoutAction } from "../dang-nhap/actions";
import { AdminNav } from "./_components/nav";

// Mọi trang quản trị đi qua đây: kiểm tra phiên theo từng request.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Quản trị", template: "%s · Quản trị Pomil" }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();

  const groups = [
    {
      label: "Bán hàng",
      items: [
        { href: "/admin", label: "Tổng quan" },
        { href: "/admin/don-hang", label: "Đơn hàng" },
        { href: "/admin/khach-hang", label: "Khách hàng" },
        { href: "/admin/danh-gia", label: "Đánh giá" },
      ],
    },
    {
      label: "Cửa hàng",
      items: [
        { href: "/admin/san-pham", label: "Sản phẩm" },
        { href: "/admin/noi-dung", label: "Nội dung" },
      ],
    },
    {
      label: "Chất lượng",
      items: [
        { href: "/admin/lo", label: "Lô và kiểm nghiệm" },
        { href: "/admin/phan-anh", label: "Phản ánh" },
      ],
    },
    {
      label: "Hệ thống",
      items: [
        ...(can(staff.role, "settings.write") ? [{ href: "/admin/cai-dat", label: "Cài đặt cửa hàng" }] : []),
        ...(can(staff.role, "settings.write") ? [{ href: "/admin/thong-bao", label: "Thông báo" }] : []),
        ...(can(staff.role, "staff.manage") ? [{ href: "/admin/nhan-vien", label: "Nhân viên" }] : []),
        ...(can(staff.role, "audit.view") ? [{ href: "/admin/nhat-ky", label: "Nhật ký thao tác" }] : []),
        { href: "/admin/tai-khoan", label: "Tài khoản của tôi" },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-bone lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-graphite text-bone lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 lg:py-6">
          <Link href="/admin" className="flex min-h-11 items-center gap-2">
            <span className="eyebrow text-[0.7rem]">Pomil OS</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" target="_blank" className="inline-flex min-h-11 items-center text-xs text-bone/60 hover:text-bone">
              Xem web ↗
            </Link>
            {/* Điện thoại không có khung bên trái, nên đặt nút đăng xuất ở đây */}
            <form action={logoutAction} className="lg:hidden">
              <button className="inline-flex min-h-11 items-center text-xs text-bone/60 underline underline-offset-4 hover:text-bone">Đăng xuất</button>
            </form>
          </div>
        </div>
        <AdminNav groups={groups} />
        <div className="hidden border-t border-bone/10 px-5 py-4 text-xs lg:block">
          <p className="truncate text-bone/90">{staff.name || staff.email}</p>
          <p className="text-bone/50">{ROLE_LABEL[staff.role]}</p>
          {!staff.totpEnabled && staff.role === "owner" && (
            <Link href="/admin/tai-khoan" className="mt-2 block text-blush">
              Chưa bật xác thực 2 lớp →
            </Link>
          )}
          <form action={logoutAction} className="mt-3">
            <button className="text-bone/60 underline underline-offset-4 hover:text-bone">Đăng xuất</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 px-4 py-6 sm:px-8 lg:py-10">{children}</div>
    </div>
  );
}
