import "server-only";
// Báo cáo bán hàng (R-BH-26, R-BH-29, R-BH-30). Doanh số theo ngày đặt; lợi nhuận góp theo ngày giao.
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dealers, orderItems, orders, returnRequests, salesChannels, stockLots, stockMovements } from "@/db/schema";
import { costOfQty } from "@/modules/inventory/rules";
import { contributionMargin, countsForRevenue, dealerCommission, netSales, periodKey, returnRate, salesSummary, successRate, vnDayStart, type Granularity } from "./rules";

export type ReportFilter = { from: string; toExclusive: string; granularity: Granularity; withCost: boolean };

export async function getSalesReport(f: ReportFilter) {
  const db = await getDb();
  const start = vnDayStart(f.from);
  const end = vnDayStart(f.toExclusive);
  const created = await db
    .select({ id: orders.id, status: orders.status, subtotal: orders.subtotal, discountTotal: orders.discountTotal, createdAt: orders.createdAt, channel: orders.channel, dealerId: orders.dealerId })
    .from(orders)
    .where(and(gte(orders.createdAt, start), lt(orders.createdAt, end)));

  const summary = salesSummary(created);
  const group = <K extends string | null>(key: (o: (typeof created)[number]) => K) => {
    const m = new Map<K, typeof created>();
    for (const o of created) m.set(key(o), [...(m.get(key(o)) ?? []), o]);
    return m;
  };
  const series = [...group((o) => periodKey(o.createdAt, f.granularity)).entries()].map(([k, os]) => ({ key: k, ...salesSummary(os) })).sort((a, b) => a.key.localeCompare(b.key));

  const channels = await db.select({ code: salesChannels.code, name: salesChannels.name }).from(salesChannels);
  const byChannel = [...group((o) => o.channel).entries()].map(([k, os]) => ({ key: k, name: channels.find((c) => c.code === k)?.name ?? k, ...salesSummary(os) })).sort((a, b) => b.revenue - a.revenue);

  const dealerRows = await db.select({ id: dealers.id, name: dealers.name, code: dealers.code, commissionBp: dealers.commissionBp }).from(dealers);
  const byDealer = [...group((o) => o.dealerId).entries()]
    .filter(([k]) => k)
    .map(([k, os]) => {
      const d = dealerRows.find((x) => x.id === k);
      return { key: k!, name: d ? `${d.code} · ${d.name}` : "—", ...salesSummary(os) };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const countedIds = created.filter((o) => countsForRevenue(o.status)).map((o) => o.id);
  const items = countedIds.length
    ? await db
        .select({ productId: orderItems.productId, name: orderItems.productName, qty: sql<number>`sum(${orderItems.quantity})::int`, revenue: sql<string>`sum(${orderItems.lineTotal})` })
        .from(orderItems)
        .where(inArray(orderItems.orderId, countedIds))
        .groupBy(orderItems.productId, orderItems.productName)
    : [];
  const byProductMap = new Map<string, { productId: string; name: string; qty: number; revenue: number }>();
  for (const it of items) {
    const cur = byProductMap.get(it.productId) ?? { productId: it.productId, name: it.name, qty: 0, revenue: 0 };
    cur.qty += Number(it.qty);
    cur.revenue += Number(it.revenue);
    byProductMap.set(it.productId, cur);
  }
  const byProduct = [...byProductMap.values()].sort((a, b) => b.qty - a.qty);

  // Tỷ lệ hoàn theo ngày giao (R-BH-26)
  const shipped = await db
    .select({ id: orders.id, status: orders.status, deliveredAt: orders.deliveredAt, updatedAt: orders.updatedAt })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["delivered", "returned"]),
        isNotNull(orders.shippedAt),
        gte(sql`coalesce(${orders.deliveredAt}, ${orders.updatedAt})`, start),
        lt(sql`coalesce(${orders.deliveredAt}, ${orders.updatedAt})`, end),
      ),
    );
  const deliveredIds = shipped.filter((o) => o.status === "delivered").map((o) => o.id);
  const withReturn = deliveredIds.length
    ? await db
        .selectDistinct({ orderId: returnRequests.orderId })
        .from(returnRequests)
        .where(and(inArray(returnRequests.orderId, deliveredIds), eq(returnRequests.status, "completed")))
    : [];
  const rate = returnRate({ returnedOrders: shipped.filter((o) => o.status === "returned").length, deliveredWithReturn: withReturn.length, delivered: deliveredIds.length });

  const margin = f.withCost ? await marginByChannel(start, end, channels) : null;
  return { summary, series, byChannel, byDealer, byProduct, returnRate: rate, successRate: successRate(created), margin, dealerCommissions: await commissionByDealer(start, end, dealerRows) };
}

