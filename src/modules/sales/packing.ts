import "server-only";
// Đóng gói: hàng đợi, phiếu lấy hàng gộp (R-BH-12), màn đóng gói một đơn (R-BH-13). Chỉ đọc; ghi qua packOrder.
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { inventoryItems, lots, orderEvents, orderItems, orders, products, stockBalances, stockLots, warehouseLocations, warehouses } from "@/db/schema";
import { vnToday } from "@/modules/numbering";
import { isLotUsable, planFefo, type FefoCandidate } from "@/modules/inventory/rules";
import { awaitsPacking, isOrderPacked } from "@/modules/orders/rules";
import { awaitsPackingSql, orderPackedSql } from "./packing-sql";

export type LotCandidate = FefoCandidate & { locationCode: string };

// Lô thành phẩm trong kho FG của một sản phẩm (đọc sổ kho), có cờ dùng được (R-KHO-11)
export async function fgCandidates(db: Db | Tx, productId: string, today = vnToday()): Promise<LotCandidate[]> {
  const rows = await db
    .select({
      stockLotId: stockBalances.stockLotId,
      locationId: stockBalances.locationId,
      warehouseId: stockBalances.warehouseId,
      qty: stockBalances.qty,
      code: stockLots.code,
      locationCode: warehouseLocations.code,
      expiresOn: stockLots.expiresOn,
      lotExpiresOn: lots.expiresOn,
      manufacturedOn: stockLots.manufacturedOn,
      qcStatus: stockLots.qcStatus,
      productLotStatus: lots.releaseStatus,
    })
    .from(stockBalances)
    .innerJoin(stockLots, eq(stockLots.id, stockBalances.stockLotId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, stockBalances.itemId))
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .innerJoin(warehouseLocations, eq(warehouseLocations.id, stockBalances.locationId))
    .leftJoin(lots, eq(lots.id, stockLots.productLotId))
    .where(and(eq(inventoryItems.productId, productId), gt(stockBalances.qty, 0), eq(warehouses.kind, "finished")))
    .orderBy(asc(stockLots.code));
  return rows.map((r) => {
    const expiresOn = r.expiresOn ?? r.lotExpiresOn ?? null;
    return {
      stockLotId: r.stockLotId,
      locationId: r.locationId,
      warehouseId: r.warehouseId,
      qty: r.qty,
      code: r.code,
      locationCode: r.locationCode,
      expiresOn,
      manufacturedOn: r.manufacturedOn,
      usable: isLotUsable({ qcStatus: r.qcStatus, productLotStatus: r.productLotStatus, expiresOn }, today),
    };
  });
}

// Gợi ý FEFO không ghi gì: trả lô, số lượng, vị trí
export function suggestFefo(cands: LotCandidate[], qty: number, today = vnToday()) {
  const plan = planFefo(cands, qty, today);
  if (!plan.ok) return { ok: false as const, available: plan.available };
  const byLot = new Map<string, { stockLotId: string; code: string; expiresOn: string | null; locations: string[]; qty: number }>();
  for (const p of plan.picks) {
    const c = cands.find((x) => x.stockLotId === p.stockLotId && x.locationId === p.locationId)!;
    const cur = byLot.get(p.stockLotId) ?? { stockLotId: p.stockLotId, code: c.code, expiresOn: c.expiresOn, locations: [], qty: 0 };
    cur.qty += p.qty;
    if (!cur.locations.includes(c.locationCode)) cur.locations.push(c.locationCode);
    byLot.set(p.stockLotId, cur);
  }
  return { ok: true as const, picks: [...byLot.values()] };
}

// Đơn chờ đóng gói
export async function listPackingQueue() {
  const db = await getDb();
  const rows = await db
    .select()
    .from(orders)
    .where(awaitsPackingSql)
    .orderBy(asc(orders.createdAt))
    .limit(200);
  const ids = rows.map((r) => r.id);
  const items = ids.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids)) : [];
  return rows.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id) }));
}

// Đơn đã gói, chờ giao cho vận chuyển
export async function listPackedAwaitingShipment() {
  const db = await getDb();
  return db
    .select()
    .from(orders)
    .where(orderPackedSql)
    .orderBy(asc(orders.updatedAt))
    .limit(100);
}

// R-BH-12: phiếu lấy hàng gộp theo sản phẩm + danh sách theo đơn
export async function buildPickList(orderIds: string[]) {
  const db = await getDb();
  if (orderIds.length === 0) return { products: [], orders: [] };
  const os = await db
    .select()
    .from(orders)
    .where(and(inArray(orders.id, orderIds), awaitsPackingSql))
    .orderBy(asc(orders.code));
  const ids = os.map((o) => o.id);
  const items = ids.length
    ? await db
        .select({ orderId: orderItems.orderId, productId: orderItems.productId, productName: orderItems.productName, quantity: orderItems.quantity, track: products.trackInventory, code: products.code })
        .from(orderItems)
        .innerJoin(products, eq(products.id, orderItems.productId))
        .where(inArray(orderItems.orderId, ids))
    : [];
  const byProduct = new Map<string, { productId: string; name: string; code: string; qty: number; track: boolean }>();
  for (const it of items) {
    const cur = byProduct.get(it.productId) ?? { productId: it.productId, name: it.productName, code: it.code, qty: 0, track: it.track };
    cur.qty += it.quantity;
    byProduct.set(it.productId, cur);
  }
  const today = vnToday();
  const productsOut = [];
  for (const p of [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!p.track) {
      productsOut.push({ ...p, suggestion: null, available: null });
      continue;
    }
    const cands = await fgCandidates(db, p.productId, today);
    const s = suggestFefo(cands, p.qty, today);
    productsOut.push({ ...p, suggestion: s.ok ? s.picks : null, available: s.ok ? null : s.available });
  }
  return { products: productsOut, orders: os.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id) })) };
}

// Màn đóng gói một đơn: dòng, gợi ý FEFO, lô đổi được
export async function getPackingView(orderId: string) {
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  const [packedEvent] = await db
    .select({ id: orderEvents.id })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.type, "packed")))
    .limit(1);
  const packed = isOrderPacked({ status: order.status, stockIssuedAt: order.stockIssuedAt, hasPackedEvent: !!packedEvent });
  const items = await db
    .select({ id: orderItems.id, productId: orderItems.productId, productName: orderItems.productName, quantity: orderItems.quantity, lotId: orderItems.lotId, lotNo: lots.lotNo, track: products.trackInventory })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .leftJoin(lots, eq(lots.id, orderItems.lotId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.productName), asc(orderItems.id));
  const today = vnToday();
  const lines = [];
  for (const it of items) {
    if (!it.track || order.stockIssuedAt) {
      lines.push({ ...it, suggestion: null, candidates: [] as LotCandidate[], available: null as number | null });
      continue;
    }
    const cands = await fgCandidates(db, it.productId, today);
    const s = suggestFefo(cands, it.quantity, today);
    lines.push({ ...it, suggestion: s.ok ? s.picks : null, candidates: cands, available: s.ok ? null : s.available });
  }
  const releasedLots = await db
    .select({ id: lots.id, lotNo: lots.lotNo, productId: lots.productId })
    .from(lots)
    .where(and(inArray(lots.productId, [...new Set(items.map((i) => i.productId))].concat(["00000000-0000-0000-0000-000000000000"])), eq(lots.releaseStatus, "released")));
  return { order, lines, releasedLots, packed, awaitsPacking: awaitsPacking({ status: order.status, stockIssuedAt: order.stockIssuedAt, hasPackedEvent: !!packedEvent }) };
}
