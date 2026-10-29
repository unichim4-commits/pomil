import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { can, ROLE_LABEL } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listStaff } from "@/modules/auth/staff";
import { ActionForm } from "../_components/action-form";
import { Badge, Card, PageHeader } from "../_components/ui";
import { createStaffAction, resetPasswordAction, updateStaffAction } from "./actions";

export const metadata: Metadata = { title: "Nhân viên" };

const ROLE_HELP = {
  owner: "Toàn quyền, gồm cài đặt và nhân viên",
  collaborator: "Xử lý đơn, sản phẩm, nội dung, lô, phản ánh",
  viewer: "Chỉ xem, số điện thoại khách bị che",
};

export default async function StaffPage() {
  const me = await requireStaff();
  if (!can(me.role, "staff.manage")) redirect("/admin");
  const staff = await listStaff();

  return (
    <>
      <PageHeader title="Nhân viên" description="Mỗi người một tài khoản riêng để nhật ký thao tác ghi đúng người. Không dùng chung mật khẩu." />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {staff.map((s) => (
            <Card key={s.id}>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <p className="font-medium">{s.email}</p>
                {s.id === me.id && <Badge>Bạn</Badge>}
                {s.totpEnabledAt ? <Badge tone="green">Đã bật 2 lớp</Badge> : <Badge tone="amber">Chưa bật 2 lớp</Badge>}
                {!s.active && <Badge tone="red">Đã khóa</Badge>}
                <span className="ml-auto text-xs text-ink-soft">Đăng nhập gần nhất: {s.lastLoginAt ? formatDateTime(s.lastLoginAt) : "chưa"}</span>
              </div>
              <ActionForm action={updateStaffAction} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto_auto] sm:items-end">
                <input type="hidden" name="id" value={s.id} />
                <label className="block">
                  <span className="field-label">Tên</span>
                  <input name="name" defaultValue={s.name} className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Vai trò</span>
                  <select name="role" defaultValue={s.role} className="field">
                    {Object.entries(ROLE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-3 text-sm">
                  <input type="checkbox" name="active" defaultChecked={s.active} className="accent-graphite" /> Hoạt động
                </label>
              </ActionForm>
              {s.id !== me.id && (
                <details className="mt-3 text-sm">
                  <summary className="flex min-h-11 cursor-pointer items-center text-ink-soft">Đặt lại mật khẩu</summary>
                  <ActionForm action={resetPasswordAction} submitLabel="Đặt mật khẩu" className="mt-3 flex flex-wrap items-center gap-3" resetOnSuccess>
                    <input type="hidden" name="id" value={s.id} />
                    <input name="password" type="text" minLength={10} required placeholder="Mật khẩu tạm, ít nhất 10 ký tự" autoComplete="off" className="field max-w-xs" />
                  </ActionForm>
                </details>
              )}
            </Card>
          ))}
        </div>
        <Card title="Thêm nhân viên">
          <ActionForm action={createStaffAction} submitLabel="Tạo tài khoản" resetOnSuccess>
            <label className="block">
              <span className="field-label">Email</span>
              <input name="email" type="email" required className="field" autoComplete="off" />
            </label>
            <label className="block">
              <span className="field-label">Tên</span>
              <input name="name" required className="field" />
            </label>
            <fieldset className="space-y-2">
              <legend className="field-label">Vai trò</legend>
              {(Object.keys(ROLE_HELP) as (keyof typeof ROLE_HELP)[]).map((r) => (
                <label key={r} className="flex items-start gap-2 text-sm">
                  <input type="radio" name="role" value={r} defaultChecked={r === "collaborator"} className="mt-1 accent-graphite" />
                  <span>
                    {ROLE_LABEL[r]} <span className="block text-xs text-ink-soft">{ROLE_HELP[r]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="block">
              <span className="field-label">Mật khẩu tạm (ít nhất 10 ký tự)</span>
              <input name="password" type="text" minLength={10} required className="field" autoComplete="off" />
            </label>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
