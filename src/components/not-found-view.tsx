import Link from "next/link";
import { NOT_FOUND_COPY } from "@/modules/quality/copy";
import { Mark, Wordmark } from "./brand";

// Trang "không tìm thấy" theo bộ nhận diện: nền Xương, chữ Than chì, có lối đi tiếp.
// withLogo: dùng ở trang lỗi toàn cục (không có đầu trang của cửa hàng).
export function NotFoundView({ withLogo = false }: { withLogo?: boolean }) {
  return (
    <div className="bg-bone text-graphite">
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6 sm:py-24">
        {withLogo && (
          <Link href="/" className="mb-12 inline-block" aria-label="Pomil, về trang chủ">
            <Wordmark className="h-6 w-auto" />
          </Link>
        )}
        <Mark className="h-8 w-8 text-rind" />
        <p className="eyebrow mt-8 text-ink-soft">{NOT_FOUND_COPY.eyebrow}</p>
        <h1 className="display mt-3 text-4xl sm:text-5xl">{NOT_FOUND_COPY.title}</h1>
        <p className="mt-5 leading-relaxed text-ink-soft">{NOT_FOUND_COPY.body}</p>
        <nav className="mt-10 grid gap-3 sm:grid-cols-2" aria-label="Lối đi tiếp">
          {NOT_FOUND_COPY.links.map((l, i) => (
            <Link key={l.href} href={l.href} className={i === 0 ? "btn btn-primary" : "btn btn-outline"}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
