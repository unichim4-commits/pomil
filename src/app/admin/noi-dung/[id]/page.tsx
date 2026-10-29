import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getContent } from "@/modules/content/service";
import { ActionForm } from "../../_components/action-form";
import { PageHeader } from "../../_components/ui";
import { deleteContentAction } from "../actions";
import { ContentForm } from "../content-form";

export const metadata: Metadata = { title: "Sửa nội dung" };

export default async function EditContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, page] = await Promise.all([requireStaff(), getContent(id)]);
  if (!page) notFound();
  const canWrite = can(staff.role, "content.write");
  const url = page.kind === "post" ? `/nhat-ky/${page.slug}` : `/${page.slug}`;

  return (
    <>
      <Link href="/admin/noi-dung" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Nội dung
      </Link>
      <div className="mt-3">
        <PageHeader
          title={page.title}
          description={url}
          actions={
            page.status === "published" && (
              <Link href={url} target="_blank" className="btn btn-outline">
                Xem trên web ↗
              </Link>
            )
          }
        />
      </div>
      <ContentForm page={page} kind={page.kind} canWrite={canWrite} />
      {canWrite && (
        <div className="mt-10 border-t border-line pt-6">
          <ActionForm action={deleteContentAction} submitLabel="Xóa vĩnh viễn" submitClassName="btn border-danger bg-transparent text-danger" confirm={`Xóa “${page.title}”? Không khôi phục được.`}>
            <input type="hidden" name="id" value={page.id} />
          </ActionForm>
        </div>
      )}
    </>
  );
}
