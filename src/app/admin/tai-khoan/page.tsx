import type { Metadata } from "next";
import QRCode from "qrcode";
import { ROLE_LABEL } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { otpauthUrl } from "@/modules/auth/totp";
import { ActionForm } from "../_components/action-form";
import { Card, PageHeader } from "../_components/ui";
import { changePasswordAction, confirmTotpAction, disableTotpAction, readPendingTotp, startTotpAction } from "./actions";

export const metadata: Metadata = { title: "Tài khoản của tôi" };

export default async function AccountPage() {
  const me = await requireStaff();
  const pending = me.totpEnabled ? null : await readPendingTotp();
  const qrSvg = pending ? await QRCode.toString(otpauthUrl("Pomil OS", me.email, pending), { type: "svg", margin: 1, width: 200 }) : null;

  return (
    <>
      <PageHeader title="Tài khoản của tôi" description={`${me.email} · ${ROLE_LABEL[me.role]}`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Xác thực 2 lớp">
          {me.totpEnabled ? (
            <>
              <p className="text-sm">Đang bật. Mỗi lần đăng nhập cần mã 6 số trong ứng dụng xác thực.</p>
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-ink-soft">Tắt xác thực 2 lớp</summary>
                <ActionForm action={disableTotpAction} submitLabel="Tắt" submitClassName="btn btn-outline" className="mt-3 flex items-center gap-3">
                  <input name="code" inputMode="numeric" maxLength={7} required placeholder="Mã hiện tại" className="field max-w-40 font-mono" />
                </ActionForm>
              </details>
            </>
          ) : pending && qrSvg ? (
            <div className="space-y-4 text-sm">
              <p>1. Mở Google Authenticator, Microsoft Authenticator hoặc 1Password và quét mã:</p>
              <div className="w-48 bg-white p-2" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <p className="text-xs text-ink-soft">
                Không quét được? Nhập khóa: <span className="select-all break-all font-mono">{pending}</span>
              </p>
              <p>2. Nhập mã 6 số đang hiện để xác nhận:</p>
              <ActionForm action={confirmTotpAction} submitLabel="Bật xác thực 2 lớp" className="flex flex-wrap items-center gap-3">
                <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required className="field max-w-40 text-center font-mono text-lg tracking-widest" />
              </ActionForm>
            </div>
          ) : (
            <>
              <p className="text-sm text-ink-soft">Nên bật cho mọi tài khoản xem được số điện thoại khách. Mất mật khẩu thì người khác vẫn không vào được.</p>
              <form action={startTotpAction} className="mt-4">
                <button className="btn btn-primary">Bắt đầu bật</button>
              </form>
            </>
          )}
        </Card>

        <Card title="Đổi mật khẩu">
          <ActionForm action={changePasswordAction} submitLabel="Đổi mật khẩu" resetOnSuccess>
            <label className="block">
              <span className="field-label">Mật khẩu hiện tại</span>
              <input name="current" type="password" required autoComplete="current-password" className="field" />
            </label>
            <label className="block">
              <span className="field-label">Mật khẩu mới (ít nhất 10 ký tự)</span>
              <input name="next" type="password" required minLength={10} autoComplete="new-password" className="field" />
            </label>
            <label className="block">
              <span className="field-label">Nhập lại mật khẩu mới</span>
              <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className="field" />
            </label>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
