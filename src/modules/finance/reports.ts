// Báo cáo tài chính: lãi lỗ theo kỳ, theo sản phẩm, theo kênh; dòng tiền thực tế và dự báo; vốn lưu động
// (05-tai-chinh.md R-TC-21…R-TC-27). Chỉ đọc; tính lại được từ dữ liệu nguồn.
import { and, asc, eq, gte, inArray, isNotNull, like, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db/client";
import {
  cashAccounts,
  cashTransactions,
  extractionRuns,
  financeCategories,
  lots,
  orderItems,
  orders,
  overheadAllocationLines,
  payables,
  productionOrders,
  receivables,
  returnRequestLines,
  returnRequests,
  salesChannels,
  stockBalances,
  stockLots,
  stockMovements,
  warehouses,
} from "@/db/schema";
import { vnToday } from "@/modules/numbering";
import { costOfQty } from "@/modules/inventory/rules";
import { accountBalance } from "./ledger";
import { addDaysIso, allocateLargestRemainder, channelMetrics, computePnl, forecastCash, splitOrderAmounts, vnStartOf, workingCapital, type PlLine, type PnlResult } from "./rules";

type Range = { from: string; to: string }; // [from, to) theo ngày giờ VN

// ---------------------------------------------------------------------------------------------
// Dữ liệu nguồn của kỳ

type RecognizedLine = { orderId: string; itemId: string; productId: string; productName: string; quantity: number; lineTotal: number; cogs: number; hasCost: boolean };
type RecognizedOrder = { id: string; code: string; channel: string; subtotal: number; discount: number; shipping: number; platformFee: number; lines: RecognizedLine[] };

// R-TC-21: đơn có delivered_at trong kỳ (mọi trạng thái); giá vốn dòng = costOfQty theo lô kho thành phẩm
async function recognizedOrders(db: Db | Tx, r: Range): Promise<RecognizedOrder[]> {
  const os = await db
    .select({ id: orders.id, code: orders.code, channel: orders.channel, subtotal: orders.subtotal, discount: orders.discountTotal, shipping: orders.shippingFee, platformFee: orders.platformFee })
    .from(orders)
    .where(and(isNotNull(orders.deliveredAt), gte(orders.deliveredAt, vnStartOf(r.from)), lt(orders.deliveredAt, vnStartOf(r.to))));
  if (os.length === 0) return [];
  const items = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productName: orderItems.productName,
      quantity: orderItems.quantity,
      lineTotal: orderItems.lineTotal,
      receivedQty: stockLots.receivedQty,
      receivedCost: stockLots.receivedCost,
    })
    .from(orderItems)
    .leftJoin(stockLots, and(isNotNull(orderItems.lotId), eq(stockLots.productLotId, orderItems.lotId)))
    .where(inArray(orderItems.orderId, os.map((o) => o.id)))
    .orderBy(asc(orderItems.id));
  return os.map((o) => ({
    ...o,
    lines: items
      .filter((i) => i.orderId === o.id)
      .map((i) => ({
        orderId: o.id,
        itemId: i.id,
        productId: i.productId ?? "",
        productName: i.productName,
        quantity: i.quantity,
        lineTotal: i.lineTotal,
        hasCost: i.receivedQty !== null,
        cogs: i.receivedQty !== null ? costOfQty(i.quantity, i.receivedQty, i.receivedCost ?? 0) : 0,
      })),
  }));
}

type ReturnLine = { orderId: string; orderItemId: string; productId: string; productName: string; channel: string; refund: number; restockCost: number };

