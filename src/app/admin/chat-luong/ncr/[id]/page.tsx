import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getNcrDetail } from "@/modules/qms/admin";
import { CAPA_STATUS_LABEL, isOverdue, NCR_CATEGORY_LABEL, NCR_STATUS_LABEL, ncrNextStatuses, SEVERITY_LABEL } from "@/modules/qms/rules";
import { vnToday } from "@/modules/numbering";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card } from "../../../_components/ui";
import { transitionNcrAction, updateNcrAction } from "../../actions";

export const metadata: Metadata = { title: "NCR" };

const SEV_TONE = { minor: "neutral", major: "amber", critical: "red" } as const;

export default async function NcrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, d] = await Promise.all([requireStaff(), getNcrDetail(id)]);
  if (!d) notFound();
  const n = d.ncr;
  const done = n.status === "closed" || n.status === "cancelled";
  const canWrite = can(staff.role, "quality.write") && !done;
  const canApprove = can(staff.role, "quality.approve");
  const next = ncrNextStatuses(n.status).filter((s) => (s === "closed" ? canApprove : canWrite));
  const late = isOverdue(n.dueOn, vnToday(), done);

  return (
    <>
      <Link href="/admin/chat-luong/ncr" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Sai lỗi (NCR)
      </Link>
      <div className="mb-6 mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl">{n.code}</h1>
        <Badge tone={n.status === "closed" ? "green" : n.status === "cancelled" ? "neutral" : "amber"}>{NCR_STATUS_LABEL[n.status]}</Badge>
        <Badge tone={SEV_TONE[n.severity]}>{SEVERITY_LABEL[n.severity]}</Badge>
        <span className="text-sm text-ink-soft">{NCR_CATEGORY_LABEL[n.category]}</span>
        {late && <Badge tone="red">Quá hạn</Badge>}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card title="Nội dung">
            <ActionForm action={updateNcrAction} submitLabel={canWrite ? "Lưu" : "Chỉ xem"} submitClassName={canWrite ? "btn btn-primary" : "hidden"}>
              <input type="hidden" name="id" value={n.id} />
              <fieldset disabled={!canWrite} className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="field-label">Tiêu đề</span>
                  <input name="title" defaultValue={n.title} className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Mức độ</span>
                  <select name="severity" defaultValue={n.severity} className="field">
                    {Object.entries(SEVERITY_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Hạn xử lý</span>
                  <input type="date" name="dueOn" defaultValue={n.dueOn ?? ""} className="field" />
                </label>
                <Area name="description" label="Mô tả sai lỗi" value={n.description} />
                <Area name="containment" label="Biện pháp tức thời" value={n.containment} />
                <Area name="rootCause" label="Nguyên nhân gốc" value={n.rootCause} />
                <Area name="correction" label="Biện pháp khắc phục" value={n.correction} />
                <Area name="verificationNote" label="Xác nhận kết quả" value={n.verificationNote} />
              </fieldset>
            </ActionForm>
          </Card>
        </div>

        <div className="space-y-6">
          {next.length > 0 && (
            <Card title="Chuyển trạng thái">
              <div className="space-y-3">
                {next.map((to) => (
                  <ActionForm
                    key={to}
                    action={transitionNcrAction}
                    submitLabel={to === "closed" ? "Đóng NCR" : to === "cancelled" ? "Hủy NCR" : `Chuyển sang ${NCR_STATUS_LABEL[to]}`}
                    submitClassName={to === "cancelled" ? "btn btn-outline" : "btn btn-primary"}
                    confirm={to === "closed" ? "Đóng NCR? Nguyên nhân và biện pháp sẽ chép sang phản ánh nếu ô đó còn trống." : undefined}
                  >
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="from" value={n.status} />
                    <input type="hidden" name="to" value={to} />
                    {to === "cancelled" && <input name="reason" placeholder="Lý do hủy (bắt buộc)" aria-label="Lý do hủy" className="field" />}
                  </ActionForm>
                ))}
              </div>
              {n.severity === "critical" && <p className="mt-3 text-xs text-ink-soft">NCR nghiêm trọng cần ít nhất một CAPA trước khi đóng.</p>}
            </Card>
          )}

          <Card title="Liên kết">
            <ul className="space-y-1 text-sm">
              {d.lot && (
                <li>
                  Lô{" "}
                  <Link href={`/admin/lo/${d.lot.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                    {d.lot.lotNo}
                  </Link>{" "}
                  ·{" "}
                  <Link href={`/admin/chat-luong/truy-xuat?ma=${encodeURIComponent(d.lot.lotNo)}`} className="underline underline-offset-4">
                    truy xuất
                  </Link>
                </li>
              )}
              {d.stockLot && (
                <li>
                  Lô kho{" "}
                  <Link href={`/admin/chat-luong/truy-xuat?ma=${encodeURIComponent(d.stockLot.code)}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                    {d.stockLot.code}
                  </Link>
                </li>
              )}
              {d.inspection && (
                <li>
                  Phiếu kiểm{" "}
                  <Link href={`/admin/chat-luong/phieu-kiem/${d.inspection.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                    {d.inspection.code}
                  </Link>
                </li>
              )}
              {d.order && (
                <li>
                  Lệnh{" "}
                  <Link href={`/admin/san-xuat/lenh/${d.order.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                    {d.order.code}
                  </Link>
                </li>
              )}
              {d.run && (
                <li>
                  Mẻ chiết{" "}
                  <Link href={`/admin/san-xuat/chiet-xuat/${d.run.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                    {d.run.code}
                  </Link>
                </li>
              )}
              {d.supplier && <li>Nhà cung cấp: {d.supplier.name}</li>}
              {d.complaint && (
                <li>
                  <Link href="/admin/phan-anh" className="inline-flex min-h-11 items-center underline underline-offset-4">
                    Phản ánh: {d.complaint.symptoms.slice(0, 80)}
                  </Link>
                </li>
              )}
              <li className="text-ink-soft">Tạo lúc {formatDateTime(n.createdAt)}</li>
              {n.closedAt && <li className="text-ink-soft">Đóng lúc {formatDateTime(n.closedAt)}</li>}
            </ul>
          </Card>

          <Card title={`CAPA liên kết · ${d.capas.length}`}>
            {d.capas.length > 0 && (
              <ul className="mb-3 space-y-1 text-sm">
                {d.capas.map((c) => (
                  <li key={c.id}>
                    <Link href={`/admin/chat-luong/capa/${c.id}`} className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4">
                      <span className="font-mono">{c.code}</span> {c.title} · {CAPA_STATUS_LABEL[c.status]}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <Link href={`/admin/chat-luong/capa/moi?ncr=${n.id}`} className="btn btn-outline min-h-11">
                Tạo CAPA
              </Link>
            )}
          </Card>

          {d.lot && can(staff.role, "quality.approve") && (
            <Card title="Thu hồi">
              <Link href={`/admin/chat-luong/thu-hoi/moi?ncr=${n.id}&lo=${d.lot.id}`} className="btn btn-outline min-h-11">
                Mở thu hồi lô {d.lot.lotNo}
              </Link>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Area({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="block sm:col-span-2">
      <span className="field-label">{label}</span>
      <textarea name={name} rows={2} defaultValue={value} className="field" />
    </label>
  );
}
