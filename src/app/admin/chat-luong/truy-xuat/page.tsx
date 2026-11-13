import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { stockLotBrief } from "@/modules/qms/admin";
import { QMS_DISCLAIMER } from "@/modules/qms/rules";
import { lotBalance, resolveTraceCode, traceBackward, traceForward, type TraceNode } from "@/modules/qms/trace";
import { ORDER_STATUS_LABEL } from "@/modules/orders/rules";
import { ActionForm } from "../../_components/action-form";
import { Card, Empty, PageHeader, Table } from "../../_components/ui";
import { stockLotHoldAction } from "../actions";

export const metadata: Metadata = { title: "Truy xuất lô" };

const WAREHOUSE_KIND: Record<string, string> = { raw: "Nguyên liệu", extract: "Tinh dầu", packaging: "Bao bì", wip: "Bán thành phẩm", finished: "Thành phẩm", rejected: "Cách ly REJ" };

export default async function TracePage({ searchParams }: { searchParams: Promise<{ ma?: string }> }) {
  const sp = await searchParams;
  const code = (sp.ma ?? "").trim().slice(0, 60);
  const staff = await requireStaff();
  const showPhone = can(staff.role, "customers.view_phone");
  const db = await getDb();
  const ref = code ? await resolveTraceCode(db, code) : null;
  const [back, fwd, balance, stockLot] = ref
    ? await Promise.all([
        ref.kind === "lot" ? traceBackward(db, ref.id) : Promise.resolve(null),
        traceForward(db, ref, showPhone),
        ref.kind === "lot" ? lotBalance(db, ref.id) : Promise.resolve(null),
        ref.kind === "stock_lot" ? stockLotBrief(ref.id, db) : Promise.resolve(null),
      ])
    : [null, null, null, null];
  const csvHref = `/admin/chat-luong/truy-xuat/csv?ma=${encodeURIComponent(code)}`;

  return (
    <>
      <PageHeader title="Truy xuất lô" description="Nhập số lô thành phẩm (PST-…), mã lô vật tư (VT-…) hoặc lô tinh dầu (EX-…). Ngược: lô dùng nguyên liệu nào. Xuôi: lô đi tới lệnh, đơn, khách nào." />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block min-w-0 flex-1">
          <span className="field-label">Số lô hoặc mã lô kho</span>
          <input name="ma" defaultValue={code} className="field min-h-11 font-mono uppercase" placeholder="PST-271101-01" autoComplete="off" />
        </label>
        <button type="submit" className="btn btn-primary min-h-11">
          Truy xuất
        </button>
      </form>
      <p className="mb-6 border border-line bg-pith/40 p-3 text-xs text-ink-soft">{QMS_DISCLAIMER}</p>

      {code && !ref && <Empty>Không tìm thấy lô {code}.</Empty>}

      {ref && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <a href={csvHref} className="btn btn-outline min-h-11">
              Tải CSV
            </a>
            {ref.kind === "lot" && (
              <Link href={`/admin/lo/${ref.id}`} className="btn btn-outline min-h-11">
                Mở trang lô
              </Link>
            )}
          </div>

          {balance && (
            <Card title={`Cân đối lô${balance.balanced ? "" : " · chưa khớp, kiểm tra sổ kho"}`}>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Num label="Nhập" value={balance.received} />
                <Num label="Đã bán" value={balance.sold} />
                <Num label="Mẫu, kiểm nghiệm" value={balance.samples} />
                <Num label="Hủy" value={balance.scrap} />
                <Num label="Khách trả, thu hồi" value={balance.returned} />
                <Num label="Xuất khác" value={balance.other} />
                <Num label="Còn trong kho" value={balance.onHand} />
              </dl>
              {Object.keys(balance.onHandByWarehouse).length > 0 && (
                <p className="mt-3 text-sm text-ink-soft">
                  Theo kho:{" "}
                  {Object.entries(balance.onHandByWarehouse)
                    .map(([k, v]) => `${WAREHOUSE_KIND[k] ?? k} ${v.toLocaleString("vi-VN")}`)
                    .join(" · ")}
                </p>
              )}
            </Card>
          )}

          {stockLot && (stockLot.qcStatus === "released" || stockLot.qcStatus === "on_hold") && (
            <Card title={stockLot.qcStatus === "released" ? "Khóa lô vật tư" : "Mở khóa lô vật tư"}>
              {stockLot.holdReason &&
                (stockLot.qcStatus === "released" ? (
                  <p className="mb-3 text-sm">Ghi chú khi duyệt: {stockLot.holdReason}</p>
                ) : (
                  <p className="mb-3 text-sm text-danger">Lý do khóa: {stockLot.holdReason}</p>
                ))}
              {stockLot.qcStatus === "released" && can(staff.role, "quality.write") && (
                <ActionForm action={stockLotHoldAction} submitLabel="Khóa lô" submitClassName="btn border-danger bg-danger text-bone" confirm={`Khóa lô ${stockLot.code}? Lệnh sản xuất không chọn được lô này.`}>
                  <input type="hidden" name="stockLotId" value={stockLot.id} />
                  <input type="hidden" name="hold" value="1" />
                  <input name="reason" placeholder="Lý do (bắt buộc)" aria-label="Lý do khóa" className="field" />
                </ActionForm>
              )}
              {stockLot.qcStatus === "on_hold" && can(staff.role, "quality.approve") && (
                <ActionForm action={stockLotHoldAction} submitLabel="Mở khóa lô" confirm={`Mở khóa lô ${stockLot.code}?`}>
                  <input type="hidden" name="stockLotId" value={stockLot.id} />
                  <input type="hidden" name="hold" value="0" />
                </ActionForm>
              )}
            </Card>
          )}

          {back && (
            <Card title="Truy xuất ngược: lô dùng gì">
              <Tree node={back} />
            </Card>
          )}

          {fwd?.tree && (
            <Card title="Truy xuất xuôi: lô đi đâu">
              <Tree node={fwd.tree} />
            </Card>
          )}

          {fwd && (
            <Card title={`Đơn có lô này · ${fwd.orders.length}`}>
              {fwd.orders.length === 0 ? (
                <p className="text-sm text-ink-soft">Chưa có đơn nào (đơn đã hủy không tính).</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>Lô</th>
                      <th>Đơn</th>
                      <th>Khách</th>
                      <th>Điện thoại</th>
                      <th>Đại lý</th>
                      <th className="text-right">Số chai</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fwd.orders.map((o) => (
                      <tr key={`${o.orderId}-${o.lotNo}`}>
                        <td className="font-mono text-xs">{o.lotNo}</td>
                        <td>
                          <Link href={`/admin/don-hang/${o.orderId}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-4">
                            {o.orderCode}
                          </Link>
                          <span className="block text-xs text-ink-soft">{ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL] ?? o.status}</span>
                        </td>
                        <td>{o.customerName}</td>
                        <td className="tabular-nums">{o.phone}</td>
                        <td className="text-ink-soft">{o.dealer || "—"}</td>
                        <td className="text-right tabular-nums">{o.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function Num({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="text-xl font-light tabular-nums">{value.toLocaleString("vi-VN")}</dd>
    </div>
  );
}

function Tree({ node }: { node: TraceNode }) {
  return (
    <ul className="space-y-2 text-sm">
      <TreeItem node={node} />
    </ul>
  );
}

function TreeItem({ node }: { node: TraceNode }) {
  return (
    <li>
      <div className="border-l-2 border-graphite/30 pl-3">
        <p>
          {node.href ? (
            <Link href={node.href} className="font-mono underline underline-offset-4">
              {node.code}
            </Link>
          ) : (
            <span className="font-mono">{node.code}</span>
          )}{" "}
          · {node.title}
          {node.qty && <span className="ml-2 tabular-nums">{node.qty}</span>}
        </p>
        {node.meta.length > 0 && <p className="text-xs text-ink-soft">{node.meta.join(" · ")}</p>}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-4 mt-2 space-y-2">
          {node.children.map((c) => (
            <TreeItem key={`${c.kind}-${c.id}`} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}