// Đổi trả completed trong kỳ: tiền hoàn theo dòng; giá vốn hàng nhập lại FG (disposition restock)
async function completedReturns(db: Db | Tx, r: Range): Promise<{ refundTotal: number; lines: ReturnLine[]; orderLevelRefund: { orderId: string; channel: string; amount: number }[] }> {
  const reqs = await db
    .select({ id: returnRequests.id, orderId: returnRequests.orderId, refund: returnRequests.refundAmount, channel: orders.channel })
    .from(returnRequests)
    .innerJoin(orders, eq(orders.id, returnRequests.orderId))
    .where(and(eq(returnRequests.status, "completed"), gte(returnRequests.completedAt, vnStartOf(r.from)), lt(returnRequests.completedAt, vnStartOf(r.to))));
  if (reqs.length === 0) return { refundTotal: 0, lines: [], orderLevelRefund: [] };
  const lines = await db
    .select({
      returnId: returnRequestLines.returnId,
      orderItemId: returnRequestLines.orderItemId,
      qty: returnRequestLines.qty,
      disposition: returnRequestLines.disposition,
      refund: returnRequestLines.refundAmount,
      productId: orderItems.productId,
      productName: orderItems.productName,
      orderId: orderItems.orderId,
      receivedQty: stockLots.receivedQty,
      receivedCost: stockLots.receivedCost,
    })
    .from(returnRequestLines)
    .innerJoin(orderItems, eq(orderItems.id, returnRequestLines.orderItemId))
    .leftJoin(stockLots, and(isNotNull(orderItems.lotId), eq(stockLots.productLotId, orderItems.lotId)))
    .where(inArray(returnRequestLines.returnId, reqs.map((q) => q.id)));
  const channelOf = new Map(reqs.map((q) => [q.orderId, q.channel]));
  const out: ReturnLine[] = lines.map((l) => ({
    orderId: l.orderId,
    orderItemId: l.orderItemId,
    productId: l.productId ?? "",
    productName: l.productName,
    channel: channelOf.get(l.orderId) ?? "",
    refund: l.refund,
    restockCost: l.disposition === "restock" && l.receivedQty !== null ? costOfQty(l.qty, l.receivedQty, l.receivedCost ?? 0) : 0,
  }));
  // Phần tiền hoàn của phiếu không chia theo dòng (refund_amount phiếu − tổng dòng) tính theo đơn
  const orderLevelRefund = reqs
    .map((q) => ({ orderId: q.orderId, channel: q.channel, amount: q.refund - lines.filter((l) => l.returnId === q.id).reduce((a, l) => a + l.refund, 0) }))
    .filter((x) => x.amount > 0);
  return { refundTotal: reqs.reduce((a, q) => a + q.refund, 0), lines: out, orderLevelRefund };
}

// Phiếu hoàn tiền cả đơn (order-refund) trong kỳ của đơn đã giao
async function orderRefunds(db: Db | Tx, r: Range): Promise<{ orderId: string; channel: string; amount: number }[]> {
  const rows = await db
    .select({ orderId: orders.id, channel: orders.channel, amount: cashTransactions.amount })
    .from(cashTransactions)
    .innerJoin(orders, sql`${orders.id}::text = substring(${cashTransactions.idempotencyKey} from 14)`)
    .where(
      and(
        eq(cashTransactions.status, "posted"),
        like(cashTransactions.idempotencyKey, "order-refund:%"),
        isNotNull(orders.deliveredAt),
        gte(cashTransactions.occurredOn, r.from),
        lt(cashTransactions.occurredOn, r.to),
      ),
    );
  return rows;
}

// Phiếu thu/chi posted trong kỳ theo dòng lãi lỗ
async function txByPlLine(db: Db | Tx, r: Range): Promise<Record<PlLine, { in: number; out: number }>> {
  const rows = await db
    .select({ pl: financeCategories.plLine, dir: cashTransactions.direction, s: sql<string>`sum(${cashTransactions.amount})` })
    .from(cashTransactions)
    .innerJoin(financeCategories, eq(financeCategories.id, cashTransactions.categoryId))
    .where(and(eq(cashTransactions.status, "posted"), gte(cashTransactions.occurredOn, r.from), lt(cashTransactions.occurredOn, r.to)))
    .groupBy(financeCategories.plLine, cashTransactions.direction);
  const out = Object.fromEntries((["none", "capitalized", "selling", "marketing", "admin", "other_income", "other_expense", "tax"] as PlLine[]).map((k) => [k, { in: 0, out: 0 }])) as Record<PlLine, { in: number; out: number }>;
  for (const row of rows) {
    if (row.dir === "in") out[row.pl].in += Number(row.s);
    if (row.dir === "out") out[row.pl].out += Number(row.s);
  }
  return out;
}

const VALUE_TYPES = ["sample_issue", "qc_sample_issue", "research_issue", "scrap_issue", "count_adjust"] as const;

