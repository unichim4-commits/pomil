import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite (PostgreSQL nhúng để chạy thử) có tệp WebAssembly, để Node tự nạp thay vì đóng gói
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    // Form sản phẩm gửi kèm tối đa vài ảnh, mỗi ảnh ≤ 3 MB
    serverActions: { bodySizeLimit: "12mb" },
  },
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
