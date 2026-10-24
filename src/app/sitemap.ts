import type { MetadataRoute } from "next";
import { listPublicProducts } from "@/modules/catalog/service";
import { listAllContent } from "@/modules/content/service";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [products, content] = await Promise.all([listPublicProducts(), listAllContent()]);
  const published = content.filter((c) => c.status === "published");
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/san-pham`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/minh-bach`, changeFrequency: "monthly" },
    { url: `${base}/nhat-ky`, changeFrequency: "weekly" },
    ...products.map((p) => ({ url: `${base}/san-pham/${p.slug}`, lastModified: p.updatedAt, priority: 0.8 })),
    ...published.map((c) => ({ url: c.kind === "post" ? `${base}/nhat-ky/${c.slug}` : `${base}/${c.slug}`, lastModified: c.updatedAt })),
  ];
}