// Giá trị biến động kho trong kỳ (xuất mẫu, mẫu QC, nghiên cứu, hủy, kiểm kê), dòng đảo tính theo loại dòng gốc
async function movementValues(db: Db | Tx, r: Range) {
  const original = alias(stockMovements, "original");
  const rows = await db
    .select({ type: stockMovements.type, origType: original.type, qty: stockMovements.qty, receivedQty: stockLots.receivedQty, receivedCost: stockLots.receivedCost })
    .from(stockMovements)
    .leftJoin(original, eq(original.id, stockMovements.reversalOf))
    .innerJoin(stockLots, eq(stockLots.id, stockMovements.stockLotId))
    .where(
      and(
        gte(stockMovements.occurredAt, vnStartOf(r.from)),
        lt(stockMovements.occurredAt, vnStartOf(r.to)),
        or(inArray(stockMovements.type, [...VALUE_TYPES]), and(eq(stockMovements.type, "reversal"), inArray(original.type, [...VALUE_TYPES]))),
      ),
    );
  const v = { sample: 0, qcResearch: 0, scrap: 0, countGain: 0, countLoss: 0 };
  for (const m of rows) {
    const type = m.type === "reversal" ? m.origType : m.type;
    const cost = costOfQty(m.qty, m.receivedQty, m.receivedCost); // có dấu theo qty
    if (type === "sample_issue") v.sample -= cost;
    else if (type === "qc_sample_issue" || type === "research_issue") v.qcResearch -= cost;
    else if (type === "scrap_issue") v.scrap -= cost;
    else if (type === "count_adjust") {
      if (cost > 0) v.countGain += cost;
      else v.countLoss -= cost;
    }
  }
  return v;
}

// Hao hụt do hủy lệnh SX / mẻ chiết trong kỳ (R-SX-21): NVL xuất ròng còn lại của lệnh/mẻ đã hủy.
// Mốc kỳ là updated_at của lệnh/mẻ (schema không có cancelled_at).
async function cancelLoss(db: Db | Tx, r: Range): Promise<number> {
  const pos = await db
    .select({ id: productionOrders.id })
    .from(productionOrders)
    .where(and(eq(productionOrders.status, "cancelled"), gte(productionOrders.updatedAt, vnStartOf(r.from)), lt(productionOrders.updatedAt, vnStartOf(r.to))));
  const runs = await db
    .select({ id: extractionRuns.id })
    .from(extractionRuns)
    .where(and(eq(extractionRuns.status, "cancelled"), gte(extractionRuns.updatedAt, vnStartOf(r.from)), lt(extractionRuns.updatedAt, vnStartOf(r.to))));
  if (pos.length === 0 && runs.length === 0) return 0;
  const original = alias(stockMovements, "original");
  const poIds = pos.map((p) => p.id);
  const runIds = runs.map((x) => x.id);
  const conds = [];
  if (poIds.length) {
    conds.push(and(inArray(stockMovements.productionOrderId, poIds), inArray(stockMovements.type, ["production_issue", "production_return"])));
    conds.push(and(eq(stockMovements.type, "reversal"), inArray(original.productionOrderId, poIds), inArray(original.type, ["production_issue", "production_return"])));
  }
  if (runIds.length) {
    conds.push(and(inArray(stockMovements.extractionRunId, runIds), eq(stockMovements.type, "extraction_issue")));
    conds.push(and(eq(stockMovements.type, "reversal"), inArray(original.extractionRunId, runIds), eq(original.type, "extraction_issue")));
  }
  const rows = await db
    .select({ qty: stockMovements.qty, receivedQty: stockLots.receivedQty, receivedCost: stockLots.receivedCost })
    .from(stockMovements)
    .leftJoin(original, eq(original.id, stockMovements.reversalOf))
    .innerJoin(stockLots, eq(stockLots.id, stockMovements.stockLotId))
    .where(or(...conds));
  return -rows.reduce((a, m) => a + costOfQty(m.qty, m.receivedQty, m.receivedCost), 0);
}

// Nhân công + chung tay + phân bổ của lệnh hoàn thành trong kỳ (cho dòng ghi chú)
async function capitalizedAbsorbed(db: Db | Tx, r: Range): Promise<number> {
  const [row] = await db
    .select({
      s: sql<string>`coalesce(sum(${productionOrders.laborCost} + ${productionOrders.overheadCost} + coalesce((select sum(${overheadAllocationLines.amount}) from ${overheadAllocationLines} where ${overheadAllocationLines.productionOrderId} = ${productionOrders.id}), 0)), 0)`,
    })
    .from(productionOrders)
    .where(and(inArray(productionOrders.status, ["qc", "completed"]), gte(productionOrders.finishedAt, vnStartOf(r.from)), lt(productionOrders.finishedAt, vnStartOf(r.to))));
  return Number(row?.s ?? 0);
}

// ---------------------------------------------------------------------------------------------
// R-TC-22 · Lãi lỗ theo kỳ

