// Cảnh báo Kho cho Tổng quan (00-tong-quan.md mục 8.7; 01-kho.md R-KHO-20, R-KHO-21, R-KHO-22, AC-KHO-24, AC-KHO-29).
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { inventoryItems, lots, orderItems, orders, products, settings, stockBalances, stockIssues, stockLots, stockMovements, warehouses } from "@/db/schema";
import { can, type StaffRole } from "@/modules/auth/rules";
import type { AdminAlert } from "@/modules/alerts";
import { vnToday } from "@/modules/numbering/rules";
import { ERP_SETTINGS_KEY, parseErpSettings } from "@/modules/settings/erp-schema";
import { getItemStock } from "./ledger";
import { expiryFlag, formatQty, isLotUsable, slowMovingDays, type DisplayUom } from "./rules";

export type { AdminAlert };

const MAX_ITEM_ALERTS = 5;

export async function getAlerts(role: StaffRole): Promise<AdminAlert[]> {
  const db = await getDb();
  return computeInventoryAlerts(db, role, vnToday());
}

// Tách riêng để test truyền "hôm nay"
export async function computeInventoryAlerts(db: Db, role: StaffRole, today: string): Promise<AdminAlert[]> {
  const out: AdminAlert[] = [];
  const [cfgRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, ERP_SETTINGS_KEY));
  const cfg = parseErpSettings(cfgRow?.value);

  // Dưới tối thiểu (R-KHO-20)
  const withMin = await db
    .select({ id: inventoryItems.id, code: inventoryItems.code, name: inventoryItems.name, minStock: inventoryItems.minStock, baseUom: inventoryItems.baseUom, displayUom: inventoryItems.displayUom })
    .from(inventoryItems)
    .where(and(isNotNull(inventoryItems.minStock), eq(inventoryItems.isActive, true)))
    .orderBy(asc(inventoryItems.code));
  if (withMin.length) {
    const stock = await getItemStock(db, withMin.map((i) => i.id), today);
    const low = withMin.filter((i) => (stock.get(i.id)?.available ?? 0) < (i.minStock ?? 0));
    for (const i of low.slice(0, MAX_ITEM_ALERTS)) {
      const f = (q: number) => formatQty(q, i.baseUom, i.displayUom as DisplayUom);
      out.push({ module: "kho", level: "warn", text: `${i.code} ${i.name} còn ${f(stock.get(i.id)?.available ?? 0)}, dưới mức ${f(i.minStock ?? 0).replace(/ [^ ]+$/, "")}`, href: `/admin/kho/hang-hoa/${i.id}` });
    }
    if (low.length > MAX_ITEM_ALERTS) out.push({ module: "kho", level: "warn", text: `Thêm ${low.length - MAX_ITEM_ALERTS} hàng dưới mức tối thiểu`, href: "/admin/kho", count: low.length - MAX_ITEM_ALERTS });
  }

  // Sắp hết hạn, đã hết hạn (R-KHO-21): lô có số dư > 0 ngoài kho rejected
  const lotBalances = await db
    .select({
      stockLotId: stockBalances.stockLotId,
      qty: sql<string>`sum(${stockBalances.qty})::text`,
      expiresOn: stockLots.expiresOn,
      productLotExpiresOn: lots.expiresOn,
      createdAt: stockLots.createdAt,
    })
    .from(stockBalances)
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .innerJoin(stockLots, eq(stockLots.id, stockBalances.stockLotId))
    .leftJoin(lots, eq(lots.id, stockLots.productLotId))
    .where(and(gt(stockBalances.qty, 0), ne(warehouses.kind, "rejected")))
    .groupBy(stockBalances.stockLotId, stockLots.expiresOn, lots.expiresOn, stockLots.createdAt);
  let expiring = 0;
  let expired = 0;
  for (const b of lotBalances) {
    const flag = expiryFlag(b.expiresOn ?? b.productLotExpiresOn ?? null, today, cfg.expiryWarnDays);
    if (flag?.kind === "expiring") expiring++;
    if (flag?.kind === "expired") expired++;
  }
  if (expired) out.push({ module: "kho", level: "danger", text: `${expired} lô đã hết hạn còn trong kho`, href: "/admin/kho/bao-cao", count: expired });
  if (expiring) out.push({ module: "kho", level: "warn", text: `${expiring} lô sắp hết hạn trong ${cfg.expiryWarnDays} ngày`, href: "/admin/kho/bao-cao", count: expiring });

  // Tồn lâu (R-KHO-22): từ lần xuất gần nhất (biến động âm, trừ transfer_out) hoặc ngày nhập
  if (lotBalances.length) {
    const lastOut = await db
      .select({ stockLotId: stockMovements.stockLotId, at: sql<string>`max(${stockMovements.occurredAt})::text` })
      .from(stockMovements)
      .where(and(inArray(stockMovements.stockLotId, lotBalances.map((b) => b.stockLotId)), lt(stockMovements.qty, 0), ne(stockMovements.type, "transfer_out")))
      .groupBy(stockMovements.stockLotId);
    const lastMap = new Map(lastOut.map((r) => [r.stockLotId, r.at ? vnToday(new Date(r.at)) : null]));
    const slow = lotBalances.filter((b) => slowMovingDays(vnToday(b.createdAt), lastMap.get(b.stockLotId) ?? null, today, cfg.slowMovingDays) !== null).length;
    if (slow) out.push({ module: "kho", level: "info", text: `${slow} lô tồn lâu trên ${cfg.slowMovingDays} ngày`, href: "/admin/kho/bao-cao", count: slow });
  }

  // Lô vật tư chờ kiểm có hàng
  const [pending] = await db
    .select({ n: sql<string>`count(distinct ${stockLots.id})::text` })
    .from(stockLots)
    .innerJoin(stockBalances, eq(stockBalances.stockLotId, stockLots.id))
    .where(and(eq(stockLots.qcStatus, "pending"), gt(stockBalances.qty, 0)));
  const pendingN = Number(pending?.n ?? 0);
  if (pendingN) out.push({ module: "kho", level: "info", text: `${pendingN} lô đang chờ kiểm`, href: "/admin/kho/lo", count: pendingN });

  // Đơn đang giữ vượt tồn khả dụng (AC-KHO-29): xét đơn chưa xuất theo thứ tự đặt
  const tracked = await db
    .select({ productId: products.id, itemId: inventoryItems.id })
    .from(products)
    .innerJoin(inventoryItems, eq(inventoryItems.productId, products.id))
    .where(eq(products.trackInventory, true));
  if (tracked.length) {
    const fg = await db
      .select({
        itemId: stockBalances.itemId,
        qty: stockBalances.qty,
        qcStatus: stockLots.qcStatus,
        productLotStatus: lots.releaseStatus,
        expiresOn: stockLots.expiresOn,
        productLotExpiresOn: lots.expiresOn,
      })
      .from(stockBalances)
      .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
      .innerJoin(stockLots, eq(stockLots.id, stockBalances.stockLotId))
      .leftJoin(lots, eq(lots.id, stockLots.productLotId))
      .where(and(inArray(stockBalances.itemId, tracked.map((t) => t.itemId)), eq(warehouses.kind, "finished"), gt(stockBalances.qty, 0)));
    const avail = new Map<string, number>();
    for (const b of fg) {
      if (isLotUsable({ qcStatus: b.qcStatus, productLotStatus: b.productLotStatus, expiresOn: b.expiresOn ?? b.productLotExpiresOn ?? null }, today)) {
        avail.set(b.itemId, (avail.get(b.itemId) ?? 0) + b.qty);
      }
    }
    const itemOf = new Map(tracked.map((t) => [t.productId, t.itemId]));
    const open = await db
      .select({ orderId: orders.id, productId: orderItems.productId, qty: orderItems.quantity, createdAt: orders.createdAt })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(inArray(orderItems.productId, tracked.map((t) => t.productId)), inArray(orders.status, ["pending", "confirmed", "packing"]), isNull(orders.stockIssuedAt)))
      .orderBy(asc(orders.createdAt), asc(orders.id));
    const used = new Map<string, number>();
    const short = new Set<string>();
    for (const o of open) {
      const itemId = itemOf.get(o.productId)!;
      const next = (used.get(itemId) ?? 0) + o.qty;
      used.set(itemId, next);
      if (next > (avail.get(itemId) ?? 0)) short.add(o.orderId);
    }
    if (short.size) out.push({ module: "kho", level: "danger", text: `${short.size} đơn đang giữ vượt tồn khả dụng`, href: "/admin/ban-hang/dong-goi", count: short.size });
  }

  // Phiếu xuất chờ duyệt: chỉ người duyệt được
  if (can(role, "inventory.approve")) {
    const [w] = await db.select({ n: sql<string>`count(*)::text` }).from(stockIssues).where(eq(stockIssues.status, "pending_approval"));
    const n = Number(w?.n ?? 0);
    if (n) out.push({ module: "kho", level: "info", text: `${n} phiếu xuất chờ duyệt`, href: "/admin/kho/xuat", count: n });
  }
  return out;
}
