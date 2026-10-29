import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/modules/accounts/rules";
import { currentCustomer } from "@/modules/accounts/service";
import { ACCOUNT_DATA_CONSENT_TEXT } from "@/modules/consent/texts";
import { RegisterForm } from "../forms";

export const metadata: Metadata = { title: "Tạo tài khoản", robots: { index: false } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ tiep?: string }> }) {
  const { tiep } = await searchParams;
  const next = tiep ? safeNextPath(tiep) : undefined;
  if (await currentCustomer()) redirect(next ?? "/tai-khoan");

  return (
    <div className="mx-auto max-w-lg px-4 py-14 sm:px-6">
      <p className="eyebrow enter text-rind">Tài khoản</p>
      <h1 className="display enter mt-4 text-4xl" style={{ ["--d" as string]: "100ms" }}>Tạo tài khoản</h1>
      <p className="mt-3 text-ink-soft">Một phút. Không bắt buộc để mua hàng.</p>
      <div className="mt-8 border border-line bg-paper p-6">
        <RegisterForm next={next} consentText={ACCOUNT_DATA_CONSENT_TEXT} />
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        Đã có tài khoản?{" "}
        <Link href={next ? `/tai-khoan/dang-nhap?tiep=${encodeURIComponent(next)}` : "/tai-khoan/dang-nhap"} className="text-graphite underline underline-offset-4">
          Đăng nhập
        </Link>
      </p>
    </div>
  );
}
