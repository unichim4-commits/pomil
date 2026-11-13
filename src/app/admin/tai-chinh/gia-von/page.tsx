import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { formatDate, formatVnd } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { listAllocations, listProductionCosts, overheadSuggestion, previewAllocation, priceHistory } from "@/modules/finance/cost";
import { formatBpPct, isIsoDate, normalizePeriodStart, periodLabel } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, Empty, PageHeader, Table } from "../../_components/ui";
import { allocateOverheadAction, costLockAction, deleteAllocationAction } from "../actions";
import { CsvLink, LegalNotice, Money, requireFinanceView } from "../_shared";

export const metadata: Metadata = { title: "Giá vốn" };

type SP = Record<string, string | string[] | undefined>;

function Pct({ bp }: { bp: number | null }) {
  if (bp === null) return <span className="text-ink-soft">—</span>;
  return <span className={`tabular-nums ${bp > 0 ? "text-danger" : ""}`}>{formatBpPct(bp)}</span>;
}

export default async function CostPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireFinanceView();
  const sp = await searchParams;
  const rawMonth = Array.isArray(sp.thang) ? sp.thang[0] : sp.thang;
  const today = vnToday();
  const month = normalizePeriodStart("month", rawMonth && isIsoDate(`${rawMonth.slice(0, 7)}-01`) ? `${rawMonth.slice(0, 7)}-01` : today);
  const db = await getDb();
  const canApprove = can(me.role, "finance.approve");
  const [costs, prices, allocations, suggestion, preview] = await Promise.all([
    listProductionCosts(db, today),
    priceHistory(db),
    listAllocations(db),
    overheadSuggestion(db, month),
    previewAllocation(db, month, 0, "units"),
  ]);

  return (
    <>
      <PageHeader
        title="Giá vốn"
        description="Giá thành từng lệnh, so lô trước, so kế hoạch, biến động giá nguyên liệu và phân bổ chi phí sản xuất chung."
        actions={<CsvLink href="/admin/tai-chinh/gia-von/csv" />}
      />
      <LegalNotice />

      <Card title="Giá thành theo lệnh" className="mb-6">
        {costs.length === 0 ? (
          <Empty>Chưa có lệnh sản xuất nào hoàn thành.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Lệnh</th>
                <th>Sản phẩm / lô</th>
                <th className="text-right">NVL</th>
                <th className="text-right">Bao bì</th>
                <th className="text-right">Gia công</th>
                <th className="text-right">Nhân công, chung, khác</th>
                <th className="text-right">Tổng</th>
                <th className="text-right">Chai đạt</th>
                <th className="text-right">Giá/chai</th>
                <th>So kế hoạch</th>
                <th>So lô trước</th>
                <th>Chốt</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/san-xuat/lenh/${c.id}`} className="inline-flex min-h-11 items-center font-mono underline-offset-4 hover:underline">
                      {c.code}
                    </Link>
                  </td>
                  <td>
                    {c.productName}
                    <span className="block text-xs text-ink-soft">
                      {c.lotNo ?? "chưa có lô"} · {c.finishedOn ? formatDate(c.finishedOn) : "chưa xong"}
                    </span>
                  </td>
                  <td className="text-right"><Money value={c.material} /></td>
                  <td className="text-right"><Money value={c.packaging} /></td>
                  <td className="text-right"><Money value={c.outsourcing} /></td>
                  <td className="text-right"><Money value={c.labor + c.overheadManual + c.overheadAllocated + c.other} /></td>
                  <td className="text-right"><Money value={c.total} /></td>
                  <td className="text-right tabular-nums">{c.goodUnits ?? "—"}</td>
                  <td className="text-right">{c.unitCost === null ? "—" : <Money value={c.unitCost} />}</td>
                  <td className="text-xs">
                    {c.plannedUnitCost === null ? (
                      "—"
                    ) : (
                      <>
                        KH {formatVnd(c.plannedUnitCost)}
                        {c.diffPerUnit !== null && (
                          <span className={`block ${c.diffPerUnit > 0 ? "text-danger" : ""}`}>
                            {c.diffPerUnit > 0 ? "+" : ""}
                            {formatVnd(c.diffPerUnit)} (<Pct bp={c.diffBp} />)
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="text-xs"><Pct bp={c.vsPreviousBp} /></td>
                  <td>
                    {c.locked ? <Badge tone="dark">Đã chốt</Badge> : c.suggestLock ? <Badge tone="amber">Nên chốt</Badge> : <Badge>Chưa chốt</Badge>}
                    {canApprove && (c.status === "completed" || c.locked) && (
                      <ActionForm
                        action={costLockAction}
                        submitLabel={c.locked ? "Mở chốt" : "Chốt"}
                        className="mt-2 flex flex-wrap items-center gap-2"
                        confirm={c.locked ? undefined : `Chốt giá vốn ${c.code}? Sau khi chốt không xuất thêm, không phân bổ vào lệnh này.`}
                        submitClassName="btn btn-outline min-h-11 text-xs"
                      >
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="lock" value={c.locked ? "0" : "1"} />
                        {c.locked && <input name="reason" required placeholder="Lý do mở chốt" className="field min-h-11 w-36 text-sm" />}
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title={`Phân bổ chi phí chung · ${periodLabel("month", month)}`}>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
            <label>
              <span className="field-label">Tháng</span>
              <input type="month" name="thang" defaultValue={month.slice(0, 7)} className="field min-h-11" />
            </label>
            <button className="btn btn-outline min-h-11">Xem</button>
          </form>
          <dl className="mb-4 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            <dt className="text-ink-soft">Chi sản xuất chung trong tháng</dt>
            <dd><Money value={suggestion.capitalized} /></dd>
            <dt className="text-ink-soft">Đã phân bổ</dt>
            <dd><Money value={suggestion.allocated} /></dd>
            <dt className="text-ink-soft">Gợi ý còn lại</dt>
            <dd><Money value={suggestion.suggested} /></dd>
          </dl>
          {preview.length === 0 ? (
            <p className="text-sm text-ink-soft">Tháng này không có lệnh hoàn thành chưa chốt để phân bổ.</p>
          ) : (
            <p className="mb-4 text-sm text-ink-soft">
              Lệnh nhận phân bổ: {preview.map((p) => `${p.code} (${p.weight} chai)`).join(", ")}
            </p>
          )}
          {canApprove && preview.length > 0 && (
            <ActionForm action={allocateOverheadAction} submitLabel="Phân bổ" submitClassName="btn btn-primary min-h-11" confirm="Phân bổ và tính lại giá thành các lệnh trên?">
              <input type="hidden" name="month" value={month} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="field-label">Số tiền phân bổ</span>
                  <input name="total" required inputMode="numeric" defaultValue={suggestion.suggested > 0 ? String(suggestion.suggested) : ""} className="field min-h-11 w-full" />
                </label>
                <label className="block text-sm">
                  <span className="field-label">Theo</span>
                  <select name="basis" defaultValue="units" className="field min-h-11 w-full">
                    <option value="units">Số chai đạt</option>
                    <option value="bulk">Khối lượng bán thành phẩm (lệnh tự làm)</option>
                  </select>
                </label>
              </div>
              <input name="note" placeholder="Ghi chú" className="field min-h-11 w-full" />
            </ActionForm>
          )}
        </Card>

        <Card title="Các lần phân bổ">
          {allocations.length === 0 ? (
            <p className="text-sm text-ink-soft">Chưa phân bổ lần nào.</p>
          ) : (
            <ul className="space-y-4 text-sm">
              {allocations.map((a) => (
                <li key={a.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-mono">{a.code}</span> · {periodLabel("month", a.periodMonth)} · {a.basis === "units" ? "theo chai" : "theo khối lượng"}
                    </span>
                    <Money value={a.totalAmount} />
                  </div>
                  <p className="text-ink-soft">{a.lines.map((l) => `${l.code} ${formatVnd(l.amount)}${l.locked ? " (đã chốt)" : ""}`).join(" · ")}</p>
                  {canApprove && !a.lines.some((l) => l.locked) && (
                    <ActionForm action={deleteAllocationAction} submitLabel="Xóa phân bổ" inline confirm={`Xóa ${a.code}? Giá thành các lệnh sẽ tính lại.`} submitClassName="btn btn-outline mt-2 min-h-11 text-xs">
                      <input type="hidden" name="id" value={a.id} />
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Biến động giá nguyên liệu, bao bì">
        {prices.length === 0 ? (
          <Empty>Chưa có phiếu nhập nào có giá.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Mặt hàng</th>
                <th>Ngày nhập</th>
                <th>Phiếu</th>
                <th>Nhà cung cấp</th>
                <th className="text-right">Đơn giá</th>
                <th>So lần trước</th>
                <th>So giá tham chiếu</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p, i) => (
                <tr key={`${p.itemId}-${p.receiptCode}-${i}`}>
                  <td>
                    {p.itemName} <span className="text-xs text-ink-soft">{p.itemCode}</span>
                  </td>
                  <td className="whitespace-nowrap">{formatDate(p.receivedOn)}</td>
                  <td className="font-mono text-xs">{p.receiptCode}</td>
                  <td>{p.supplierName ?? "—"}</td>
                  <td className="text-right">
                    <Money value={p.unitPrice} />
                    <span className="text-xs text-ink-soft">/{p.purchaseUom}</span>
                  </td>
                  <td><Pct bp={p.vsPreviousBp} /></td>
                  <td><Pct bp={p.vsRefBp} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
