import Link from "next/link";
import { cookies } from "next/headers";
import { AddToCart } from "@/components/add-to-cart";
import { CrossSection, Mark } from "@/components/brand";
import { ProductCard, productAvailability } from "@/components/product-card";
import { ProductVisual } from "@/components/product-visual";
import { formatDate, formatVnd } from "@/lib/format";
import { readVariant, VARIANT_COOKIE } from "@/lib/variant";
import { listPublicProducts } from "@/modules/catalog/service";
import { WAITLIST_CONSENT_TEXT } from "@/modules/consent/texts";
import { listPublishedPosts } from "@/modules/content/service";
import { launchNoteToShow } from "@/modules/settings/rules";
import { getSettings } from "@/modules/settings/service";
import { WaitlistForm } from "./waitlist-form";

// Hai định vị đang thử (POM-77): A làm nền thương hiệu, B là tình huống dùng hằng ngày.
const HERO = {
  A: {
    headline: "Chăm da đầu như chăm da mặt.",
    sub: "Nước dưỡng da đầu từ vỏ bưởi Việt Nam. Thành phần rõ, nguồn gốc rõ đến từng lô.",
  },
  B: {
    headline: "Da đầu sau một ngày đội mũ bảo hiểm.",
    sub: "Xịt sát da đầu, khô nhanh, không để lại lớp dầu. Thoáng và thơm sạch mùi vỏ bưởi.",
  },
} as const;

const PILLARS = [
  { no: "01", title: "Da đầu trước tiên", body: "Da đầu cân bằng thì tóc mới có nền để khỏe. Pomil chăm phần da, không hứa phần tóc." },
  { no: "02", title: "Bưởi Việt truy xuất được", body: "Mỗi chai ghi vùng trồng, mùa vụ và số lô. Quét mã là thấy kết quả kiểm nghiệm của chính lô đó." },
  { no: "03", title: "Nói thật về công dụng", body: "Chỉ nói những gì được phép và đo được. Số liệu viết đủ: bao nhiêu người, sau bao lâu." },
];

const NOT_DO = [
  "Không hứa mọc tóc, trị rụng tóc.",
  "Không dùng ảnh trước và sau.",
  "Không giảm giá thường trực; giá như nhau ở mọi kênh.",
  "Không giấu nguồn gốc nguyên liệu.",
];

