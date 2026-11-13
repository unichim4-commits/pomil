import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/modules/auth/service";
import { listLots } from "@/modules/quality/admin";
import { NCR_CATEGORY_LABEL, SEVERITY_LABEL } from "@/modules/qms/rules";
import { ActionForm } from "../../../_components/action-form";
import { Card, PageHeader } from "../../../_components/ui";
import { createNcrAction } from "../../actions";

export const metadata: Metadata = { title: "Tạo NCR" };

export default async function NewNcrPage() {
  await requirePermission("quality.write");
  const lots = await listLots();
  return (
    <>
      <Link href="/admin/chat-luong/ncr" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Sai lỗi (NCR)
      </Link>
      <PageHeader title="Tạo NCR" description="NCR từ phiếu kiểm và phản ánh được tạo tự động; dùng form này cho sai lỗi phát hiện ngoài các luồng đó." />
      <Card>
        <ActionForm action={createNcrAction} submitLabel="Tạo NCR" className="grid gap-3 sm:grid-cols-2" noValidate>
          <label className="block sm:col-span-2">
            <span className="field-label">Tiêu đề</span>
            <input name="title" className="field" />
          </label>
          <label className="block">
            <span className="field-label">Loại</span>
            <select name="category" defaultValue="process" className="field">
              {Object.entries(NCR_CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Mức độ</span>
            <select name="severity" defaultValue="major" className="field">
              {Object.entries(SEVERITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Mô tả sai lỗi</span>
            <textarea name="description" rows={3} className="field" />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Biện pháp tức thời</span>
            <textarea name="containment" rows={2} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Lô thành phẩm liên quan</span>
            <select name="lotId" defaultValue="" className="field">
              <option value="">Không gắn lô</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lotNo}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Hạn xử lý</span>
            <input type="date" name="dueOn" className="field" />
          </label>
        </ActionForm>
      </Card>
    </>
  );
}
