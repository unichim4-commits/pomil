import type { Metadata } from "next";
import { ProductCard } from "@/components/product-card";
import { listPublicProducts } from "@/modules/catalog/service";
import { launchNoteToShow } from "@/modules/settings/rules";
import { getSettings } from "@/modules/settings/service";

export const metadata: Metadata = {
  title: "Sản phẩm",
  description: "Sản phẩm chăm da đầu từ vỏ bưởi Việt Nam của Pomil.",
};

export default async function ProductsPage() {
  const [products, settings] = await Promise.all([listPublicProducts(), getSettings()]);
  const launchNote = launchNoteToShow(settings);
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <p className="eyebrow text-rind">Cửa hàng</p>
      <h1 className="display mt-4 text-5xl">Sản phẩm</h1>
      <p className="mt-4 max-w-xl text-ink-soft">Pomil làm từng sản phẩm một và chỉ ra mắt khi sản phẩm trước được khách dùng lại. Sản phẩm sắp ra mắt nhận đăng ký giữ chỗ.</p>
      {launchNote && <p className="mt-4 max-w-xl border-l-2 border-rind pl-3 text-sm text-graphite">{launchNote}</p>}
      {products.length === 0 ? (
        <p className="mt-16 text-ink-soft">Chưa có sản phẩm nào đang hiển thị.</p>
      ) : (
        <div className="mt-12 grid gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} salesOpen={settings.salesOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
