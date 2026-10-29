import type { Metadata } from "next";
import Link from "next/link";
import { displayPhone, formatDateTime } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import {
  describePublishProblem,
  REVIEW_STATUS_LABEL,
  reviewPublishProblem,
  SCALP_FEEL,
  USED_FOR,
  WOULD_REBUY,
  type ScalpFeel,
  type UsedFor,
  type WouldRebuy,
} from "@/modules/reviews/rules";
import { listReviewsForAdmin, reviewStatsByProduct } from "@/modules/reviews/service";
import { ActionForm } from "../_components/action-form";
import { Badge, Card, Empty, FilterTabs, PageHeader } from "../_components/ui";
import { reviewStatusAction } from "./actions";

export const metadata: Metadata = { title: "Đánh giá" };

type Status = keyof typeof REVIEW_STATUS_LABEL;
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export default async function ReviewsAdminPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && sp.status in REVIEW_STATUS_LABEL ? (sp.status as Status) : undefined;
  const [staff, rows, stats] = await Promise.all([requireStaff(), listReviewsForAdmin({ status }), reviewStatsByProduct()]);
  const canWrite = can(staff.role, "reviews.write");
  const showPhone = can(staff.role, "customers.view_phone");

  return (
    <>
      <PageHeader
        title="Đánh giá sản phẩm"
        description="Đọc hết, kể cả đánh giá thấp. Ghi điều cần sửa vào ghi chú. Chỉ hiện trên web khi khách đồng ý và câu chữ không hứa công dụng như thuốc."
      />

      {stats.length > 0 && (
        <Card title="Theo sản phẩm (mọi đánh giá, kể cả nội bộ)" className="mb-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-soft">
                <tr>
                  <th className="py-2 pr-4 font-normal">Sản phẩm</th>
                  <th className="py-2 pr-4 font-normal">Số đánh giá</th>
                  <th className="py-2 pr-4 font-normal">Điểm TB</th>
                  <th className="py-2 pr-4 font-normal">Mùi TB</th>
                  <th className="py-2 pr-4 font-normal">Sẽ mua lại</th>
                  <th className="py-2 pr-4 font-normal">Báo ngứa</th>
                  <th className="py-2 font-normal">Bết / khô</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stats.map((s) => (
                  <tr key={s.productId}>
                    <td className="py-2 pr-4">{s.productName}</td>
                    <td className="py-2 pr-4">{s.summary.count}</td>
                    <td className="py-2 pr-4">{s.summary.average ?? "—"}</td>
                    <td className="py-2 pr-4">{s.summary.scentAverage ?? "—"}</td>
                    <td className="py-2 pr-4">{pct(s.summary.rebuyRate)}</td>
                    <td className={`py-2 pr-4 ${s.summary.irritationRate && s.summary.irritationRate > 0.05 ? "text-danger" : ""}`}>{pct(s.summary.irritationRate)}</td>
                    <td className="py-2">
                      {s.summary.feel.bet} / {s.summary.feel.kho}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-soft">Báo ngứa trên 5% thì đối chiếu số lô với trang Phản ánh và Lô.</p>
        </Card>
      )}

      <FilterTabs
        active={status ?? "all"}
        items={[
          { key: "all", label: "Tất cả", href: "/admin/danh-gia" },
          ...(Object.keys(REVIEW_STATUS_LABEL) as Status[]).map((s) => ({ key: s, label: REVIEW_STATUS_LABEL[s], href: `/admin/danh-gia?status=${s}` })),
        ]}
      />

      {rows.length === 0 ? (
        <Empty>Chưa có đánh giá nào.</Empty>
      ) : (
        <div className="space-y-4">
          {rows.map(({ review: r, productName, customerId, customerName, phoneE164 }) => {
            const problem = reviewPublishProblem(r);
            return (
              <article key={r.id} className="border border-line bg-paper p-5">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-lg" aria-label={`${r.rating} sao`}>
                    {"★".repeat(r.rating)}
                    <span className="text-line">{"★".repeat(5 - r.rating)}</span>
                  </span>
                  <span className="font-medium">{productName}</span>
                  <Badge tone={r.status === "published" ? "green" : "neutral"}>{REVIEW_STATUS_LABEL[r.status]}</Badge>
                  {r.verifiedPurchase && <Badge tone="neutral">Đã mua</Badge>}
                  {r.scalpFeel === "ngua" && <Badge tone="red">Ngứa / châm chích</Badge>}
                  <span className="text-ink-soft">{formatDateTime(r.createdAt)}</span>
                  <Link href={`/admin/khach-hang/${customerId}`} className="ml-auto underline underline-offset-4">
                    {customerName || "Khách"} · {phoneE164 ? (showPhone ? displayPhone(phoneE164) : maskPhone(phoneE164)) : ""}
                  </Link>
                </div>
                <p className="mt-2 text-xs text-ink-soft">
                  {[
                    r.scalpFeel && `Da đầu: ${SCALP_FEEL[r.scalpFeel as ScalpFeel] ?? r.scalpFeel}`,
                    r.scentRating && `Mùi: ${r.scentRating}/5`,
                    r.wouldRebuy && `Mua lại: ${WOULD_REBUY[r.wouldRebuy as WouldRebuy] ?? r.wouldRebuy}`,
                    r.usedFor && `Đã dùng: ${USED_FOR[r.usedFor as UsedFor] ?? r.usedFor}`,
                    r.publishConsent ? "Cho hiện công khai" : "Không cho hiện",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {r.comment && <p className="mt-3">{r.comment}</p>}
                {r.suggestion && (
                  <p className="mt-3 border-l-2 border-graphite pl-3 text-sm">
                    <span className="eyebrow mr-2 text-[0.65rem]">Góp ý</span>
                    {r.suggestion}
                  </p>
                )}
                {problem && <p className="mt-3 text-xs text-ink-soft">{describePublishProblem(problem)}</p>}
                {canWrite ? (
                  <ActionForm action={reviewStatusAction} submitLabel="Lưu" className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-[11rem_1fr_auto] md:items-end">
                    <input type="hidden" name="id" value={r.id} />
                    <label className="block">
                      <span className="field-label">Trạng thái</span>
                      <select name="status" defaultValue={r.status} className="field">
                        {(Object.keys(REVIEW_STATUS_LABEL) as Status[]).map((k) => (
                          <option key={k} value={k} disabled={k === "published" && !!problem}>
                            {REVIEW_STATUS_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Ghi chú nội bộ (cần sửa gì)</span>
                      <input name="staffNote" defaultValue={r.staffNote ?? ""} className="field" />
                    </label>
                  </ActionForm>
                ) : (
                  r.staffNote && <p className="mt-3 text-sm text-ink-soft">Ghi chú: {r.staffNote}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
