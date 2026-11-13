import type { Metadata } from "next";
import Link from "next/link";
import { can, ROLE_LABEL, type Permission } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { logoutAction } from "../dang-nhap/actions";
import { AdminNav, type NavGroup } from "./_components/nav";

// Mọi trang quản trị đi qua đây: kiểm tra phiên theo từng request.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Quản trị", template: "%s · Quản trị Pomil" }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();

  // Menu theo 00-tong-quan.md mục 9. Mục cần quyền chỉ hiện khi có quyền; nhóm rỗng thì ẩn.
  const has = (p: Permission) => can(staff.role, p);
  const groups: NavGroup[] = [
    {
      label: "Bán hàng",
      items: [
        { href: "/admin", label: "Tổng quan" },
        { href: "/admin/don-hang", label: "Đơn hàng" },
        { href: "/admin/ban-hang/dong-goi", label: "Đóng gói" },
        { href: "/admin/ban-hang/doi-tra", label: "Đổi trả" },
        { href: "/admin/khach-hang", label: "Khách hàng" },
        { href: "/admin/ban-hang/dai-ly", label: "Đại lý" },
        { href: "/admin/ban-hang/kenh", label: "Kênh và bảng giá" },
        { href: "/admin/ban-hang/bang-gia", label: "Bảng giá" },
        { href: "/admin/ban-hang/bao-cao", label: "Báo cáo bán hàng" },
        { href: "/admin/danh-gia", label: "Đánh giá" },
      ],
    },
    {
      label: "Kho",
      items: [
        { href: "/admin/kho", label: "Tồn kho" },
        { href: "/admin/kho/nhap", label: "Nhập kho" },
        { href: "/admin/kho/xuat", label: "Xuất kho" },
        { href: "/admin/kho/dieu-chuyen", label: "Điều chuyển" },
        { href: "/admin/kho/kiem-ke", label: "Kiểm kê" },
        { href: "/admin/kho/lo", label: "Lô hàng" },
        { href: "/admin/kho/so-kho", label: "Sổ kho" },
        { href: "/admin/kho/bao-cao", label: "Báo cáo kho" },
        { href: "/admin/kho/hang-hoa", label: "Hàng hóa" },
        { href: "/admin/kho/nha-cung-cap", label: "Nhà cung cấp" },
        ...(has("inventory.approve") ? [{ href: "/admin/kho/cai-dat", label: "Kho và vị trí" }] : []),
      ],
    },
    {
      label: "Sản xuất",
      items: [
        { href: "/admin/san-xuat", label: "Tổng quan sản xuất" },
        { href: "/admin/san-xuat/ke-hoach", label: "Kế hoạch" },
        { href: "/admin/san-xuat/lenh", label: "Lệnh sản xuất" },
        { href: "/admin/san-xuat/chiet-xuat", label: "Chiết xuất" },
        ...(has("formulas.view") ? [{ href: "/admin/san-xuat/cong-thuc", label: "Công thức" }] : []),
        { href: "/admin/san-xuat/hieu-suat", label: "Hiệu suất" },
      ],
    },
    {
      label: "Chất lượng",
      items: [
        { href: "/admin/chat-luong", label: "Tổng quan chất lượng" },
        { href: "/admin/lo", label: "Lô và kiểm nghiệm" },
        { href: "/admin/chat-luong/phieu-kiem", label: "Phiếu kiểm" },
        { href: "/admin/phan-anh", label: "Phản ánh" },
        { href: "/admin/chat-luong/ncr", label: "Sai lỗi (NCR)" },
        { href: "/admin/chat-luong/capa", label: "CAPA" },
        { href: "/admin/chat-luong/truy-xuat", label: "Truy xuất" },
        { href: "/admin/chat-luong/thu-hoi", label: "Thu hồi" },
        { href: "/admin/chat-luong/tieu-chuan", label: "Tiêu chuẩn" },
      ],
    },
    {
      label: "Tài chính",
      items: [
        ...(has("finance.view") ? [{ href: "/admin/tai-chinh", label: "Tổng quan tài chính" }] : []),
        ...(has("finance.view") || has("finance.request") ? [{ href: "/admin/tai-chinh/thu-chi", label: "Thu chi" }] : []),
        ...(has("finance.view")
          ? [
              { href: "/admin/tai-chinh/cong-no", label: "Công nợ" },
              { href: "/admin/tai-chinh/ngan-sach", label: "Ngân sách" },
              { href: "/admin/tai-chinh/gia-von", label: "Giá vốn" },
              { href: "/admin/tai-chinh/lai-lo", label: "Lãi lỗ" },
              { href: "/admin/tai-chinh/dong-tien", label: "Dòng tiền" },
              { href: "/admin/tai-chinh/tai-khoan", label: "Tài khoản và hạng mục" },
            ]
          : []),
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
        <AdminNav groups={groups.filter((g) => g.items.length > 0)} />
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
