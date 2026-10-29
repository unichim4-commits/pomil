import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { emailConfigured, zaloConfigured } from "@/modules/notify/channels";
import { parseEmails, parseZaloIds } from "@/modules/notify/rules";
import { listNotifications } from "@/modules/notify/service";
import { getSettings } from "@/modules/settings/service";
import { ActionForm } from "../_components/action-form";
import { Badge, Card, Empty, PageHeader, Table } from "../_components/ui";
import { retryAction, sendTestAction } from "./actions";
import { ZaloUsers } from "./zalo-users";

export const metadata: Metadata = { title: "Thông báo" };

const EVENT: Record<string, string> = { order_created: "Đơn mới", complaint_created: "Phản ánh", test: "Tin thử" };
const STATUS = { sent: { label: "Đã gửi", tone: "green" }, failed: { label: "Lỗi", tone: "red" }, skipped: { label: "Chưa cấu hình", tone: "amber" } } as const;

export default async function NotificationsPage() {
  const staff = await requireStaff();
  if (!can(staff.role, "settings.write")) redirect("/admin");
  const [settings, rows] = await Promise.all([getSettings(), listNotifications()]);
  const emails = parseEmails(settings.notifyEmails);
  const zaloIds = parseZaloIds(settings.notifyZaloUserIds);

  return (
    <>
      <PageHeader title="Thông báo" description="Báo cho chủ cửa hàng khi có đơn mới và khi có phản ánh, qua email và Zalo. Tin gửi sau khi khách đặt xong, lỗi gửi không ảnh hưởng đơn." />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Người nhận">
          <ul className="space-y-2 text-sm">
            <li>
              Email: {emails.length ? emails.join(", ") : <span className="text-ink-soft">chưa có{process.env.ALERT_EMAIL ? `, dùng ALERT_EMAIL` : ""}</span>}
            </li>
            <li>Zalo: {zaloIds.length ? <span className="font-mono">{zaloIds.join(", ")}</span> : <span className="text-ink-soft">chưa có</span>}</li>
            <li>
              Đơn mới: {settings.notifyOnOrder ? "bật" : "tắt"} · Phản ánh: {settings.notifyOnComplaint ? "bật" : "chỉ khi khẩn"}
            </li>
          </ul>
          <Link href="/admin/cai-dat" className="mt-1 inline-flex min-h-11 items-center text-sm underline underline-offset-4">
            Sửa ở Cài đặt cửa hàng
          </Link>
          <div className="mt-5 border-t border-line pt-4">
            <ActionForm action={sendTestAction} submitLabel="Gửi tin thử" pendingLabel="Đang gửi…" />
          </div>
        </Card>

        <Card title={`Email · ${emailConfigured() ? "đã nối" : "chưa nối"}`}>
          <ol className="list-decimal space-y-2 pl-4 text-sm text-ink-soft">
            <li>Tạo tài khoản miễn phí ở resend.com (3.000 email/tháng), tạo API key.</li>
            <li>
              Đặt biến môi trường <code className="font-mono text-graphite">RESEND_API_KEY</code>.
            </li>
            <li>
              Chưa có tên miền: tin gửi từ onboarding@resend.dev và chỉ tới được email bạn dùng đăng ký Resend. Có tên miền: xác minh ở Resend rồi đặt{" "}
              <code className="font-mono text-graphite">NOTIFY_EMAIL_FROM</code>, ví dụ “Pomil OS &lt;don@pomil.vn&gt;”.
            </li>
          </ol>
        </Card>

        <Card title={`Zalo OA · ${zaloConfigured() ? "đã nối" : "chưa nối"}`}>
          <ol className="list-decimal space-y-2 pl-4 text-sm text-ink-soft">
            <li>Cần một Zalo Official Account và một ứng dụng ở developers.zalo.me liên kết với OA.</li>
            <li>
              Đặt <code className="font-mono text-graphite">ZALO_OA_APP_ID</code>, <code className="font-mono text-graphite">ZALO_OA_SECRET_KEY</code> và{" "}
              <code className="font-mono text-graphite">ZALO_OA_REFRESH_TOKEN</code> (lấy khi cấp quyền cho ứng dụng). Hệ thống tự làm mới và lưu token mới.
            </li>
            <li>Dùng Zalo của bạn quan tâm OA và nhắn một tin, rồi lấy user_id bên dưới dán vào Cài đặt.</li>
            <li>Zalo chỉ cho OA gửi tin tư vấn tới người đã tương tác gần đây; nếu lâu không nhắn OA, tin có thể bị từ chối. Nên giữ cả email.</li>
          </ol>
          {zaloConfigured() && (
            <div className="mt-4 border-t border-line pt-4">
              <ZaloUsers />
            </div>
          )}
        </Card>
      </div>

      <h2 className="eyebrow mb-3 mt-10 text-[0.68rem]">Lịch sử gửi</h2>
      {rows.length === 0 ? (
        <Empty>Chưa gửi thông báo nào.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Lúc</th>
              <th>Sự kiện</th>
              <th>Kênh · người nhận</th>
              <th>Tiêu đề</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = STATUS[r.status as keyof typeof STATUS] ?? STATUS.failed;
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-ink-soft">{formatDateTime(r.createdAt)}</td>
                  <td>{EVENT[r.event] ?? r.event}</td>
                  <td>
                    {r.channel === "zalo" ? "Zalo" : "Email"} <span className="block font-mono text-xs text-ink-soft">{r.recipient}</span>
                  </td>
                  <td className="max-w-xs truncate" title={r.body}>
                    {r.subject}
                  </td>
                  <td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {r.attempts > 1 && <span className="ml-1 text-xs text-ink-soft">{r.attempts} lần</span>}
                    {r.error && <span className="mt-1 block max-w-xs text-xs text-danger">{r.error}</span>}
                    {r.status !== "sent" && (
                      <ActionForm action={retryAction} submitLabel="Gửi lại" pendingLabel="…" className="mt-1" submitClassName="text-xs underline underline-offset-4" inline>
                        <input type="hidden" name="id" value={r.id} />
                      </ActionForm>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
