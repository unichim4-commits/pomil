import type { Metadata } from "next";
import Link from "next/link";
import { displayPhone, formatDateTime } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import {
  ACTION_STATUS,
  AGE_RANGE,
  ASPECTS,
  CHANNEL,
  COMPARED_BEFORE,
  CONCERNS,
  describePublishProblem,
  HABITS,
  ISSUE_TAGS,
  pickKeys,
  REVIEW_STATUS_LABEL,
  reviewPublishProblem,
  SCALP_FEEL,
  SCALP_TYPE,
  SCENT_INTENSITY,
  USAGE_FREQUENCY,
  USED_FOR,
  WOULD_REBUY,
  type ActionStatus,
  type Aspect,
} from "@/modules/reviews/rules";
import { listReviewsForAdmin, reviewStatsByProduct } from "@/modules/reviews/service";
import { ActionForm } from "../_components/action-form";
import { Badge, Card, Empty, FilterTabs, PageHeader } from "../_components/ui";
import { reviewStatusAction } from "./actions";

export const metadata: Metadata = { title: "Đánh giá và góp ý" };

type Status = keyof typeof REVIEW_STATUS_LABEL;
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const label = (map: Record<string, string>, v: string | null | undefined) => (v ? (map[v] ?? v) : null);
const labels = (map: Record<string, string>, vs: readonly string[] | null | undefined) =>
  pickKeys(map, vs ?? [])
    .map((k) => map[k])
    .join(", ");