export async function profitAndLoss(db: Db | Tx, r: Range): Promise<PnlResult & { missingCostLines: number; orderCount: number }> {
  const [os, rets, refunds, tx, mv, loss, absorbed] = await Promise.all([
    recognizedOrders(db, r),
    completedReturns(db, r),
    orderRefunds(db, r),
    txByPlLine(db, r),
    movementValues(db, r),
    cancelLoss(db, r),
    capitalizedAbsorbed(db, r),
  ]);
  const lines = os.flatMap((o) => o.lines);
  const result = computePnl({
    goodsRevenue: os.reduce((a, o) => a + o.subtotal, 0),
    discount: os.reduce((a, o) => a + o.discount, 0),
    shippingIncome: os.reduce((a, o) => a + o.shipping, 0),
    returns: rets.refundTotal + refunds.reduce((a, x) => a + x.amount, 0),
    cogs: lines.reduce((a, l) => a + l.cogs, 0) - rets.lines.reduce((a, l) => a + l.restockCost, 0),
    platformFee: os.reduce((a, o) => a + o.platformFee, 0),
    sellingTx: tx.selling.out,
    marketingTx: tx.marketing.out,
    sampleValue: mv.sample,
    adminTx: tx.admin.out,
    qcResearchValue: mv.qcResearch,
    otherIncomeTx: tx.other_income.in,
    countGain: mv.countGain,
    otherExpenseTx: tx.other_expense.out,
    scrapValue: mv.scrap,
    countLoss: mv.countLoss,
    cancelLoss: loss,
    taxTx: tx.tax.out,
    capitalizedTx: tx.capitalized.out,
    capitalizedAbsorbed: absorbed,
  });
  return { ...result, missingCostLines: lines.filter((l) => !l.hasCost).length, orderCount: os.length };
}

// ---------------------------------------------------------------------------------------------
// R-TC-23 · Lợi nhuận theo sản phẩm

export type ProductProfit = { productId: string; productName: string; quantity: number; revenue: number; discount: number; cogs: number; platformFee: number; returns: number; profit: number };

export async function profitByProduct(db: Db | Tx, r: Range): Promise<{ rows: ProductProfit[]; shippingIncome: number }> {
  const [os, rets, refunds] = await Promise.all([recognizedOrders(db, r), completedReturns(db, r), orderRefunds(db, r)]);
  const map = new Map<string, ProductProfit>();
  const get = (id: string, name: string) => {
    let p = map.get(id);
    if (!p) {
      p = { productId: id, productName: name, quantity: 0, revenue: 0, discount: 0, cogs: 0, platformFee: 0, returns: 0, profit: 0 };
      map.set(id, p);
    }
    return p;
  };
  for (const o of os) {
    const split = splitOrderAmounts(o.lines, o.discount, o.platformFee);
    o.lines.forEach((l, i) => {
      const p = get(l.productId, l.productName);
      p.quantity += l.quantity;
      p.discount += split[i]!.discount;
      p.revenue += l.lineTotal - split[i]!.discount;
      p.cogs += l.cogs;
      p.platformFee += split[i]!.platformFee;
    });
  }
  for (const l of rets.lines) {
    const p = get(l.productId, l.productName);
    p.returns += l.refund;
    p.cogs -= l.restockCost;
  }
  // Tiền hoàn không gắn dòng (hoàn cả đơn, phần phiếu đổi trả không chia dòng): chia theo line_total của đơn
  const orderLevel = [...refunds, ...rets.orderLevelRefund];
  if (orderLevel.length) {
    const items = await db
      .select({ orderId: orderItems.orderId, productId: orderItems.productId, productName: orderItems.productName, lineTotal: orderItems.lineTotal })
      .from(orderItems)
      .where(inArray(orderItems.orderId, [...new Set(orderLevel.map((x) => x.orderId))]))
      .orderBy(asc(orderItems.id));
    for (const x of orderLevel) {
      const its = items.filter((i) => i.orderId === x.orderId);
      const parts = allocateLargestRemainder(x.amount, its.map((i) => i.lineTotal));
      its.forEach((i, k) => {
        get(i.productId ?? "", i.productName).returns += parts?.[k] ?? 0;
      });
    }
  }
  const rows = [...map.values()].map((p) => ({ ...p, profit: p.revenue - p.cogs - p.platformFee - p.returns })).sort((a, b) => b.revenue - a.revenue);
  return { rows, shippingIncome: os.reduce((a, o) => a + o.shipping, 0) };
}

