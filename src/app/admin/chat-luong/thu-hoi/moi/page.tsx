import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/modules/auth/service";
import { listOpenNcrsBrief, recallableLots } from "@/modules/qms/admin";
import { QMS_DISCLAIMER, SEVERITY_LABEL } from "@/modules/qms/rules";
import { LOT_STATUS_LABEL } from "@/modules/quality/admin";
import { ActionForm } from "../../../_components/action-form";
import { Card, Empty, PageHeader } from "../../../_components/ui";
import { openRecallAction } from "../../actions";

export const metadata: Metadata = { title: "Mở thu hồi" };

export default async function NewRecallPage({ searchParams }: { searchParams: Promise<{ ncr?: string; lo?: string }> }) {
  const sp = await searchParams;
  await requirePermission("quality.approve");
  const [lots, ncrs] = await Promise.all([recallableLots(), listOpenNcrsBrief()]);
  return (
    <>
      <Link href="/admin/chat-luong/thu-hoi" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Thu hồi
      </Link>
      <PageHeader title="Mở thu hồi" description="Lô chọn sẽ chuyển trạng thái Thu hồi, tồn kho của lô sang kho cách ly REJ, sản phẩm không bán được từ lô đó. Hệ thống lập danh sách đơn cần liên hệ." />
      <p className="mb-6 border border-line bg-pith/40 p-3 text-xs text-ink-soft">{QMS_DISCLAIMER}</p>
      {lots.length === 0 ? (
        <Empty>Không có lô đang bán hoặc đang giữ để thu hồi.</Empty>
      ) : (
        <Card>
          <ActionForm action={openRecallAction} submitLabel="Mở thu hồi" submitClassName="btn border-danger bg-danger text-bone" confirm="Mở thu hồi các lô đã chọn? Lô bị khóa bán ngay." noValidate>
            <fieldset className="space-y-1">
              <legend className="field-label">Lô thu hồi</legend>
              {lots.map((l) => (
                <label key={l.id} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="lotIds" value={l.id} defaultChecked={l.id === sp.lo} className="accent-graphite" />
                  <span className="font-mono">{l.lotNo}</span> · {l.productName} · {LOT_STATUS_LABEL[l.status]}
                </label>
              ))}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="field-label">Lý do</span>
                <textarea name="reason" rows={2} className="field" />
              </label>
              <label className="block">
                <span className="field-label">Mức độ</span>
                <select name="severity" defaultValue="major" className="field">
                  {Object.entries(SEVERITY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">NCR liên quan</span>
                <select name="ncrId" defaultValue={ncrs.some((n) => n.id === sp.ncr) ? sp.ncr : ""} className="field">
                  <option value="">Không gắn NCR</option>
                  {ncrs.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.code} · {n.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="field-label">Ghi chú</span>
                <input name="note" className="field" />
              </label>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
