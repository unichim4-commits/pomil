// Danh sách chọn cho các form Sản xuất (chỉ đọc)
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventoryItems, products, suppliers } from "@/db/schema";
import type { StaffRole } from "@/modules/auth/rules";
import type { Actor } from "@/modules/production/access";

export function actorOf(staff: { id: string; role: StaffRole }): Actor {
  return { id: staff.id, role: staff.role };
}

export async function productOptions(db: Db) {
  return db.select({ id: products.id, code: products.code, name: products.name, netQty: products.netQty, netUom: products.netUom }).from(products).orderBy(asc(products.sortOrder), asc(products.code));
}

export async function supplierOptions(db: Db, kinds: ("factory" | "service" | "farm" | "material" | "packaging" | "other")[]) {
  return db
    .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, kind: suppliers.kind })
    .from(suppliers)
    .where(and(eq(suppliers.isActive, true), inArray(suppliers.kind, kinds)))
    .orderBy(asc(suppliers.code));
}

export async function itemOptions(db: Db, kinds: ("raw_material" | "extract" | "packaging" | "wip" | "other")[]) {
  return db
    .select({ id: inventoryItems.id, code: inventoryItems.code, name: inventoryItems.name, kind: inventoryItems.kind, baseUom: inventoryItems.baseUom, displayUom: inventoryItems.displayUom })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.isActive, true), inArray(inventoryItems.kind, kinds)))
    .orderBy(asc(inventoryItems.code));
}
