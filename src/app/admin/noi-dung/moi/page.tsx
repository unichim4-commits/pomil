import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { PageHeader } from "../../_components/ui";
import { ContentForm } from "../content-form";

export const metadata: Metadata = { title: "Nội dung mới" };

export default async function NewContentPage({ searchParams }: { searchParams: Promise<{ loai?: string }> }) {
  const [{ loai }, staff] = await Promise.all([searchParams, requireStaff()]);
  const kind = loai === "page" ? "page" : "post";
  return (
    <>
      <Link href="/admin/noi-dung" className="text-sm text-ink-soft hover:text-graphite">
        ← Nội dung
      </Link>
      <div className="mt-3">
        <PageHeader title={kind === "post" ? "Viết bài nhật ký" : "Thêm trang"} />
      </div>
      <ContentForm page={null} kind={kind} canWrite={can(staff.role, "content.write")} />
    </>
  );
}
