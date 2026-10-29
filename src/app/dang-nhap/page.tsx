import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bubbles, Wordmark } from "@/components/brand";
import { readSession, staffCount } from "@/modules/auth/service";
import { setupMode } from "@/modules/auth/setup";
import { LoginForm, MfaForm, SetupForm, SetupTokenGenerator } from "./forms";

export const metadata: Metadata = { title: "Đăng nhập quản trị", robots: { index: false } };

const REASON: Record<string, string> = {
  expired: "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.",
  inactive: "Tài khoản đã bị tạm khóa. Liên hệ chủ cửa hàng.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reason?: string; buoc?: string }> }) {
  const [{ reason }, session, staff] = await Promise.all([searchParams, readSession(), staffCount()]);
  if (session.ok) redirect("/admin");

  const mode = staff === 0 ? "setup" : !session.ok && session.reason === "mfa_required" ? "mfa" : "login";
  const gate = setupMode({ nodeEnv: process.env.NODE_ENV, setupToken: process.env.SETUP_TOKEN });

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-pith px-4 py-16">
      <div className="dots dots-move pointer-events-none absolute inset-0 opacity-25 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" aria-hidden="true" />
      <Bubbles className="text-rind/40" />
      <div className="enter relative w-full max-w-sm">
        <Link href="/" className="mb-6 flex min-h-11 items-center justify-center" aria-label="Về trang chủ">
          <Wordmark className="text-xl" />
        </Link>
        <div className="border border-line bg-bone p-7 shadow-sm">
          {mode === "setup" && (
            <>
              <h1 className="text-xl font-medium">Khởi tạo quản trị</h1>
              {gate === "disabled" ? (
                <div className="mt-3 border border-line bg-paper p-4 text-sm leading-relaxed text-graphite" role="status">
                  <p>Trang quản trị chưa có chủ cửa hàng. Để tạo, làm 3 bước (không cần cài gì):</p>
                  <SetupTokenGenerator />
                  <ol className="mt-4 list-decimal space-y-3 pl-5">
                    <li>
                      Bấm “Tạo chuỗi ngẫu nhiên” ở trên rồi bấm “Chép”. Mở Vercel → chọn dự án → <b className="font-medium">Settings</b> → <b className="font-medium">Environment Variables</b>. Ô Key gõ <code className="font-mono">SETUP_TOKEN</code>, ô Value dán chuỗi vừa chép, ô Environments chỉ chọn <b className="font-medium">Production</b>, rồi bấm Save.
                    </li>
                    <li>
                      Mở thẻ <b className="font-medium">Deployments</b>, bấm nút ⋯ ở dòng trên cùng → <b className="font-medium">Redeploy</b> → Redeploy. Chờ khoảng 1–2 phút tới khi dòng đó báo Ready.
                    </li>
                    <li>Quay lại trang này, tải lại trang, dán chuỗi vào ô Mã khởi tạo và điền tên, email, mật khẩu.</li>
                  </ol>
                  <p className="mt-3 text-ink-soft">
                    Giữ chuỗi tới khi xong bước 3 (tải lại trang thì ô trên sẽ trống). Lỡ mất thì tạo chuỗi mới, sửa giá trị SETUP_TOKEN trên Vercel và Redeploy lại. Không gửi chuỗi này qua Zalo hay email.
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-6 mt-2 text-sm text-ink-soft">
                    Chưa có tài khoản nào. Tài khoản đầu tiên là chủ cửa hàng, có toàn quyền.
                    {gate === "token" && " Nhập mã khởi tạo (chuỗi bạn đã đặt cho SETUP_TOKEN) để xác nhận bạn là người cài đặt."}
                  </p>
                  <SetupForm needsToken={gate === "token"} />
                </>
              )}
            </>
          )}
          {mode === "mfa" && (
            <>
              <h1 className="text-xl font-medium">Xác thực 2 lớp</h1>
              <p className="mb-6 mt-2 text-sm text-ink-soft">Mở ứng dụng xác thực trên điện thoại và nhập mã đang hiện.</p>
              <MfaForm />
            </>
          )}
          {mode === "login" && (
            <>
              <h1 className="text-xl font-medium">Đăng nhập quản trị</h1>
              {reason && REASON[reason] ? <p className="mb-6 mt-2 text-sm text-danger">{REASON[reason]}</p> : <p className="mb-6 mt-2 text-sm text-ink-soft">Dành cho nhân viên Pomil.</p>}
              <LoginForm />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
