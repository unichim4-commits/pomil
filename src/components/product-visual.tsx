import { Bottle, toneOf } from "./brand";

type VisualProduct = { name: string; subtitle: string; size: string; tone: string; imageFileIds: string[] };

// Ảnh chụp nếu đã tải lên, chưa có thì vẽ chai theo màu đã chọn trên nền Cùi bưởi có vân chấm.
export function ProductVisual({ product, className = "", priority = false }: { product: VisualProduct; className?: string; priority?: boolean }) {
  const imageId = product.imageFileIds[0];
  if (imageId) {
    return (
      <div className={`relative overflow-hidden bg-pith ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/files/${imageId}`}
          alt={product.name}
          className="absolute inset-0 h-full w-full object-cover"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
        />
      </div>
    );
  }
  return (
    <div className={`relative flex items-end justify-center overflow-hidden bg-pith ${className}`}>
      <div className="dots absolute inset-x-0 top-0 h-1/2 opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <Bottle tone={toneOf(product.tone)} name={product.name} subtitle={product.subtitle} size={product.size} className="relative h-[82%] w-auto pb-[6%]" />
    </div>
  );
}
