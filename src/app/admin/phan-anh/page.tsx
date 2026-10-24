import type { Metadata } from "next";
import { displayPhone, formatDateTime } from "@/lib/format";
import { maskPhone, normalizeVnPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { COMPLAINT_STATUS_LABEL, listComplaints, SEVERITY_LABEL } from "@/modules/quality/admin";
import { complaintLotLabel, complaintResponseBadge } from "@/modules/quality/rules";
import { ActionForm } from "../_components/action-form";
import { Badge, Empty, FilterTabs, PageHeader } from "../_components/ui";
import { complaintAction } from "../lo/actions";

export const metadata: Metadata = { title: "Phản ánh" };

type Status = keyof typeof COMPLAINT_STATUS_LABEL;

export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && sp.status in COMPLAINT_STATUS_LABEL ? (sp.status as Status) : undefined;
  const [staff, rows] = await Promise.all([requireStaff(), listComplaints(status)]);
  const canWrite = can(staff.role, "complaints.write");
  const showPhone = can(staff.role, "customers.view_phone");

  return (
    <>
      <PageHeader title="Phản ánh kích ứng" description="Phản hồi khách trong 24 giờ. Ghi nguyên nhân và cách xử lý để lô sau tốt hơn." />
      <FilterTabs
        active={status ?? "all"}
        items={[
          { key: "all", label: "Tất cả", href: "/admin/phan-anh" },
          ...(Object.keys(COMPLAINT_STATUS_LABEL) as Status[]).map((s) => ({ key: s, label: COMPLAINT_STATUS_LABEL[s], href: `/admin/phan-anh?status=${s}` })),
        ]}
      />
      {rows.length === 0 ? (
        <Empty>Không có phản ánh nào.</Empty>
      ) : (
        <div className="space-y-4">
          {rows.map((c) => {
            const responseBadge = complaintResponseBadge(c);
            const phone = c.contactPhone ? normalizeVnPhone(c.contactPhone) : null;
            return (
              <article key={c.id} className="border border-line bg-paper p-5">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Badge tone={c.severity === "severe" ? "red" : c.severity === "moderate" ? "amber" : "neutral"}>{SEVERITY_LABEL[c.severity]}</Badge>
                  <Badge tone={c.status === "closed" ? "green" : "neutral"}>{COMPLAINT_STATUS_LABEL[c.status]}</Badge>
                  {responseBadge && <Badge tone={responseBadge.tone}>{responseBadge.label}</Badge>}
                  <span className="font-mono">{complaintLotLabel(c)}</span>
                  <span className="text-ink-soft">{formatDateTime(c.openedAt)}</span>
                  {phone && <span className="ml-auto">{showPhone ? displayPhone(phone) : maskPhone(phone)}</span>}
                </div>
                <p className="mt-3">{c.symptoms}</p>
                {canWrite ? (
                  <ActionForm action={complaintAction} submitLabel="Lưu" className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-[10rem_1fr_1fr_auto] md:items-end">
                    <input type="hidden" name="id" value={c.id} />
                    <label className="block">
                      <span className="field-label">Trạng thái</span>
                      <select name="status" defaultValue={c.status} className="field">
                        {Object.entries(COMPLAINT_STATUS_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Nguyên nhân</span>
                      <input name="rootCause" defaultValue={c.rootCause ?? ""} className="field" />
                    </label>
                    <label className="block">
                      <span className="field-label">Cách xử lý</span>
                      <input name="correctiveAction" defaultValue={c.correctiveAction ?? ""} className="field" />
                    </label>
                  </ActionForm>
                ) : (
                  (c.rootCause || c.correctiveAction) && (
                    <p className="mt-3 text-sm text-ink-soft">
                      {c.rootCause} {c.correctiveAction && `→ ${c.correctiveAction}`}
                    </p>
                  )
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
