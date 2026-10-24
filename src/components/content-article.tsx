import { formatDate } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import type { ContentPage } from "@/modules/content/service";

export function ContentArticle({ page, eyebrow, showDate = false }: { page: ContentPage; eyebrow?: string; showDate?: boolean }) {
  return (
    <article className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      {eyebrow && <p className="eyebrow text-rind">{eyebrow}</p>}
      <h1 className="display mt-4 text-4xl sm:text-5xl">{page.title}</h1>
      {showDate && page.publishedAt && <p className="mt-4 text-sm text-ink-soft">{formatDate(page.publishedAt)}</p>}
      {page.coverFileId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/files/${page.coverFileId}`} alt="" className="mt-10 aspect-[16/9] w-full bg-pith object-cover" />
      )}
      {page.excerpt && <p className="mt-8 text-xl font-light leading-relaxed">{page.excerpt}</p>}
      <div className="prose-pomil mt-8" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body) }} />
    </article>
  );
}
