import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getDb } from "@/db/client";
import { INSPECTION_STATUS_LABEL, inspectionCounts, listInspections, listSuppliersBrief, STAGE_DESCRIPTION, STAGE_LABEL, type InspectionStatusKey } from "@/modules/qms/admin";
import { pendingLotsWithoutInspection } from "@/modules/qms/decisions";
import { QMS_DISCLAIMER, type InspectionStageKey } from "@/modules/qms/rules";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, Empty, FilterTabs, PageHeader, Table } from "../../_components/ui";
import { openIqcAction } from "../actions";

export const metadata: Metadata = { title: "Phiếu kiểm" };

const STATUS_TONE = { pending: "amber", passed: "green", failed: "red", cancelled: "neutral" } as const;

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ stage?: string; status?: string; ncc?: string }> }) {
  const sp = await searchParams;
  const stage = sp.stage && sp.stage in STAGE_LABEL ? (sp.stage as InspectionStageKey) : undefined;
  const status = sp.status && sp.status in INSPECTION_STATUS_LABEL ? (sp.status as InspectionStatusKey) : undefined;
  const supplierId = sp.ncc && /^[0-9a-f-]{36}$/i.test(sp.ncc) ? sp.ncc : undefined;
  const db = await getDb();
  const [staff, rows, counts, suppliers, orphan] = await Promise.all([requireStaff(), listInspections({ stage, status, supplierId }, db), inspectionCounts(db), listSuppliersBrief(db), pendingLotsWithoutInspection(db)]);
  const canWrite = can(staff.role, "quality.write");
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { stage, status, ncc: supplierId, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/chat-luong/phieu-kiem${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Phiếu kiểm" description="IQC khi nhập hàng, IPQC trong sản xuất, FQC trước khi lô thành phẩm được bán, kiểm lại mẫu lưu khi có phản ánh." />
      <p className="mb-6 border border-line bg-pith/40 p-3 text-xs text-ink-soft">{QMS_DISCLAIMER}</p>
      <FilterTabs
        active={stage ?? "all"}
        items={[
          { key: "all", label: "Tất cả", href: qs({ stage: undefined }) },
          ...(Object.keys(STAGE_LABEL) as InspectionStageKey[]).map((s) => ({ key: s, label: `${STAGE_LABEL[s]} · ${STAGE_DESCRIPTION[s]}`, count: counts[s], href: qs({ stage: s }) })),
        ]}
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        {stage && <input type="hidden" name="stage" value={stage} />}
        <label className="block">
          <span className="field-label">Trạng thái</span>
          <select name="status" defaultValue={status ?? ""} className="field min-h-11">
            <option value="">Tất cả</option>
            {Object.entries(INSPECTION_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Nhà cung cấp</span>
          <select name="ncc" defaultValue={supplierId ?? ""} className="field min-h-11">
            <option value="">Tất cả</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-outline min-h-11">
          Lọc
        </button>
      </form>

      {rows.length === 0 ? (
        <Empty>Không có phiếu nào.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Phiếu</th>
              <th>Đối tượng kiểm</th>
              <th>Nhà cung cấp</th>
              <th>Tạo lúc</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/chat-luong/phieu-kiem/${r.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                    {r.code}
                  </Link>
                  <span className="block text-xs text-ink-soft">{STAGE_LABEL[r.stage]}</span>
                </td>
                <td>
                  {r.lotNo && <span className="font-mono">{r.lotNo}</span>}
                  {r.stockLotCode && (
                    <span>
                      <span className="font-mono">{r.stockLotCode}</span> · {r.itemName}
                    </span>
                  )}
                  {r.orderCode && (
                    <span className="block text-xs text-ink-soft">
                      {r.orderCode}
                      {r.stepName && ` · ${r.stepName}`}
                    </span>
                  )}
                  {r.runCode && <span className="block text-xs text-ink-soft">Mẻ chiết {r.runCode}</span>}
                </td>
                <td className="text-ink-soft">{r.supplierName ?? "—"}</td>
                <td className="text-ink-soft">{formatDateTime(r.createdAt)}</td>
                <td>
                  <Badge tone={STATUS_TONE[r.status]}>{INSPECTION_STATUS_LABEL[r.status]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {canWrite && orphan.length > 0 && (!stage || stage === "iqc") && (
        <Card title="Lô vật tư chờ kiểm chưa có phiếu" className="mt-8">
          <ul className="space-y-2 text-sm">
            {orphan.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2 first:border-0 first:pt-0">
                <span>
                  <span className="font-mono">{l.code}</span> · {l.itemCode} {l.itemName}
                </span>
                <ActionForm action={openIqcAction} submitLabel="Mở phiếu IQC" submitClassName="btn btn-outline min-h-11" inline>
                  <input type="hidden" name="stockLotId" value={l.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
