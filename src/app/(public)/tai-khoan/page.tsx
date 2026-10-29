import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { displayPhone, formatDateTime, formatVnd } from "@/lib/format";
import { currentCustomer, listAccountOrders } from "@/modules/accounts/service";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/modules/orders/rules";
import { listMyReviews } from "@/modules/reviews/service";
import { listPublicProducts } from "@/modules/catalog/service";
import { customerLogoutAction } from "./actions";
import { PasswordForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Tài khoản", robots: { index: false } };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ moi?: string }> }) {
  const me = await currentCustomer();
  if (!me) redirect("/tai-khoan/dang-nhap");
  const [{ moi }, orders, reviews, products] = await Promise.all([searchParams, listAccountOrders(me.accountId), listMyReviews(me.accountId), listPublicProducts()]);

  // Sản phẩm đã nhận mà chưa đánh giá: mời khách góp ý
  const reviewed = new Set(reviews.map((r) => r.productSlug));
  const deliveredIds = new Set(orders.filter((o) => o.status === "delivered").flatMap((o) => o.items.map((i) => i.productId)));
  const toReview = products.filter((p) => deliveredIds.has(p.id) && !reviewed.has(p.slug));

  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow enter text-rind">Tài khoản</p>
          <h1 className="display enter mt-4 text-4xl sm:text-5xl" style={{ ["--d" as string]: "100ms" }}>
            Chào {me.name || "bạn"}
          </h1>
          <p className="mt-2 text-ink-soft">{displayPhone(me.phoneE164)}</p>
        </div>
        <form action={customerLogoutAction}>
          <button className="inline-flex min-h-11 items-center text-sm text-ink-soft underline underline-offset-4 hover:text-graphite">Đăng xuất</button>
        </form>
      </div>

      {moi && (
        <p className="mt-8 border border-line bg-paper p-4 text-sm" role="status">
          Đã tạo tài khoản. Đơn bạn đặt khi đang đăng nhập sẽ hiện ở đây. Đơn cũ đặt trước đó vẫn xem được bằng đường dẫn trong tin xác nhận hoặc ở{" "}
          <Link href="/tra-cuu-don" className="underline underline-offset-4">
            Tra cứu đơn
          </Link>
          .
        </p>
      )}

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-12">
          {toReview.length > 0 && (
            <section data-reveal>
              <h2 className="eyebrow">Chờ bạn đánh giá</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {toReview.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 border border-graphite bg-paper p-4">
                    <span>{p.name}</span>
                    <Link href={`/san-pham/${p.slug}#danh-gia`} className="btn btn-primary min-h-10 px-4 text-sm">
                      Đánh giá
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section data-reveal>
            <h2 className="eyebrow">Đơn hàng</h2>
            {orders.length === 0 ? (
              <p className="mt-4 text-ink-soft">
                Chưa có đơn nào đặt từ tài khoản này.{" "}
                <Link href="/san-pham" className="text-graphite underline underline-offset-4">
                  Xem sản phẩm
                </Link>
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {orders.map((o) => (
                  <li key={o.code} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <p className="font-mono text-sm">{o.code}</p>
                      <p className="mt-1 text-sm text-ink-soft">
                        {formatDateTime(o.createdAt)} · {o.items.map((i) => `${i.productName} × ${i.quantity}`).join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 sm:justify-end">
                      <span className="text-sm">{ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status}</span>
                      <span className="price">{formatVnd(o.total)}</span>
                      <Link href={`/don-hang/${o.code}?t=${o.accessToken}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
                        Xem
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section data-reveal>
            <h2 className="eyebrow">Đánh giá của bạn</h2>
            {reviews.length === 0 ? (
              <p className="mt-4 text-ink-soft">Bạn chưa gửi đánh giá nào. Mỗi góp ý đều được đọc và ghi lại để chỉnh lô sau.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {reviews.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
                    <span>
                      {r.productName} · <span aria-label={`${r.rating} trên 5 sao`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                    </span>
                    <span className="flex items-center gap-4">
                      <span className="text-ink-soft">{r.status === "published" ? "Đang hiện trên web" : r.status === "new" ? "Pomil đang đọc" : "Đã ghi nhận"}</span>
                      <Link href={`/san-pham/${r.productSlug}#danh-gia`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                        Sửa
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-10">
          <section className="border border-line bg-paper p-5">
            <h2 className="eyebrow mb-4">Thông tin</h2>
            <ProfileForm name={me.name} />
          </section>
          <section className="border border-line bg-paper p-5">
            <h2 className="eyebrow mb-4">Đổi mật khẩu</h2>
            <PasswordForm />
          </section>
        </aside>
      </div>
    </div>
  );
}
