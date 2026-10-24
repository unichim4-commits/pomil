import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listAllContent } from "@/modules/content/service";
import { Badge, PageHeader, Table } from "../_components/ui";

export const metadata: Metadata = { title: "Nội dung" };

export default async function ContentAdminPage() {
  const [staff, items] = await Promise.all([requireStaff(), listAllContent()]);
  const canWrite = can(staff.role, "content.write");
  const groups = [
    { kind: "page" as const, title: "Trang", items: items.filter((i) => i.kind === "page") },
    { kind: "post" as const, title: "Bài nhật ký", items: items.filter((i) => i.kind === "post") },
  ];

  return (
    <>
      <PageHeader
        title="Nội dung"
        description="Trang tĩnh (câu chuyện, hỏi đáp, chính sách) và bài nhật ký. Tuyến nội dung: Nhật ký 95 triệu · Da đầu 101 · Từ vỏ bưởi đến chai · Bằng chứng."
        actions={
          canWrite && (
            <>
              <Link href="/admin/noi-dung/moi?loai=post" className="btn btn-primary">
                Viết bài
              </Link>
              <Link href="/admin/noi-dung/moi?loai=page" className="btn btn-outline">
                Thêm trang
              </Link>
            </>
          )
        }
      />
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.kind}>
            <h2 className="eyebrow mb-3 text-[0.68rem]">{g.title}</h2>
            <Table>
              <thead>
                <tr>
                  <th>Tiêu đề</th>
                  <th>Đường dẫn</th>
                  <th>Trạng thái</th>
                  <th>Sửa lần cuối</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((i) => (
                  <tr key={i.id} className="hover:bg-bone">
                    <td>
                      <Link href={`/admin/noi-dung/${i.id}`} className="underline-offset-4 hover:underline">
                        {i.title}
                      </Link>
                    </td>
                    <td className="font-mono text-xs text-ink-soft">{g.kind === "post" ? `/nhat-ky/${i.slug}` : `/${i.slug}`}</td>
                    <td>
                      <Badge tone={i.status === "published" ? "green" : "neutral"}>{i.status === "published" ? "Đã đăng" : "Nháp"}</Badge>
                    </td>
                    <td className="text-ink-soft">{formatDateTime(i.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        ))}
      </div>
    </>
  );
}
