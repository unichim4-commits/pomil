import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentArticle } from "@/components/content-article";
import { plainText } from "@/lib/markdown";
import { getPublishedPage } from "@/modules/content/service";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPublishedPage((await params).slug, "post");
  if (!post) return {};
  return { title: post.title, description: post.seoDescription || post.excerpt || plainText(post.body), openGraph: { type: "article" } };
}

export default async function PostPage({ params }: Props) {
  const post = await getPublishedPage((await params).slug, "post");
  if (!post) notFound();
  return (
    <>
      <ContentArticle page={post} eyebrow="Nhật ký" showDate />
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <Link href="/nhat-ky" className="eyebrow underline-offset-4 hover:underline">
          ← Tất cả bài
        </Link>
      </div>
    </>
  );
}
