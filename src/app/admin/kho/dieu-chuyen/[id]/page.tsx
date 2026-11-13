import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getTransferDetail } from "@/modules/inventory/admin";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader } from "../../../_components/ui";
import { DataList, TapLink } from "../../_components/data-list";
import { PrintButton } from "../../_components/print-button";
import { cancelTransferAction, postTransferAction } from "../../actions";
import { q } from "../../_lib/fmt";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE } from "../../_lib/labels";

export const metadata: Metadata = { title: "Phiếu điều chuyển" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, staff, db] = await Promise.all([params, requireStaff(), getDb()]);
  if (!UUID.test(id)) notFound();
  const d = await getTransferDetail(db, id);
  if (!d) notFound();
  const t = d.transfer;
  const canWrite = can(staff.role, "inventory.write");

  return (
    <>
      <Link href="/admin/kho/dieu-chuyen" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite print:hidden">
        ← Điều chuyển
      </Link>
      <PageHeader
        title={`Điều chuyển ${t.code}`}
        description={`${d.from?.code ?? "?"} · ${d.from?.name ?? ""} → ${d.to?.code ?? "?"} · ${d.to?.name ?? ""}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={DOC_STATUS_TONE[t.status]}>{DOC_STATUS_LABEL[t.status]}</Badge>
            <PrintButton />
          </span>
        }
      />
      <Card title="Thông tin" className="mb-6 max-w-2xl">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-soft">Lý do</dt>
          <dd>{t.reason || "–"}</dd>
          <dt className="text-ink-soft">Người lập</dt>
          <dd>
            {(t.createdBy && d.people.get(t.createdBy)) || "–"} · {formatDateTime(t.createdAt)}
          </dd>
          {t.postedAt && (
            <>
              <dt className="text-ink-soft">Ghi sổ</dt>
              <dd>
                {(t.postedBy && d.people.get(t.postedBy)) || "–"} · {formatDateTime(t.postedAt)}
              </dd>
            </>
          )}
        </dl>
      </Card>
      <DataList
        rows={d.lines}
        rowKey={(l) => l.line.id}
        empty="Phiếu chưa có dòng."
        cols={[
          { label: "Hàng", cell: (l) => `${l.itemCode} · ${l.itemName}` },
          {
            label: "Lô",
            cell: (l) => (
              <TapLink href={`/admin/kho/lo/${l.line.stockLotId}`} className="font-mono">
                {l.lotCode}
              </TapLink>
            ),
          },
          { label: "Vị trí", cell: (l) => `${d.from?.code}/${l.fromLoc ?? "mặc định"} → ${d.to?.code}/${l.toLoc ?? "mặc định"}` },
          { label: "Số lượng", cell: (l) => q(l.line.qty, l), className: "tabular-nums" },
        ]}
      />
      {t.status === "draft" && canWrite && (
        <div className="mt-6 flex flex-wrap gap-4 print:hidden">
          <ActionForm action={postTransferAction} submitLabel="Ghi sổ" pendingLabel="Đang ghi…" confirm="Ghi sổ điều chuyển?" inline>
            <input type="hidden" name="id" value={t.id} />
          </ActionForm>
          <ActionForm action={cancelTransferAction} submitLabel="Hủy nháp" submitClassName="btn btn-outline" confirm="Hủy phiếu nháp này?" inline>
            <input type="hidden" name="id" value={t.id} />
          </ActionForm>
        </div>
      )}
    </>
  );
}