// ---------------------------------------------------------------------------------------------
// R-TC-24 · Hiệu quả kênh

export type ChannelRow = { channel: string; channelName: string; orders: number; netRevenue: number; cogs: number; platformFee: number; contribution: number; marketing: number; afterMarketing: number; revenuePerMarketing: number | null };

export async function channelReport(db: Db | Tx, r: Range): Promise<ChannelRow[]> {
  const [os, rets, refunds, channels, mkt] = await Promise.all([
    recognizedOrders(db, r),
    completedReturns(db, r),
    orderRefunds(db, r),
    db.select({ code: salesChannels.code, name: salesChannels.name }).from(salesChannels),
    db
      .select({ channel: cashTransactions.channelCode, s: sql<string>`sum(${cashTransactions.amount})` })
      .from(cashTransactions)
      .innerJoin(financeCategories, eq(financeCategories.id, cashTransactions.categoryId))
      .where(and(eq(cashTransactions.status, "posted"), eq(cashTransactions.direction, "out"), eq(financeCategories.plLine, "marketing"), gte(cashTransactions.occurredOn, r.from), lt(cashTransactions.occurredOn, r.to)))
      .groupBy(cashTransactions.channelCode),
  ]);
  const name = new Map(channels.map((c) => [c.code, c.name]));
  const acc = new Map<string, { orders: number; netRevenue: number; cogs: number; platformFee: number; marketing: number }>();
  const get = (c: string) => {
    let a = acc.get(c);
    if (!a) {
      a = { orders: 0, netRevenue: 0, cogs: 0, platformFee: 0, marketing: 0 };
      acc.set(c, a);
    }
    return a;
  };
  for (const o of os) {
    const a = get(o.channel);
    a.orders += 1;
    a.netRevenue += o.subtotal - o.discount + o.shipping;
    a.cogs += o.lines.reduce((s, l) => s + l.cogs, 0);
    a.platformFee += o.platformFee;
  }
  for (const l of rets.lines) {
    const a = get(l.channel);
    a.netRevenue -= l.refund;
    a.cogs -= l.restockCost;
  }
  for (const x of [...refunds, ...rets.orderLevelRefund]) get(x.channel).netRevenue -= x.amount;
  for (const m of mkt) get(m.channel ?? "").marketing += Number(m.s);
  return [...acc.entries()]
    .map(([channel, a]) => ({ channel, channelName: channel ? (name.get(channel) ?? channel) : "Chưa gắn kênh", ...a, ...channelMetrics(a) }))
    .sort((x, y) => (x.channel === "" ? 1 : y.channel === "" ? -1 : y.netRevenue - x.netRevenue));
}

// ---------------------------------------------------------------------------------------------
// R-TC-25 · Dòng tiền thực tế theo kỳ và tài khoản

export type CashFlowAccount = {
  accountId: string;
  code: string;
  name: string;
  opening: number;
  inflows: { category: string; amount: number }[];
  outflows: { category: string; amount: number }[];
  transferIn: number;
  transferOut: number;
  closing: number;
};

