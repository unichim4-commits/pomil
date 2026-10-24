import type { Product } from "@/modules/catalog/service";
import { ActionForm } from "../_components/action-form";
import { Card } from "../_components/ui";
import { saveProductAction } from "./actions";

const STATUS_HELP = {
  draft: "Nháp: chỉ thấy trong quản trị",
  coming_soon: "Sắp ra mắt: hiện trên web, nhận giữ chỗ",
  active: "Đang bán: khách thêm vào giỏ được",
  archived: "Ngừng bán: ẩn khỏi web",
};

export function ProductForm({ product, canWrite }: { product: Product | null; canWrite: boolean }) {
  const p = product;
  const body = (
    <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        {p && <input type="hidden" name="id" value={p.id} />}
        <Card title="Thông tin bán hàng">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <Field label="Tên sản phẩm" name="name" defaultValue={p?.name} required />
              <Field label="Mã (số lô)" name="code" defaultValue={p?.code} required placeholder="PST" className="font-mono uppercase" />
            </div>
            <Field label="Dòng mô tả ngắn" name="subtitle" defaultValue={p?.subtitle} placeholder="Nước dưỡng da đầu vỏ bưởi" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Quy cách" name="size" defaultValue={p?.size} placeholder="100 ml" />
              <Field label="Giá bán (đồng)" name="price" type="number" min={0} step={1000} defaultValue={p?.price ?? 0} required />
              {p ? (
                <div className="block">
                  <span className="field-label">Tồn kho (chai)</span>
                  <p className="field bg-pith/60 tabular-nums" aria-readonly="true">
                    {p.stock}
                  </p>
                  <span className="mt-1 block text-xs text-ink-soft">Sửa ở khung “Điều chỉnh tồn kho”.</span>
                </div>
              ) : (
                <Field label="Tồn kho ban đầu (chai)" name="initialStock" type="number" min={0} defaultValue={0} required />
              )}
            </div>
            <p className="text-xs text-ink-soft">Giá như nhau ở mọi kênh; ưu đãi bằng quà và phí giao, không giảm giá thường trực.</p>
          </div>
        </Card>

        <Card title="Nội dung trang sản phẩm">
          <div className="space-y-4">
            <Area label="Mô tả (markdown: ## tiêu đề, - danh sách, **đậm**)" name="description" defaultValue={p?.description} rows={9} />
            <Area label="Điểm nổi bật (mỗi dòng một ý)" name="highlights" defaultValue={p?.highlights.join("\n")} rows={4} />
            <Area
              label="Thành phần chính (mỗi dòng: Tên INCI | để làm gì)"
              name="ingredients"
              defaultValue={p?.ingredients.map((i) => `${i.name} | ${i.purpose}`).join("\n")}
              rows={6}
              className="font-mono text-sm"
            />
            <Area label="Cách dùng" name="howToUse" defaultValue={p?.howToUse} rows={3} />
            <Area label="Điều sản phẩm không làm (mỗi dòng một câu)" name="notDo" defaultValue={p?.notDo.join("\n")} rows={3} />
            <p className="text-xs text-ink-soft">
              Khi lưu, hệ thống rà các cụm như “mọc tóc”, “trị”, “chữa”, “giảm rụng”. Câu phủ định (“Không làm mọc tóc”) và câu hỏi vẫn được dùng.
            </p>
          </div>
        </Card>

        <Card title="Tìm kiếm Google">
          <div className="space-y-4">
            <Field label="Đường dẫn" name="slug" defaultValue={p?.slug} placeholder="Để trống: tự tạo từ tên" className="font-mono" />
            <Field label="Tiêu đề SEO" name="seoTitle" defaultValue={p?.seoTitle ?? ""} />
            <Area label="Mô tả SEO (tối đa 160 ký tự là đẹp)" name="seoDescription" defaultValue={p?.seoDescription ?? ""} rows={2} />
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="Hiển thị">
          <div className="space-y-3">
            {(Object.keys(STATUS_HELP) as (keyof typeof STATUS_HELP)[]).map((s) => (
              <label key={s} className="flex items-start gap-3 text-sm">
                <input type="radio" name="status" value={s} defaultChecked={(p?.status ?? "draft") === s} className="mt-1 accent-graphite" />
                <span>{STATUS_HELP[s]}</span>
              </label>
            ))}
            <label className="flex items-center gap-3 border-t border-line pt-3 text-sm">
              <input type="checkbox" name="featured" defaultChecked={p?.featured} className="accent-graphite" />
              Sản phẩm chủ lực (hiện to ở trang chủ)
            </label>
            <Field label="Thứ tự (nhỏ đứng trước)" name="sortOrder" type="number" min={0} defaultValue={p?.sortOrder ?? 0} />
          </div>
        </Card>

        <Card title="Ảnh">
          <div className="space-y-4">
            {p && p.imageFileIds.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {p.imageFileIds.map((imgId, i) => (
                  <div key={imgId} className="space-y-1 text-xs">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${imgId}`} alt="" className="aspect-square w-full bg-pith object-cover" />
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" name="keepImage" value={imgId} defaultChecked className="accent-graphite" /> Giữ
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="mainImage" value={imgId} defaultChecked={i === 0} className="accent-graphite" /> Ảnh chính
                    </label>
                  </div>
                ))}
              </div>
            )}
            <label className="block">
              <span className="field-label">Thêm ảnh (JPG, PNG, WebP, tối đa 3 MB mỗi ảnh)</span>
              <input type="file" name="images" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="block w-full text-sm file:mr-3 file:border file:border-graphite file:bg-transparent file:px-3 file:py-1.5" />
            </label>
            <label className="block">
              <span className="field-label">Màu chai khi chưa có ảnh</span>
              <select name="tone" defaultValue={p?.tone ?? "graphite"} className="field">
                <option value="graphite">Than chì (chai chính)</option>
                <option value="bone">Xương (phương án sáng)</option>
                <option value="rind">Vỏ bưởi (mini, quà)</option>
              </select>
            </label>
          </div>
        </Card>
      </div>
    </div>
  );

  if (!canWrite) return <fieldset disabled>{body}</fieldset>;
  return (
    <ActionForm action={saveProductAction} submitLabel={p ? "Lưu sản phẩm" : "Tạo sản phẩm"} className="space-y-6" resetOnSuccess>
      {body}
    </ActionForm>
  );
}

function Field({ label, className = "", ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input className={`field ${className}`} {...rest} />
    </label>
  );
}

function Area({ label, className = "", ...rest }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <textarea className={`field ${className}`} {...rest} />
    </label>
  );
}
