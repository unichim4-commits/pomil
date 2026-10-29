import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { NavProgress } from "@/components/nav-progress";
import { cartCount } from "@/modules/cart/rules";
import { readCart } from "@/modules/cart/service";
import { listFooterPages } from "@/modules/content/service";
import { getSettings } from "@/modules/settings/service";

// Đọc cài đặt và giỏ hàng theo từng request
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/san-pham", label: "Sản phẩm" },
  { href: "/cau-chuyen", label: "Câu chuyện" },
  { href: "/minh-bach", label: "Minh bạch từng lô" },
  { href: "/nhat-ky", label: "Nhật ký" },
  { href: "/hoi-dap", label: "Hỏi đáp" },
];

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [settings, cart, footerPages] = await Promise.all([getSettings(), readCart(), listFooterPages()]);
  const count = cartCount(cart);
  const social = [
    { href: settings.tiktok, label: "TikTok" },
    { href: settings.instagram, label: "Instagram" },
    { href: settings.facebook, label: "Facebook" },
    { href: settings.shopee, label: "Shopee" },
  ].filter((s) => s.href);

  return (
    <div className="flex min-h-screen flex-col">
      <NavProgress />
      {settings.announcement && <div className="bg-graphite px-4 py-2 text-center text-xs tracking-wide text-bone">{settings.announcement}</div>}

      <header className="sticky top-0 z-30 border-b border-line/70 bg-bone/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <details className="group relative lg:hidden">
            <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden" aria-label="Mở menu">
              <span className="block h-px w-5 bg-graphite shadow-[0_6px_0_var(--color-graphite),0_-6px_0_var(--color-graphite)] group-open:shadow-none" />
            </summary>
            <nav className="fixed inset-x-0 top-16 border-b border-line bg-bone px-4 pb-6 pt-2 shadow-lg">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="block border-b border-line/60 py-3.5 text-base">
                  {item.label}
                </Link>
              ))}
              <Link href="/tra-cuu-don" className="block py-3 text-base">
                Tra cứu đơn hàng
              </Link>
            </nav>
          </details>

          <Link href="/" className="-my-2 flex min-h-11 items-center gap-2 py-2" aria-label={`${settings.storeName}, trang chủ`}>
            <Wordmark className="text-base" />
          </Link>

          <nav className="ml-6 hidden items-center gap-7 text-sm lg:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="nav-link text-ink-soft hover:text-graphite">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-5 text-sm">
            <Link href="/tra-cuu-don" className="hidden min-h-11 items-center text-ink-soft hover:text-graphite sm:inline-flex">
              Tra cứu đơn
            </Link>
            <Link href="/gio-hang" className="-my-2 flex min-h-11 items-center gap-2 py-2" aria-label={`Giỏ hàng, ${count} sản phẩm`}>
              <span className="eyebrow">Giỏ</span>
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-graphite px-1.5 text-xs text-bone">{count}</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-24 bg-graphite text-bone" data-reveal="fade">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Wordmark className="text-lg text-bone" />
            <p className="accent-serif mt-5 text-2xl text-bone/90">{settings.tagline}</p>
            <div className="mt-6 space-y-1 text-sm text-bone/70">
              {settings.hotline && <p>Hotline: {settings.hotline}</p>}
              {settings.zalo && <p>Zalo: {settings.zalo}</p>}
              {settings.email && <p>Email: {settings.email}</p>}
              {settings.address && <p>{settings.address}</p>}
            </div>
          </div>
          <div>
            <p className="eyebrow text-bone/60">Mua hàng</p>
            <ul className="mt-3 text-sm text-bone/85">
              <li>
                <Link href="/san-pham" className="inline-flex min-h-11 items-center">Tất cả sản phẩm</Link>
              </li>
              <li>
                <Link href="/tra-cuu-don" className="inline-flex min-h-11 items-center">Tra cứu đơn hàng</Link>
              </li>
              <li>
                <Link href="/minh-bach" className="inline-flex min-h-11 items-center">Tra cứu số lô</Link>
              </li>
              <li>
                <Link href="/phan-anh" className="inline-flex min-h-11 items-center">Phản ánh kích ứng</Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="eyebrow text-bone/60">Thông tin</p>
            <ul className="mt-3 text-sm text-bone/85">
              {footerPages.map((p) => (
                <li key={p.slug}>
                  <Link href={`/${p.slug}`} className="inline-flex min-h-11 items-center">{p.title}</Link>
                </li>
              ))}
              {social.map((s) => (
                <li key={s.label}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center">
                    {s.label} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="border-t border-bone/10">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-bone/55 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>
              {settings.businessInfo || `© ${new Date().getFullYear()} ${settings.storeName}`}
            </p>
            <p>Pomil là mỹ phẩm, không phải thuốc. Giá như nhau ở mọi kênh.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
