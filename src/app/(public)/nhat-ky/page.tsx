import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { listPublishedPosts } from "@/modules/content/service";

export const metadata: Metadata = { title: "Nhật ký", description: "Pomil kể từng bước làm một chai nước dưỡng da đầu từ vỏ bưởi, bằng số liệu thật." };

export default async function JournalPage() {
  const posts = await listPublishedPosts();
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <p className="eyebrow enter text-rind">Nhật ký</p>
      <h1 className="display enter mt-4 text-5xl" style={{ ["--d" as string]: "100ms" }}>Làm từng bước, kể từng bước</h1>
      <p className="mt-4 text-ink-soft">Hậu trường, kiến thức da đầu và những điều bọn mình nói thật.</p>
      <ul className="mt-12 divide-y divide-line border-y border-line">
        {posts.map((post, i) => (
          <li key={post.id} data-reveal style={{ ["--d" as string]: `${Math.min(i, 6) * 70}ms` }}>
            <Link href={`/nhat-ky/${post.slug}`} className="group block py-8">
              <p className="eyebrow text-ink-soft">{formatDate(post.publishedAt)}</p>
              <h2 className="mt-3 text-2xl font-light group-hover:underline group-hover:decoration-rind group-hover:underline-offset-4">{post.title}</h2>
              {post.excerpt && <p className="mt-2 text-ink-soft">{post.excerpt}</p>}
            </Link>
          </li>
        ))}
        {posts.length === 0 && <li className="py-8 text-ink-soft">Chưa có bài viết.</li>}
      </ul>
    </div>
  );
}