export async function cashFlowActual(db: Db | Tx, r: Range): Promise<CashFlowAccount[]> {
  const accounts = await db.select().from(cashAccounts).orderBy(asc(cashAccounts.sort), asc(cashAccounts.code));
  const txs = await db
    .select({ accountId: cashTransactions.accountId, toAccountId: cashTransactions.toAccountId, direction: cashTransactions.direction, amount: cashTransactions.amount, category: financeCategories.name })
    .from(cashTransactions)
    .leftJoin(financeCategories, eq(financeCategories.id, cashTransactions.categoryId))
    .where(and(eq(cashTransactions.status, "posted"), gte(cashTransactions.occurredOn, r.from), lt(cashTransactions.occurredOn, r.to)));
  const lastDay = addDaysIso(r.to, -1);
  return Promise.all(
    accounts.map(async (a) => {
      const opening = await accountBalance(db, a.id, addDaysIso(r.from, -1));
      const inMap = new Map<string, number>();
      const outMap = new Map<string, number>();
      let transferIn = 0;
      let transferOut = 0;
      for (const t of txs) {
        if (t.direction === "transfer") {
          if (t.accountId === a.id) transferOut += t.amount;
          if (t.toAccountId === a.id) transferIn += t.amount;
        } else if (t.accountId === a.id) {
          const m = t.direction === "in" ? inMap : outMap;
          m.set(t.category ?? "", (m.get(t.category ?? "") ?? 0) + t.amount);
        }
      }
      const inflows = [...inMap.entries()].map(([category, amount]) => ({ category, amount }));
      const outflows = [...outMap.entries()].map(([category, amount]) => ({ category, amount }));
      const closing = await accountBalance(db, a.id, lastDay);
      return { accountId: a.id, code: a.code, name: a.name, opening, inflows, outflows, transferIn, transferOut, closing };
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// R-TC-26 · Dự báo; R-TC-27 · Vốn lưu động

async function openDebts(db: Db | Tx) {
  const [rs, ps] = await Promise.all([
    db.select({ remaining: sql<number>`${receivables.amount} - ${receivables.paidAmount}`, dueOn: receivables.dueOn }).from(receivables).where(inArray(receivables.status, ["open", "partial"])),
    db.select({ remaining: sql<number>`${payables.amount} - ${payables.paidAmount}`, dueOn: payables.dueOn }).from(payables).where(inArray(payables.status, ["open", "partial"])),
  ]);
  return { receivables: rs.map((x) => ({ remaining: Number(x.remaining), dueOn: x.dueOn })), payables: ps.map((x) => ({ remaining: Number(x.remaining), dueOn: x.dueOn })) };
}

export async function totalCash(db: Db | Tx): Promise<number> {
  const accs = await db.select({ id: cashAccounts.id }).from(cashAccounts).where(eq(cashAccounts.isActive, true));
  let sum = 0;
  for (const a of accs) sum += await accountBalance(db, a.id);
  return sum;
}

export async function cashForecast(db: Db | Tx, opts: { today?: string; weeks: number; minCash: number }) {
  const today = opts.today ?? vnToday();
  const [opening, debts, [pending]] = await Promise.all([
    totalCash(db),
    openDebts(db),
    db.select({ s: sql<string>`coalesce(sum(${cashTransactions.amount}), 0)` }).from(cashTransactions).where(eq(cashTransactions.status, "pending_approval")),
  ]);
  return forecastCash({ today, weeks: opts.weeks, openingBalance: opening, receivables: debts.receivables, payables: debts.payables, pendingRequests: Number(pending?.s ?? 0), minCash: opts.minCash });
}

// R-KHO-28: giá trị tồn, trừ kho rejected và lô rejected/recalled
export async function stockValue(db: Db | Tx): Promise<number> {
  const rows = await db
    .select({ qty: stockBalances.qty, receivedQty: stockLots.receivedQty, receivedCost: stockLots.receivedCost })
    .from(stockBalances)
    .innerJoin(stockLots, eq(stockLots.id, stockBalances.stockLotId))
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .leftJoin(lots, eq(lots.id, stockLots.productLotId))
    .where(
      and(
        sql`${stockBalances.qty} > 0`,
        sql`${warehouses.kind} <> 'rejected'`,
        sql`${stockLots.qcStatus} is distinct from 'rejected'`,
        or(sql`${lots.id} is null`, sql`${lots.releaseStatus} not in ('rejected', 'recalled')`),
      ),
    );
  return rows.reduce((a, r) => a + costOfQty(r.qty, r.receivedQty, r.receivedCost), 0);
}

export async function workingCapitalReport(db: Db | Tx) {
  const [stock, debts, cash] = await Promise.all([stockValue(db), openDebts(db), totalCash(db)]);
  const rec = debts.receivables.reduce((a, x) => a + x.remaining, 0);
  const pay = debts.payables.reduce((a, x) => a + x.remaining, 0);
  return { stockValue: stock, receivables: rec, payables: pay, cash, workingCapital: workingCapital({ stockValue: stock, receivables: rec, payables: pay }) };
}

// Thu/chi trong kỳ (Tổng quan): không tính chuyển quỹ
export async function inOutTotals(db: Db | Tx, r: Range): Promise<{ in: number; out: number }> {
  const rows = await db
    .select({ dir: cashTransactions.direction, s: sql<string>`sum(${cashTransactions.amount})` })
    .from(cashTransactions)
    .where(and(eq(cashTransactions.status, "posted"), inArray(cashTransactions.direction, ["in", "out"]), gte(cashTransactions.occurredOn, r.from), lte(cashTransactions.occurredOn, addDaysIso(r.to, -1))))
    .groupBy(cashTransactions.direction);
  return { in: Number(rows.find((x) => x.dir === "in")?.s ?? 0), out: Number(rows.find((x) => x.dir === "out")?.s ?? 0) };
}

