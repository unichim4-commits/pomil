import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/modules/auth/service";
import { listOpenNcrsBrief } from "@/modules/qms/admin";
import { CAPA_SUGGESTED_STEPS } from "@/modules/qms/rules";
import { ActionForm } from "../../../_components/action-form";
import { Card, PageHeader } from "../../../_components/ui";
import { createCapaAction } from "../../actions";

export const metadata: Metadata = { title: "Tạo CAPA" };

export default async function NewCapaPage({ searchParams }: { searchParams: Promise<{ ncr?: string }> }) {
  const sp = await searchParams;
  await requirePermission("quality.write");
  const ncrs = await listOpenNcrsBrief();
  const preset = ncrs.find((n) => n.id === sp.ncr);
  return (
    <>
      <Link href="/admin/chat-luong/capa" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← CAPA
      </Link>
      <PageHeader title="Tạo CAPA" description="Mỗi dòng ở ô Các bước là một bước hành động. Sửa hoặc xóa bước gợi ý cho hợp với việc cần làm." />
      <Card>
        <ActionForm action={createCapaAction} submitLabel="Tạo CAPA" className="grid gap-3 sm:grid-cols-2" noValidate>
          <label className="block sm:col-span-2">
            <span className="field-label">Tiêu đề</span>
            <input name="title" defaultValue={preset ? `Khắc phục ${preset.code}: ${preset.title}` : ""} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Loại</span>
            <select name="type" defaultValue="corrective" className="field">
              <option value="corrective">Khắc phục</option>
              <option value="preventive">Phòng ngừa</option>
            </select>
          </label>
          <label className="block">
            <span className="field-label">NCR liên kết</span>
            <select name="ncrId" defaultValue={preset?.id ?? ""} className="field">
              <option value="">Không gắn NCR</option>
              {ncrs.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.code} · {n.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Vấn đề</span>
            <textarea name="problem" rows={2} className="field" />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Các bước (mỗi dòng một bước)</span>
            <textarea name="steps" rows={7} defaultValue={CAPA_SUGGESTED_STEPS.join("\n")} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Tiêu chí hiệu quả</span>
            <input name="effectivenessCriteria" className="field" />
          </label>
          <label className="block">
            <span className="field-label">Hạn hoàn thành</span>
            <input type="date" name="dueOn" className="field" />
          </label>
        </ActionForm>
      </Card>
    </>
  );
}
