import type { ContentPage } from "@/modules/content/service";
import { ActionForm } from "../_components/action-form";
import { Card } from "../_components/ui";
import { saveContentAction } from "./actions";

export function ContentForm({ page, kind, canWrite }: { page: ContentPage | null; kind: "page" | "post"; canWrite: boolean }) {
  const k = page?.kind ?? kind;
  const body = (
    <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
      <Card>
        <div className="space-y-4">
          {page && <input type="hidden" name="id" value={page.id} />}
          <input type="hidden" name="kind" value={k} />
          <label className="block">
            <span className="field-label">Tiêu đề</span>
            <input name="title" defaultValue={page?.title} required className="field text-lg" />
          </label>
          <label className="block">
            <span className="field-label">Đoạn mở đầu (hiện ở danh sách và đầu bài)</span>
            <textarea name="excerpt" defaultValue={page?.excerpt} rows={2} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Nội dung (markdown: ## tiêu đề, - danh sách, 1. danh sách số, **đậm**, [chữ](/duong-dan), &gt; trích dẫn)</span>
            <textarea name="body" defaultValue={page?.body} rows={20} className="field font-mono text-sm leading-relaxed" />
          </label>
          <p className="text-xs text-ink-soft">Khi lưu, hệ thống rà câu công dụng không được phép (mọc tóc, trị, chữa…). Giọng viết: thẳng, cụ thể, có số liệu, xưng mình gọi bạn.</p>
        </div>
      </Card>
      <div className="space-y-6">
        <Card title="Đăng">
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-3">
              <input type="radio" name="status" value="draft" defaultChecked={(page?.status ?? "draft") === "draft"} className="accent-graphite" /> Bản nháp
            </label>
            <label className="flex items-center gap-3">
              <input type="radio" name="status" value="published" defaultChecked={page?.status === "published"} className="accent-graphite" /> Đăng công khai
            </label>
            {k === "page" && (
              <label className="flex items-center gap-3 border-t border-line pt-3">
                <input type="checkbox" name="showInFooter" defaultChecked={page?.showInFooter} className="accent-graphite" /> Hiện link ở chân trang
              </label>
            )}
          </div>
        </Card>
        <Card title="Đường dẫn và SEO">
          <div className="space-y-4">
            <label className="block">
              <span className="field-label">Đường dẫn {k === "post" ? "(/nhat-ky/…)" : "(/…)"}</span>
              <input name="slug" defaultValue={page?.slug} placeholder="Để trống: tự tạo từ tiêu đề" className="field font-mono text-sm" />
            </label>
            <label className="block">
              <span className="field-label">Mô tả SEO</span>
              <textarea name="seoDescription" defaultValue={page?.seoDescription ?? ""} rows={2} className="field" />
            </label>
          </div>
        </Card>
        <Card title="Ảnh bìa">
          {page?.coverFileId && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${page.coverFileId}`} alt="" className="mb-3 aspect-video w-full object-cover" />
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="removeCover" className="accent-graphite" /> Bỏ ảnh bìa
              </label>
            </>
          )}
          <input type="file" name="cover" accept="image/jpeg,image/png,image/webp,image/avif" className="block w-full text-sm" />
        </Card>
      </div>
    </div>
  );
  if (!canWrite) return <fieldset disabled>{body}</fieldset>;
  return (
    <ActionForm action={saveContentAction} submitLabel={page ? "Lưu" : "Tạo"} className="space-y-6" resetOnSuccess>
      {body}
    </ActionForm>
  );
}