// Lợi nhuận góp theo kênh, đơn giao trong kỳ (cần finance.view)
async function marginByChannel(start: Date, end: Date, channels: { code: string; name: string }[]) {
  const db = await getDb();
  const delivered = await db
    .select({ id: orders.id, channel: orders.channel, subtotal: orders.subtotal, discountTotal: orders.discountTotal, platformFee: orders.platformFee })
    .from(orders)
    .where(and(eq(orders.status, "delivered"), gte(orders.deliveredAt, start), lt(orders.deliveredAt, end)));
  const ids = delivered.map((o) => o.id);
  const moves = ids.length
    ? await db
        .select({ orderId: stockMovements.docId, qty: stockMovements.qty, receivedQty: stockLots.receivedQty, receivedCost: stockLots.receivedCost })
        .from(stockMovements)
        .innerJoin(stockLots, eq(stockLots.id, stockMovements.stockLotId))
        .where(
          and(
            eq(stockMovements.docType, "order"),
            inArray(stockMovements.docId, ids),
            eq(stockMovements.type, "sale_issue"),
            sql`not exists (select 1 from stock_movements r where r.reversal_of = ${stockMovements.id})`,
          ),
        )
    : [];
  const refunds = ids.length
    ? await db
        .select({ orderId: returnRequests.orderId, v: sql<string>`sum(${returnRequests.refundAmount})` })
        .from(returnRequests)
        .where(and(inArray(returnRequests.orderId, ids), eq(returnRequests.status, "completed")))
        .groupBy(returnRequests.orderId)
    : [];
  const out = new Map<string, { key: string; name: string; revenue: number; platformFee: number; cogs: number; refunded: number; margin: number }>();
  for (const o of delivered) {
    const cur = out.get(o.channel) ?? { key: o.channel, name: channels.find((c) => c.code === o.channel)?.name ?? o.channel, revenue: 0, platformFee: 0, cogs: 0, refunded: 0, margin: 0 };
    cur.revenue += netSales(o);
    cur.platformFee += o.platformFee;
    cur.cogs += moves.filter((m) => m.orderId === o.id).reduce((s, m) => s + costOfQty(-m.qty, m.receivedQty, m.receivedCost), 0);
    cur.refunded += Number(refunds.find((r) => r.orderId === o.id)?.v ?? 0);
    out.set(o.channel, cur);
  }
  return [...out.values()].map((c) => ({ ...c, margin: contributionMargin(c) })).sort((a, b) => b.revenue - a.revenue);
}

async function commissionByDealer(start: Date, end: Date, dealerRows: { id: string; name: string; code: string; commissionBp: number }[]) {
  const db = await getDb();
  const rows = await db
    .select({ dealerId: orders.dealerId, net: sql<string>`coalesce(sum(${orders.subtotal} - ${orders.discountTotal}), 0)` })
    .from(orders)
    .where(and(isNotNull(orders.dealerId), inArray(orders.status, ["delivered", "returned"]), gte(orders.deliveredAt, start), lt(orders.deliveredAt, end)))
    .groupBy(orders.dealerId);
  const refunds = await db
    .select({ dealerId: orders.dealerId, v: sql<string>`coalesce(sum(${returnRequests.refundAmount}), 0)` })
    .from(returnRequests)
    .innerJoin(orders, eq(orders.id, returnRequests.orderId))
    .where(and(isNotNull(orders.dealerId), eq(returnRequests.status, "completed"), gte(orders.deliveredAt, start), lt(orders.deliveredAt, end)))
    .groupBy(orders.dealerId);
  return rows.map((r) => {
    const d = dealerRows.find((x) => x.id === r.dealerId);
    const refunded = Number(refunds.find((x) => x.dealerId === r.dealerId)?.v ?? 0);
    const net = Number(r.net);
    return { dealerId: r.dealerId!, name: d ? `${d.code} · ${d.name}` : "—", commissionBp: d?.commissionBp ?? 0, net, refunded, commission: dealerCommission(net, refunded, d?.commissionBp ?? 0) };
  });
}

export function reportCsv(report: Awaited<ReturnType<typeof getSalesReport>>): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Kỳ", "Doanh số (đ)", "Số đơn", "AOV (đ)", "Tỷ lệ thành công"].join(",")];
  for (const r of report.series) lines.push([r.key, r.revenue, r.orders, r.aov, r.successRate === null ? "" : (r.successRate * 100).toFixed(1)].map(esc).join(","));
  lines.push("");
  lines.push(["Kênh", "Doanh số (đ)", "Số đơn", "AOV (đ)"].join(","));
  for (const r of report.byChannel) lines.push([r.name, r.revenue, r.orders, r.aov].map(esc).join(","));
  lines.push("");
  lines.push(["Sản phẩm", "Số chai", "Tiền hàng (đ)"].join(","));
  for (const r of report.byProduct) lines.push([r.name, r.qty, r.revenue].map(esc).join(","));
  return `﻿${lines.join("\n")}\n`;
}
