import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/add-to-cart";
import { productAvailability } from "@/components/product-card";
import { ProductVisual } from "@/components/product-visual";
import { formatVnd } from "@/lib/format";
import { plainText, renderMarkdown } from "@/lib/markdown";
import { getPublicProduct } from "@/modules/catalog/service";
import { WAITLIST_CONSENT_TEXT } from "@/modules/consent/texts";
import { launchNoteToShow } from "@/modules/settings/rules";
import { getSettings } from "@/modules/settings/service";
import { WaitlistForm } from "../../waitlist-form";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getPublicProduct((await params).slug);
  if (!product) return { title: "Không tìm thấy sản phẩm" };
  return {
    title: product.seoTitle || `${product.name} ${product.size}`.trim(),
    description: product.seoDescription || plainText(product.description),
    openGraph: product.imageFileIds[0] ? { images: [`/api/files/${product.imageFileIds[0]}`] } : undefined,
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [product, settings] = await Promise.all([getPublicProduct(slug), getSettings()]);
  if (!product) notFound();

  const availability = productAvailability(product, settings.salesOpen);
  const launchNote = launchNoteToShow(settings);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: plainText(product.description, 300),
    brand: { "@type": "Brand", name: "Pomil" },
    sku: product.code,
    image: product.imageFileIds.map((id) => `${siteUrl}/api/files/${id}`),
    offers: {
      "@type": "Offer",
      priceCurrency: "VND",
      price: product.price,
      availability:
        availability === "buy" ? "https://schema.org/InStock" : availability === "soon" ? "https://schema.org/PreOrder" : "https://schema.org/OutOfStock",
      url: `${siteUrl}/san-pham/${product.slug}`,
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <nav className="text-sm text-ink-soft" aria-label="Đường dẫn">
          <Link href="/san-pham" className="inline-flex min-h-11 items-center hover:text-graphite">
            Sản phẩm
          </Link>
          <span className="mx-2">/</span>
          <span className="text-graphite">{product.name}</span>
        </nav>
      </div>

      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:px-6 md:grid-cols-2 md:gap-14">
        <div className="enter-fade space-y-3 md:sticky md:top-24 md:self-start">
          <ProductVisual product={product} className="aspect-[4/5] w-full" priority />
          {product.imageFileIds.length > 1 && (
            <div className="grid grid-cols-4 gap-3">
              {product.imageFileIds.slice(1, 5).map((id) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={id} src={`/api/files/${id}`} alt={product.name} className="aspect-square w-full bg-pith object-cover" loading="lazy" />
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="eyebrow text-rind">{product.subtitle}</p>
          <h1 className="display enter mt-3 text-4xl sm:text-5xl" style={{ ["--d" as string]: "100ms" }}>{product.name}</h1>
          <p className="mt-2 text-ink-soft">{product.size}</p>
          <p className="mt-6 text-3xl font-light">{formatVnd(product.price)}</p>
          <p className="mt-1 text-sm text-ink-soft">Giá như nhau ở mọi kênh bán, không giảm giá thường trực.</p>

          <div className="mt-8">
            {availability === "buy" && <AddToCart productId={product.id} max={Math.min(settings.maxQtyPerItem, product.stock)} />}
            {availability !== "buy" && (
              <div className="border border-line bg-paper p-6">
                <p className="text-lg">{availability === "soon" ? "Sản phẩm sắp ra mắt." : "Lô hiện tại đã hết."}</p>
                {availability === "soon" && launchNote && <p className="mt-1 text-sm text-graphite">{launchNote}</p>}
                <p className="mt-1 mb-5 text-sm text-ink-soft">
                  {availability === "soon" ? "Giữ chỗ để được mua trước khi mở bán chung." : "Để lại số điện thoại, Pomil nhắn bạn khi có lô mới."}
                </p>
                <WaitlistForm consentText={WAITLIST_CONSENT_TEXT} siteUrl={siteUrl} interest={product.slug} submitLabel={availability === "soon" ? "Giữ chỗ" : "Nhắn tôi khi có hàng"} />
              </div>
            )}
          </div>

          {product.highlights.length > 0 && (
            <ul className="mt-10 grid gap-3 sm:grid-cols-2">
              {product.highlights.map((h, i) => (
                <li key={h} className="flex gap-3 border-t border-line pt-3 text-sm" data-reveal style={{ ["--d" as string]: `${i * 90}ms` }}>
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rind" aria-hidden="true" />
                  {h}
                </li>
              ))}
            </ul>
          )}

          {product.description && <div className="prose-pomil mt-10" dangerouslySetInnerHTML={{ __html: renderMarkdown(product.description) }} />}

          {product.ingredients.length > 0 && (
            <div className="mt-12">
              <h2 className="eyebrow">Thành phần chính và để làm gì</h2>
              <dl className="mt-4 divide-y divide-line border-y border-line" data-reveal>
                {product.ingredients.map((ing) => (
                  <div key={ing.name} className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                    <dt className="font-medium">{ing.name}</dt>
                    <dd className="text-sm leading-relaxed text-ink-soft">{ing.purpose}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-ink-soft">Bảng thành phần đầy đủ in trên nhãn sau, theo phiếu công bố mỹ phẩm.</p>
            </div>
          )}

          {product.howToUse && (
            <div className="mt-12">
              <h2 className="eyebrow">Cách dùng</h2>
              <p className="mt-4 leading-relaxed text-ink-soft">{product.howToUse}</p>
            </div>
          )}

          {product.notDo.length > 0 && (
            <div className="mt-12 bg-graphite p-7 text-bone" data-reveal="zoom">
              <p className="eyebrow text-bone/60">Điều sản phẩm không làm</p>
              <p className="mt-3 text-lg leading-relaxed">{product.notDo.join(" ")}</p>
            </div>
          )}

          <div className="mt-8 grid gap-px bg-line text-sm sm:grid-cols-2">
            <div className="bg-bone p-5">
              <p className="eyebrow text-rind">Giao hàng</p>
              <p className="mt-2 text-ink-soft">
                {settings.shippingNote}
                {settings.shippingFreeThreshold > 0 && ` Miễn phí giao cho đơn từ ${formatVnd(settings.shippingFreeThreshold)}.`}
              </p>
            </div>
            <div className="bg-bone p-5">
              <p className="eyebrow text-rind">Minh bạch từng lô</p>
              <p className="mt-2 text-ink-soft">
                Số lô in dưới đáy chai.{" "}
                <Link href="/minh-bach" className="underline underline-offset-4">
                  Tra cứu số lô
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
