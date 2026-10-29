import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/modules/accounts/rules";
import { currentCustomer } from "@/modules/accounts/service";
import { getSettings } from "@/modules/settings/service";
import { CustomerLoginForm } from "../forms";

export const metadata: Metadata = { title: "Đăng nhập", robots: { index: false } };

export default async function CustomerLoginPage({ searchParams }: { searchParams: Promise<{ tiep?: string }> }) {
  const { tiep } = await searchParams;
  const next = tiep ? safeNextPath(tiep) : undefined;
  if (await currentCustomer()) redirect(next ?? "/tai-khoan");
  const settings = await getSettings();

  return (
    <div className="mx-auto max-w-md px-4 py-14 sm:px-6">
      <p className="eyebrow enter text-rind">Tài khoản</p>
      <h1 className="display enter mt-4 text-4xl" style={{ ["--d" as string]: "100ms" }}>Đăng nhập</h1>
      <p className="mt-3 text-ink-soft">Xem lại đơn đã đặt, điền sẵn địa chỉ khi mua lần sau và gửi đánh giá cho từng chai.</p>
      <div className="mt-8 border border-line bg-paper p-6">
        <CustomerLoginForm next={next} />
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        Chưa có tài khoản?{" "}
        <Link href={next ? `/tai-khoan/dang-ky?tiep=${encodeURIComponent(next)}` : "/tai-khoan/dang-ky"} className="text-graphite underline underline-offset-4">
          Tạo tài khoản
        </Link>
      </p>
      <p className="mt-2 text-sm text-ink-soft">
        Quên mật khẩu? Nhắn Zalo{settings.zalo ? ` ${settings.zalo}` : " Pomil"} từ số đã đăng ký, Pomil gửi bạn mật khẩu tạm.
      </p>
      <p className="mt-2 text-sm text-ink-soft">
        Không cần tài khoản vẫn mua được.{" "}
        <Link href="/tra-cuu-don" className="underline underline-offset-4">
          Tra cứu đơn bằng mã đơn
        </Link>
      </p>
    </div>
  );
}
