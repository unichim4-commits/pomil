import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Cormorant_Garamond } from "next/font/google";
import { MotionRoot } from "@/components/motion";
import "./globals.css";

// Hai họ chữ của bộ nhận diện: Be Vietnam Pro (chữ chính) và Cormorant Garamond nghiêng (chữ nhấn)
const beVietnam = Be_Vietnam_Pro({
  subsets: ["vietnamese", "latin"],
  weight: ["300", "400", "500"],
  variable: "--font-be-vietnam",
  display: "swap",
});
const cormorant = Cormorant_Garamond({
  subsets: ["vietnamese", "latin"],
  weight: ["400"],
  style: ["italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Pomil · Chăm da đầu từ vỏ bưởi Việt Nam", template: "%s · Pomil" },
  description: "Nước dưỡng da đầu từ vỏ bưởi Việt Nam. Nói thật về công dụng, minh bạch từng lô.",
  openGraph: { siteName: "Pomil", locale: "vi_VN", type: "website" },
};

export const viewport: Viewport = { themeColor: "#1e2420" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: đoạn script bên dưới thêm lớp "js" vào <html> trước khi React chạy
    <html lang="vi" className={`${beVietnam.variable} ${cormorant.variable}`} suppressHydrationWarning>
      <head>
        {/* Chỉ bật hiệu ứng hiện dần khi trình duyệt hỗ trợ và người dùng không chọn "giảm chuyển động"; nếu không thì nội dung luôn hiện. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if('IntersectionObserver' in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('js')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <MotionRoot />
      </body>
    </html>
  );
}
