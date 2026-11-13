import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { ORDER_STATUS_LABEL } from "@/modules/orders/rules";
import { getRecallDetail, RECALL_STATUS_LABEL } from "@/modules/qms/admin";
import { recallStats } from "@/modules/qms/recall";
import { QMS_DISCLAIMER, RECALL_CONTACT_LABEL, SEVERITY_LABEL, type RecallContactStatus } from "@/modules/qms/rules";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, Empty, PageHeader, Stat, Table } from "../../../_components/ui";
import { closeRecallAction, recallContactAction, recallReceiveAction } from "../../actions";

export const metadata: Metadata = { title: "Hồ sơ thu hồi" };

const CONTACT_TONE: Record<RecallContactStatus, "neutral" | "green" | "amber" | "red" | "dark"> = {
  pending: "amber",
  contacted: "neutral",
  returned: "green",
  unreachable: "red",
  refused: "dark",
};

export default async function RecallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  const showPhone = can(staff.role, "customers.view_phone");
  const db = await getDb();
  const detail = await getRecallDetail(id, showPhone, db);
  if (!detail) notFound();
  const stats = await recallStats(db, id);
  const { recall, contacts, ncr } = detail;
  const open = recall.status !== "closed";
  const canWrite = open && can(staff.role, "quality.write");
  const canClose = open && can(staff.role, "quality.approve");
  const pending = contacts.filter((c) => c.status === "pending").length;

  return (
    <>
      <Link href="/admin/chat-luong/thu-hoi" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Thu hồi
      </Link>
      <PageHeader
        title={`Thu hồi ${recall.code}`}
        description={recall.reason}
        actions={
          <a href={`/admin/chat-luong/thu-hoi/${id}/csv`} className="btn btn-outline min-h-11">
            Tải CSV liên hệ
          </a>
        }
      />
      <p className="mb-6 border border-line bg-pith/40 p-3 text-xs text-ink-soft">
        {QMS_DISCLAIMER} Phần mềm không tự gửi tin cho khách: nhân viên tự liên hệ rồi ghi kết quả ở đây.
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={open ? "amber" : "green"}>{RECALL_STATUS_LABEL[recall.status]}</Badge>
        <Badge tone="red">{SEVERITY_LABEL[recall.severity]}</Badge>
        <span className="text-ink-soft">Mở lúc {formatDateTime(recall.openedAt)}</span>
        {recall.closedAt && <span className="text-ink-soft">· Đóng lúc {formatDateTime(recall.closedAt)}</span>}
        {ncr && (
          <Link href={`/admin/chat-luong/ncr/${ncr.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
            {ncr.code}
          </Link>
        )}
      </div>

      <div className="space-y-6">
        {stats.map((s) => (
          <Card
            key={s.lotId}
            title={`Lô ${s.lotNo} · ${s.productName}`}
            actions={
              <Link href={`/admin/chat-luong/truy-xuat?ma=${encodeURIComponent(s.lotNo)}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
                Truy xuất
              </Link>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Đã bán (ròng)" value={`${s.sold} chai`} />
              <Stat label="Còn trong kho" value={`${s.onHand} chai`} hint="Đã chuyển cách ly REJ" />
              <Stat label="Đã thu về" value={`${s.recovered} chai`} />
              <Stat label="Tỷ lệ thu hồi" value={s.rate === null ? "—" : `${String(s.rate).replace(".", ",")}%`} />
            </div>
          </Card>
        ))}

        <Card title={`Danh sách liên hệ (${contacts.length}, còn ${pending} chưa xử lý)`}>
          {contacts.length === 0 ? (
            <Empty>Không có đơn nào đã bán từ các lô này.</Empty>
          ) : (
            <div className="space-y-4">
              {contacts.map((c) => (
                <div key={c.id} className="border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Link href={`/admin/don-hang/${c.orderId}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                      {c.orderCode}
                    </Link>
                    <span>{c.name}</span>
                    <span className="font-mono text-ink-soft">{c.phone}</span>
                    {c.dealer && <span className="text-ink-soft">· Đại lý {c.dealer}</span>}
                    <Badge tone={CONTACT_TONE[c.status]}>{RECALL_CONTACT_LABEL[c.status]}</Badge>
                    <span className="text-xs text-ink-soft">{ORDER_STATUS_LABEL[c.orderStatus as keyof typeof ORDER_STATUS_LABEL] ?? c.orderStatus}</span>
                  </div>
                  <ul className="mt-1 text-xs text-ink-soft">
                    {c.items.map((i) => (
                      <li key={i.id}>
                        {i.productName} · lô {i.lotNo} · {i.qty} chai
                      </li>
                    ))}
                  </ul>
                  {c.note && <p className="mt-1 text-xs">Ghi chú: {c.note}</p>}
                  {c.contactedAt && <p className="text-xs text-ink-soft">Cập nhật {formatDateTime(c.contactedAt)}</p>}
                  {canWrite && (
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <ActionForm action={recallContactAction} submitLabel="Ghi kết quả liên hệ" submitClassName="btn btn-outline min-h-11">
                        <input type="hidden" name="contactId" value={c.id} />
                        <input type="hidden" name="recallId" value={id} />
                        <label className="block">
                          <span className="field-label">Kết quả</span>
                          <select name="status" defaultValue={c.status === "pending" ? "contacted" : c.status} className="field">
                            {(Object.keys(RECALL_CONTACT_LABEL) as RecallContactStatus[])
                              .filter((k) => k !== "pending")
                              .map((k) => (
                                <option key={k} value={k}>
                                  {RECALL_CONTACT_LABEL[k]}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="field-label">Ghi chú</span>
                          <input name="note" defaultValue={c.note ?? ""} className="field" />
                        </label>
                      </ActionForm>
                      {c.items.length > 0 && (
                        <ActionForm action={recallReceiveAction} submitLabel="Nhận hàng về kho cách ly" submitClassName="btn btn-outline min-h-11" confirm="Nhập số chai khách gửi về vào kho cách ly REJ?">
                          <input type="hidden" name="contactId" value={c.id} />
                          <input type="hidden" name="recallId" value={id} />
                          {c.items.map((i) => (
                            <label key={i.id} className="block">
                              <input type="hidden" name="orderItemId" value={i.id} />
                              <span className="field-label">
                                Số chai về · lô {i.lotNo} (đã bán {i.qty})
                              </span>
                              <input name={`qty_${i.id}`} type="number" inputMode="numeric" min={0} max={i.qty} defaultValue={0} className="field" />
                            </label>
                          ))}
                        </ActionForm>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {canClose && (
          <Card title="Đóng hồ sơ">
            <p className="mb-3 text-sm text-ink-soft">Chỉ đóng được khi mọi liên hệ đã có kết quả. Lô vẫn giữ trạng thái Thu hồi.</p>
            <ActionForm action={closeRecallAction} submitLabel="Đóng hồ sơ thu hồi" confirm="Đóng hồ sơ thu hồi này?">
              <input type="hidden" name="id" value={id} />
              <label className="block">
                <span className="field-label">Ghi chú đóng</span>
                <input name="note" className="field" />
              </label>
            </ActionForm>
          </Card>
        )}
        {recall.note && (
          <Card title="Ghi chú">
            <p className="text-sm">{recall.note}</p>
          </Card>
        )}
      </div>
    </>
  );
}