export default async function ReviewsAdminPage({ searchParams }: { searchParams: Promise<{ status?: string; sp?: string; xl?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && sp.status in REVIEW_STATUS_LABEL ? (sp.status as Status) : undefined;
  const actionStatus = sp.xl && sp.xl in ACTION_STATUS ? (sp.xl as ActionStatus) : undefined;
  const [staff, stats] = await Promise.all([requireStaff(), reviewStatsByProduct()]);
  const productId = sp.sp && stats.some((s) => s.productId === sp.sp) ? sp.sp : undefined;
  const rows = await listReviewsForAdmin({ status, productId, actionStatus });
  const canWrite = can(staff.role, "reviews.write");
  const showPhone = can(staff.role, "customers.view_phone");

  const href = (next: { status?: string; sp?: string; xl?: string }) => {
    const q = new URLSearchParams();
    const merged = { status, sp: productId, xl: actionStatus, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return `/admin/danh-gia${s ? `?${s}` : ""}`;
  };
  const csvQuery = new URLSearchParams(Object.entries({ status, sp: productId, xl: actionStatus }).filter((e): e is [string, string] => !!e[1])).toString();

  return (
    <>
      <PageHeader
        title="Đánh giá và góp ý"
        description="Đọc hết, kể cả góp ý chê. Gắn nhãn vấn đề, ghi việc đã làm cho lô sau. Chỉ hiện trên web khi khách đồng ý và câu chữ không hứa công dụng như thuốc."
        actions={
          <a href={`/admin/danh-gia/csv${csvQuery ? `?${csvQuery}` : ""}`} className="btn btn-outline">
            Tải CSV
          </a>
        }
      />

      {stats.length > 0 && (
        <Card title="Theo sản phẩm (mọi góp ý, kể cả nội bộ)" className="mb-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-soft">
                <tr>
                  <th className="py-2 pr-4 font-normal">Sản phẩm</th>
                  <th className="py-2 pr-4 font-normal">Số góp ý</th>
                  <th className="py-2 pr-4 font-normal">Sao TB</th>
                  <th className="py-2 pr-4 font-normal">NPS</th>
                  <th className="py-2 pr-4 font-normal">Sẽ mua lại</th>
                  <th className="py-2 pr-4 font-normal">Dễ chịu hơn</th>
                  <th className="py-2 pr-4 font-normal">Báo ngứa</th>
                  <th className="py-2 pr-4 font-normal">Mùi TB (đậm / nhẹ quá)</th>
                  {(Object.keys(ASPECTS) as Aspect[]).map((k) => (
                    <th key={k} className="py-2 pr-4 font-normal">
                      {ASPECTS[k]}
                    </th>
                  ))}
                  <th className="py-2 font-normal">Vấn đề nhiều nhất</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stats.map((s) => (
                  <tr key={s.productId}>
                    <td className="py-2 pr-4">
                      <Link href={href({ sp: s.productId })} className="underline underline-offset-4">
                        {s.productName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{s.summary.count}</td>
                    <td className="py-2 pr-4">{s.summary.average ?? "—"}</td>
                    <td className={`py-2 pr-4 ${s.summary.nps !== null && s.summary.nps < 0 ? "text-danger" : ""}`}>{s.summary.nps ?? "—"}</td>
                    <td className="py-2 pr-4">{pct(s.summary.rebuyRate)}</td>
                    <td className="py-2 pr-4">{pct(s.summary.better)}</td>
                    <td className={`py-2 pr-4 ${s.summary.irritationRate && s.summary.irritationRate > 0.05 ? "text-danger" : ""}`}>{pct(s.summary.irritationRate)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {s.summary.scentAverage ?? "—"} ({s.summary.scentTooStrong} / {s.summary.scentTooLight})
                    </td>
                    {(Object.keys(ASPECTS) as Aspect[]).map((k) => (
                      <td key={k} className={`py-2 pr-4 ${s.summary.aspects[k] !== null && s.summary.aspects[k]! < 3 ? "text-danger" : ""}`}>
                        {s.summary.aspects[k] ?? "—"}
                      </td>
                    ))}
                    <td className="py-2">
                      {s.summary.issues
                        .slice(0, 3)
                        .map((i) => `${i.label} (${i.count})`)
                        .join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            NPS = % chấm 9–10 trừ % chấm 0–6. Báo ngứa trên 5% thì đối chiếu số lô với trang Phản ánh và Lô. Điểm từng mặt dưới 3 tô đỏ. Bấm tên sản phẩm để lọc.
          </p>
        </Card>
      )}

      <FilterTabs
        active={status ?? "all"}
        items={[
          { key: "all", label: "Tất cả", href: href({ status: "" }) },
          ...(Object.keys(REVIEW_STATUS_LABEL) as Status[]).map((s) => ({ key: s, label: REVIEW_STATUS_LABEL[s], href: href({ status: s }) })),
        ]}
      />
      <FilterTabs
        active={actionStatus ?? "all"}
        items={[
          { key: "all", label: "Mọi trạng thái xử lý", href: href({ xl: "" }) },
          ...(Object.keys(ACTION_STATUS) as ActionStatus[]).map((s) => ({ key: s, label: ACTION_STATUS[s], href: href({ xl: s }) })),
        ]}
      />
      {productId && (
        <p className="mb-4 text-sm">
          Đang lọc: {stats.find((s) => s.productId === productId)?.productName} ·{" "}
          <Link href={href({ sp: "" })} className="underline underline-offset-4">
            Bỏ lọc sản phẩm
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <Empty>Chưa có góp ý nào khớp bộ lọc.</Empty>
      ) : (
        <div className="space-y-4">
          {rows.map(({ review: r, productName, customerId, customerName, phoneE164, lotNo }) => {
            const problem = reviewPublishProblem(r);
            const phone = phoneE164 ?? r.contactPhone;
            const who = (
              <>
                {customerName || r.guestName || "Khách"}
                {phone ? ` · ${showPhone ? displayPhone(phone) : maskPhone(phone)}` : ""}
              </>
            );
            const aspectLine = (Object.keys(ASPECTS) as Aspect[])
              .filter((k) => r.aspectRatings?.[k])
              .map((k) => `${ASPECTS[k]} ${r.aspectRatings[k]}/5`)
              .join(" · ");
            const profile = [
              label(SCALP_TYPE, r.scalpType) && `Da đầu ${label(SCALP_TYPE, r.scalpType)!.toLowerCase()}`,
              label(AGE_RANGE, r.ageRange) && `Tuổi ${label(AGE_RANGE, r.ageRange)}`,
              labels(CONCERNS, r.concerns) && `Hay gặp: ${labels(CONCERNS, r.concerns)}`,
              labels(HABITS, r.habits) && `Thói quen: ${labels(HABITS, r.habits)}`,
            ].filter(Boolean);
            return (
              <article key={r.id} className="border border-line bg-paper p-5">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-lg" aria-label={`${r.rating} sao`}>
                    {"★".repeat(r.rating)}
                    <span className="text-line">{"★".repeat(5 - r.rating)}</span>
                  </span>
                  <span className="font-medium">{productName}</span>
                  <Badge tone={r.status === "published" ? "green" : "neutral"}>{REVIEW_STATUS_LABEL[r.status]}</Badge>
                  <Badge tone={r.actionStatus === "da_xong" ? "green" : r.actionStatus === "chua_xu_ly" ? "neutral" : "amber"}>
                    {ACTION_STATUS[r.actionStatus as ActionStatus] ?? r.actionStatus}
                  </Badge>
                  {r.verifiedPurchase && <Badge tone="neutral">Đã mua</Badge>}
                  {!r.accountId && <Badge tone="neutral">Khách không tài khoản</Badge>}
                  {r.scalpFeel === "ngua" && <Badge tone="red">Ngứa / châm chích</Badge>}
                  {r.followUpConsent && <Badge tone="neutral">Đồng ý được hỏi thêm</Badge>}
                  <span className="text-ink-soft">{formatDateTime(r.createdAt)}</span>
                  {customerId ? (
                    <Link href={`/admin/khach-hang/${customerId}`} className="ml-auto underline underline-offset-4">
                      {who}
                    </Link>
                  ) : (
                    <span className="ml-auto">{who}</span>
                  )}
                </div>
                <p className="mt-2 text-xs text-ink-soft">
                  {[
                    lotNo ? `Lô ${lotNo}` : r.reportedLotNo ? `Lô khách ghi: ${r.reportedLotNo} (không khớp)` : "Không có số lô",
                    label(CHANNEL, r.channel) && `Mua ở: ${label(CHANNEL, r.channel)}`,
                    label(USED_FOR, r.usedFor) && `Đã dùng: ${label(USED_FOR, r.usedFor)}`,
                    label(USAGE_FREQUENCY, r.usageFrequency),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {profile.length > 0 && <p className="mt-1 text-xs text-ink-soft">{profile.join(" · ")}</p>}
                <p className="mt-1 text-xs text-ink-soft">
                  {[
                    label(SCALP_FEEL, r.scalpFeel) && `Sau khi dùng: ${label(SCALP_FEEL, r.scalpFeel)}`,
                    label(COMPARED_BEFORE, r.comparedBefore) && `So với trước: ${label(COMPARED_BEFORE, r.comparedBefore)!.toLowerCase()}`,
                    r.scentRating && `Mùi: ${r.scentRating}/5`,
                    label(SCENT_INTENSITY, r.scentIntensity) && `Độ đậm mùi: ${label(SCENT_INTENSITY, r.scentIntensity)!.toLowerCase()}`,
                    label(WOULD_REBUY, r.wouldRebuy) && `Mua lại: ${label(WOULD_REBUY, r.wouldRebuy)}`,
                    r.nps !== null && `Giới thiệu: ${r.nps}/10`,
                    r.publishConsent ? "Cho hiện công khai" : "Không cho hiện",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {aspectLine && <p className="mt-1 text-xs text-ink-soft">{aspectLine}</p>}
                {r.comment && <p className="mt-3">{r.comment}</p>}
                {r.suggestion && (
                  <p className="mt-3 border-l-2 border-graphite pl-3 text-sm">
                    <span className="eyebrow mr-2 text-[0.65rem]">Góp ý</span>
                    {r.suggestion}
                  </p>
                )}
                {problem && <p className="mt-3 text-xs text-ink-soft">{describePublishProblem(problem)}</p>}
                {canWrite ? (
                  <ActionForm action={reviewStatusAction} submitLabel="Lưu" className="mt-4 space-y-3 border-t border-line pt-4">
                    <input type="hidden" name="id" value={r.id} />
                    <fieldset>
                      <legend className="field-label">Nhãn vấn đề</legend>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {Object.entries(ISSUE_TAGS).map(([k, v]) => (
                          <label key={k} className="flex items-center gap-1.5">
                            <input type="checkbox" name="issueTags" value={k} defaultChecked={r.issueTags?.includes(k)} className="accent-graphite" />
                            {v}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="grid gap-3 md:grid-cols-[11rem_11rem_1fr]">
                      <label className="block">
                        <span className="field-label">Hiện trên web</span>
                        <select name="status" defaultValue={r.status} className="field">
                          {(Object.keys(REVIEW_STATUS_LABEL) as Status[]).map((k) => (
                            <option key={k} value={k} disabled={k === "published" && !!problem}>
                              {REVIEW_STATUS_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="field-label">Xử lý</span>
                        <select name="actionStatus" defaultValue={r.actionStatus} className="field">
                          {(Object.keys(ACTION_STATUS) as ActionStatus[]).map((k) => (
                            <option key={k} value={k}>
                              {ACTION_STATUS[k]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="field-label">Ghi chú nội bộ (cần sửa gì)</span>
                        <input name="staffNote" defaultValue={r.staffNote ?? ""} className="field" />
                      </label>
                    </div>
                    <label className="block">
                      <span className="field-label">Việc đã làm (ví dụ: giảm tinh dầu bưởi 0,2% từ lô PST-271201-01)</span>
                      <input name="actionTaken" defaultValue={r.actionTaken ?? ""} className="field" />
                    </label>
                  </ActionForm>
                ) : (
                  <>
                    {r.staffNote && <p className="mt-3 text-sm text-ink-soft">Ghi chú: {r.staffNote}</p>}
                    {r.actionTaken && <p className="mt-1 text-sm text-ink-soft">Đã làm: {r.actionTaken}</p>}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
