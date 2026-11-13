import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDateTime, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getCountDetail } from "@/modules/inventory/admin";
import { costOfQty } from "@/modules/inventory/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, PageHeader } from "../../../_components/ui";
import { TapLink } from "../../_components/data-list";
import { PrintButton } from "../../_components/print-button";
import { cancelCountAction, postCountAction, saveCountAction } from "../../actions";
import { q, qPlain, viDate } from "../../_lib/fmt";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE } from "../../_lib/labels";

export const metadata: Metadata = { title: "Phiếu kiểm kê" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, staff, db] = await Promise.all([params, requireStaff(), getDb()]);
  if (!UUID.test(id)) notFound();
  const d = await getCountDetail(db, id);
  if (!d) notFound();
  const c = d.count;
  const showValue = can(staff.role, "finance.view");
  const canWrite = can(staff.role, "inventory.write");
  const editable = c.status === "draft" && canWrite;
  const approver = can(staff.role, "inventory.approve");

  // Chênh lệch hiển thị: số đếm − số dư hiện tại (R-KHO-19), khi đã ghi sổ thì theo số chụp
  const rows = d.lines.map((l) => {
    const base = c.status === "posted" ? l.line.systemQty : l.current;
    const diff = l.line.countedQty === null ? null : l.line.countedQty - base;
    const value = diff === null || diff === 0 ? 0 : Math.sign(diff) * costOfQty(Math.abs(diff), l.receivedQty, l.receivedCost);
    return { ...l, diff, value };
  });
  const diffCount = rows.filter((r) => r.diff !== null && r.diff !== 0).length;
  const diffValue = rows.reduce((s, r) => s + r.value, 0);

  const lineView = rows.map((l) => (
    <div key={l.line.id} className="grid gap-2 border-b border-line py-3 text-sm md:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_1fr_0.8fr_1.2fr] md:items-center">
      <div>
        <span className="block">
          {l.itemCode} · {l.itemName}
        </span>
        <TapLink href={`/admin/kho/lo/${l.line.stockLotId}`} className="font-mono text-xs">
          {l.lotCode}
        </TapLink>
      </div>
      <div className="text-ink-soft md:text-graphite">Vị trí {l.locationCode}</div>
      <div className="tabular-nums">
        <span className="text-ink-soft md:hidden">Sổ: </span>
        {q(l.line.systemQty, l)}
        {c.status === "draft" && l.current !== l.line.systemQty && <span className="block text-xs text-danger">Hiện {q(l.current, l)}</span>}
      </div>
      <div>
        {editable ? (
          <label className="block">
            <span className="sr-only">Số đếm {l.lotCode}</span>
            <input name={`c_${l.line.id}`} inputMode="decimal" defaultValue={l.line.countedQty !== null ? qPlain(l.line.countedQty, l) : ""} placeholder={l.displayUom} className="field tabular-nums" />
          </label>
        ) : (
          <span className="tabular-nums">
            <span className="text-ink-soft md:hidden">Đếm: </span>
            {l.line.countedQty !== null ? q(l.line.countedQty, l) : "Không đếm"}
          </span>
        )}
      </div>
      <div className={`tabular-nums ${l.diff ? "text-danger" : ""}`}>
        <span className="text-ink-soft md:hidden">Lệch: </span>
        {l.diff === null ? "–" : `${l.diff > 0 ? "+" : ""}${q(l.diff, l)}`}
      </div>
      <div className="tabular-nums">{showValue && l.diff ? formatVnd(l.value) : ""}</div>
      <div>
        {editable ? (
          <label className="block">
            <span className="sr-only">Lý do {l.lotCode}</span>
            <input name={`r_${l.line.id}`} defaultValue={l.line.reason ?? ""} placeholder="Lý do lệch" className="field" />
          </label>
        ) : (
          <span className="text-ink-soft">{l.line.reason}</span>
        )}
      </div>
    </div>
  ));

  return (
    <>
      <Link href="/admin/kho/kiem-ke" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite print:hidden">
        ← Kiểm kê
      </Link>
      <PageHeader
        title={`Kiểm kê ${c.code}`}
        description={`Kho ${d.warehouseCode} · ${d.warehouseName} · ngày đếm ${viDate(c.countedOn)}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={DOC_STATUS_TONE[c.status]}>{DOC_STATUS_LABEL[c.status]}</Badge>
            <PrintButton />
          </span>
        }
      />
      <Card className="mb-6 max-w-2xl">
        <p className="text-sm">
          {rows.length} dòng · {diffCount} dòng lệch
          {showValue && diffCount > 0 ? ` · giá trị lệch ${formatVnd(diffValue)}` : ""}
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          Người lập {(c.createdBy && d.people.get(c.createdBy)) || "–"} · {formatDateTime(c.createdAt)}
          {c.postedAt ? ` · ghi sổ ${(c.postedBy && d.people.get(c.postedBy)) || "–"} ${formatDateTime(c.postedAt)}` : ""}
        </p>
        {c.note && <p className="mt-2 text-sm">{c.note}</p>}
      </Card>

      <div className="hidden border-b border-line pb-2 text-xs text-ink-soft md:grid md:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_1fr_0.8fr_1.2fr]">
        <span>Hàng, lô</span>
        <span>Vị trí</span>
        <span>Số sổ</span>
        <span>Số đếm</span>
        <span>Chênh lệch</span>
        <span>{showValue ? "Giá trị" : ""}</span>
        <span>Lý do</span>
      </div>

      {editable ? (
        <div className="space-y-4">
          <ActionForm action={saveCountAction} submitLabel="Lưu số đếm" submitClassName="btn btn-outline" className="space-y-4" noValidate>
            <input type="hidden" name="id" value={c.id} />
            {lineView}
          </ActionForm>
          <p className="text-sm text-ink-soft">Lưu số đếm trước, rồi ghi sổ. Để trống ô số đếm = không kiểm dòng đó.{approver ? "" : " Có chênh lệch thì chủ cửa hàng ghi sổ."}</p>
        </div>
      ) : rows.length ? (
        <div>{lineView}</div>
      ) : (
        <p className="py-6 text-sm text-ink-soft">Kho không có lô nào còn số dư lúc tạo phiếu.</p>
      )}

      {editable && (
        <div className="mt-6 flex flex-wrap gap-4 print:hidden">
          <ActionForm action={postCountAction} submitLabel="Ghi sổ" pendingLabel="Đang ghi…" confirm="Ghi sổ kiểm kê theo số đếm đã lưu?" inline>
            <input type="hidden" name="id" value={c.id} />
            {rows.map((l) => (
              <span key={l.line.id} hidden>
                <input type="hidden" name={`c_${l.line.id}`} value={l.line.countedQty !== null ? qPlain(l.line.countedQty, l) : ""} />
                <input type="hidden" name={`r_${l.line.id}`} value={l.line.reason ?? ""} />
              </span>
            ))}
          </ActionForm>
          <ActionForm action={cancelCountAction} submitLabel="Hủy phiếu" submitClassName="btn btn-outline" confirm="Hủy phiếu kiểm kê?" inline>
            <input type="hidden" name="id" value={c.id} />
          </ActionForm>
        </div>
      )}
    </>
  );
}
