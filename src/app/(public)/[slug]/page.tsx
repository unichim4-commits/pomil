import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentArticle } from "@/components/content-article";
import { plainText } from "@/lib/markdown";
import { getPublishedPage } from "@/modules/content/service";

// Trang nội dung soạn trong quản trị: /cau-chuyen, /hoi-dap, /chinh-sach-...
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getPublishedPage((await params).slug, "page");
  if (!page) return { title: "Không tìm thấy trang", robots: { index: false } };
  return { title: page.title, description: page.seoDescription || page.excerpt || plainText(page.body) };
}

export default async function ContentPageRoute({ params }: Props) {
  const page = await getPublishedPage((await params).slug, "page");
  if (!page) notFound();
  return <ContentArticle page={page} />;
}
