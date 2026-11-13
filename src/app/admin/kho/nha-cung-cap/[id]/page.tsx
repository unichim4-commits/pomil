import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDateTime, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getSupplierDetail } from "@/modules/inventory/admin";
import { Badge, Card, PageHeader } from "../../../_components/ui";
import { DataList, TapLink } from "../../_components/data-list";
import { viDate } from "../../_lib/fmt";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE, RECEIPT_KIND_LABEL, SUPPLIER_KIND_LABEL } from "../../_lib/labels";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Nhà cung cấp" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, staff, db] = await Promise.all([params, requireStaff(), getDb()]);
  if (!UUID.test(id)) notFound();
  const d = await getSupplierDetail(db, id);
  if (!d) notFound();
  const s = d.supplier;
  const showValue = can(staff.role, "finance.view");
  type R = (typeof d.receipts)[number];

  return (
    <>
      <Link href="/admin/kho/nha-cung-cap" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Nhà cung cấp
      </Link>
      <PageHeader
        title={`${s.code} · ${s.name}`}
        description={`${SUPPLIER_KIND_LABEL[s.kind]} · ${s.paymentTermsDays ? `hạn trả ${s.paymentTermsDays} ngày` : "trả ngay"}`}
        actions={
          <span className="flex flex-wrap gap-1">
            {s.qualified ? <Badge tone="green">Đã đánh giá</Badge> : <Badge tone="amber">Chưa đánh giá</Badge>}
            {!s.isActive && <Badge>Ngừng dùng</Badge>}
          </span>
        }
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="Liên hệ">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-soft">Người liên hệ</dt>
            <dd>{s.contactName || "–"}</dd>
            <dt className="text-ink-soft">Điện thoại</dt>
            <dd>{s.phone || "–"}</dd>
            <dt className="text-ink-soft">Email</dt>
            <dd>{s.email || "–"}</dd>
            <dt className="text-ink-soft">Địa chỉ</dt>
            <dd>{s.address || "–"}</dd>
            <dt className="text-ink-soft">Mã số thuế</dt>
            <dd>{s.taxCode || "–"}</dd>
          </dl>
          {s.note && <p className="mt-3 whitespace-pre-line text-sm">{s.note}</p>}
        </Card>
        <Card title="IQC không đạt">
          {d.failedIqc.length ? (
            <ul className="space-y-1 text-sm">
              {d.failedIqc.map((f) => (
                <li key={f.id}>
                  <TapLink href={`/admin/chat-luong/phieu-kiem/${f.id}`} className="font-mono">
                    {f.code}
                  </TapLink>{" "}
                  · lô {f.lotCode ?? "–"}
                  {f.decidedAt ? ` · ${formatDateTime(f.decidedAt)}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">Chưa có lô nào không đạt.</p>
          )}
        </Card>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="eyebrow text-[0.68rem]">Lịch sử nhập</h2>
        <TapLink href={`/admin/kho/nhap?ncc=${s.id}`} className="text-sm underline">
          Lọc phiếu nhập
        </TapLink>
      </div>
      <DataList
        rows={d.receipts}
        rowKey={(r) => r.id}
        empty="Chưa nhập hàng từ nhà cung cấp này."
        cols={[
          {
            label: "Phiếu",
            cell: (r) => (
              <TapLink href={`/admin/kho/nhap/${r.id}`} className="font-mono">
                {r.code}
              </TapLink>
            ),
          },
          { label: "Loại", cell: (r) => RECEIPT_KIND_LABEL[r.kind] },
          { label: "Ngày", cell: (r) => viDate(r.receivedOn) },
          ...(showValue ? [{ label: "Giá trị", cell: (r: R) => formatVnd(r.totalCost), className: "tabular-nums" }] : []),
          { label: "Trạng thái", cell: (r) => <Badge tone={DOC_STATUS_TONE[r.status]}>{DOC_STATUS_LABEL[r.status]}</Badge> },
        ]}
      />

      {can(staff.role, "inventory.write") && (
        <Card title="Sửa nhà cung cấp" className="mt-8 max-w-3xl">
          <SupplierForm supplier={s} />
        </Card>
      )}
    </>
  );
}