export default async function HomePage() {
  const variant = readVariant((await cookies()).get(VARIANT_COOKIE)?.value);
  const hero = HERO[variant];
  const [settings, products, posts] = await Promise.all([getSettings(), listPublicProducts(), listPublishedPosts(3)]);
  const launchNote = launchNoteToShow(settings);
  const featured = products.find((p) => p.featured && p.status === "active") ?? products[0];
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  return (
    <>
      {/* Mở đầu */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-16">
        <div>
          <p className="eyebrow text-rind">Nước dưỡng da đầu · Vỏ bưởi Việt Nam</p>
          <h1 className="display mt-5 text-[2.6rem] sm:text-6xl">{hero.headline}</h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-soft">{hero.sub}</p>
          <p className="accent-serif mt-6 text-2xl text-graphite/90">Chăm da đầu trước, tóc khỏe theo sau.</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            {featured && (
              <Link href={`/san-pham/${featured.slug}`} className="btn btn-primary">
                {featured.name} · <span className="price">{formatVnd(featured.price)}</span>
              </Link>
            )}
            <Link href="/minh-bach" className="btn btn-outline">
              Xem cách tra số lô
            </Link>
          </div>
        </div>
        {featured && (
          <div className="relative">
            <ProductVisual product={featured} className="aspect-[4/5] w-full" priority />
            <div className="absolute -bottom-5 -left-3 hidden items-center gap-3 bg-bone px-4 py-3 shadow-sm sm:flex">
              <Mark className="h-5 w-5 text-rind" />
              <span className="eyebrow text-[0.65rem]">Mỗi chai một số lô</span>
            </div>
          </div>
        )}
      </section>

      {/* Dòng lô */}
      <div className="border-y border-line bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 py-4 text-center sm:px-6">
          <span className="eyebrow text-[0.68rem] tracking-[0.28em]">Số lô in dưới đáy chai</span>
          <span className="text-rind">·</span>
          <span className="eyebrow text-[0.68rem] tracking-[0.28em]">Quét mã xem kiểm nghiệm</span>
          <span className="text-rind">·</span>
          <span className="eyebrow text-[0.68rem] tracking-[0.28em]">Giá như nhau mọi kênh</span>
        </div>
      </div>

      {/* Ba trụ */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-px bg-line md:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.no} className="bg-bone p-8 md:p-10">
              <p className="eyebrow text-rind">{p.no}</p>
              <h2 className="mt-4 text-2xl font-light">{p.title}</h2>
              <p className="mt-3 leading-relaxed text-ink-soft">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Sản phẩm chủ lực */}
      {featured && (
        <section className="bg-pith">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 md:grid-cols-2">
            <div className="flex items-center justify-center">
              <CrossSection className="h-64 w-64 text-graphite/70 sm:h-80 sm:w-80" />
            </div>
            <div>
              <p className="eyebrow text-rind">Sản phẩm chủ lực</p>
              <h2 className="display mt-4 text-4xl">{featured.name}</h2>
              <p className="mt-2 text-ink-soft">
                {featured.subtitle} · {featured.size}
              </p>
              <ul className="mt-8 space-y-3">
                {featured.highlights.map((h) => (
                  <li key={h} className="flex gap-3 border-b border-graphite/10 pb-3">
                    <Mark className="mt-0.5 h-4 w-4 shrink-0 text-rind" compact />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex items-baseline gap-4">
                <p className="text-3xl font-light">{formatVnd(featured.price)}</p>
                <p className="text-sm text-ink-soft">{settings.shippingFreeThreshold > 0 && `Miễn phí giao từ ${formatVnd(settings.shippingFreeThreshold)}`}</p>
              </div>
              <div className="mt-6 max-w-sm">
                {productAvailability(featured, settings.salesOpen) === "buy" ? (
                  <AddToCart productId={featured.id} max={Math.min(settings.maxQtyPerItem, featured.stock)} />
                ) : (
                  <>
                    <Link href={`/san-pham/${featured.slug}`} className="btn btn-primary w-full">
                      Giữ chỗ khi mở bán
                    </Link>
                    {launchNote && <p className="mt-2 text-center text-sm text-graphite">{launchNote}</p>}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Nói thật */}
      <section className="relative overflow-hidden bg-graphite text-bone">
        <div className="dots-dark absolute inset-y-0 right-0 w-1/2 opacity-40 [mask-image:linear-gradient(to_left,black,transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <p className="eyebrow text-bone/60">Nói thật · Số 01</p>
          <h2 className="accent-serif mt-6 max-w-2xl text-5xl leading-tight sm:text-6xl">Bưởi có làm mọc tóc không?</h2>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-bone/80">
            Câu trả lời ngắn: không. Hiện chưa có nghiên cứu đủ mạnh trên người cho thấy điều đó, và mỹ phẩm cũng không được quảng cáo như thuốc. Điều Pomil làm được: da đầu thoáng, dịu và thơm sạch giữa hai lần gội.
          </p>
          <Link href="/nhat-ky/noi-that-so-01-buoi-co-lam-moc-toc-khong" className="btn btn-light mt-10">
            Đọc bài đầy đủ
          </Link>
        </div>
      </section>

      {/* Bốn điều không làm + minh bạch lô */}
      <section className="mx-auto grid max-w-6xl gap-16 px-4 py-24 sm:px-6 md:grid-cols-2">
        <div>
          <p className="eyebrow text-rind">Cam kết</p>
          <h2 className="display mt-4 text-4xl">Bốn điều Pomil không làm</h2>
          <ol className="mt-10 space-y-0">
            {NOT_DO.map((item, i) => (
              <li key={item} className="flex gap-6 border-t border-line py-5 last:border-b">
                <span className="eyebrow pt-1 text-rind">0{i + 1}</span>
                <span className="text-lg">{item}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="border border-line bg-paper p-8">
          <div className="flex items-start justify-between">
            <p className="eyebrow">Truy xuất lô</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/pomil-seal.svg" alt="" className="h-20 w-20 opacity-90" />
          </div>
          <p className="mt-4 text-sm text-ink-soft">Lô số</p>
          <p className="text-5xl font-light">Nº ····</p>
          <dl className="mt-6 divide-y divide-line text-sm">
            {[
              ["Nguyên liệu", "Vỏ bưởi"],
              ["Vùng trồng", "In theo từng lô"],
              ["Thu hoạch vỏ", "In theo từng lô"],
              ["Vi sinh", "Phiếu kiểm nghiệm"],
              ["Kim loại nặng", "Phiếu kiểm nghiệm"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-2.5">
                <dt className="text-ink-soft">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <form action="/minh-bach" className="mt-6 flex gap-2">
            <input name="lot" placeholder="PST-YYMMDD-NN" aria-label="Số lô in dưới đáy chai, dạng PST-YYMMDD-NN" className="field font-mono uppercase" />
            <button className="btn btn-primary shrink-0">Tra</button>
          </form>
        </div>
      </section>

      {/* Danh mục */}
      {products.length > 1 && (
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="flex items-end justify-between">
            <h2 className="display text-4xl">Sản phẩm</h2>
            <Link href="/san-pham" className="eyebrow underline-offset-4 hover:underline">
              Xem tất cả
            </Link>
          </div>
          <div className="mt-10 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {products.slice(0, 3).map((p) => (
              <ProductCard key={p.id} product={p} salesOpen={settings.salesOpen} />
            ))}
          </div>
        </section>
      )}

      {/* Nhật ký */}
      {posts.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="flex items-end justify-between">
            <h2 className="display text-4xl">Nhật ký</h2>
            <Link href="/nhat-ky" className="eyebrow underline-offset-4 hover:underline">
              Tất cả bài
            </Link>
          </div>
          <div className="mt-10 grid gap-px bg-line md:grid-cols-3">
            {posts.map((post) => (
              <Link key={post.id} href={`/nhat-ky/${post.slug}`} className="group bg-bone p-8 transition hover:bg-paper">
                <p className="eyebrow text-ink-soft">{formatDate(post.publishedAt)}</p>
                <h3 className="mt-4 text-xl font-light leading-snug group-hover:underline group-hover:decoration-rind group-hover:underline-offset-4">{post.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">{post.excerpt}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Danh sách chờ */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-10 bg-graphite p-8 text-bone sm:p-12 md:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="eyebrow text-bone/60">Nhận tin trước</p>
            <h2 className="display mt-4 text-4xl">Mỗi lô chỉ khoảng 300 chai.</h2>
            <p className="mt-4 leading-relaxed text-bone/75">
              Để lại số điện thoại để được nhắn khi có lô mới, sản phẩm mới hoặc đợt dùng thử. Không spam, dừng nhận tin lúc nào cũng được.
            </p>
            {launchNote && <p className="mt-4 border-l border-bone/40 pl-3 text-bone">{launchNote}</p>}
          </div>
          <WaitlistForm consentText={WAITLIST_CONSENT_TEXT} siteUrl={siteUrl} submitLabel="Nhận tin" dark />
        </div>
      </section>
    </>
  );
}
