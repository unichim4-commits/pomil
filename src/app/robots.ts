import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/dang-nhap", "/gio-hang", "/thanh-toan", "/don-hang", "/api/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
