import { pgEnum } from "drizzle-orm/pg-core";

// Đơn vị cơ sở của mọi số lượng trong kho (R-CHUNG-1): mg (khối lượng), ul (micro-lít), pcs (đếm).
export const baseUom = pgEnum("base_uom", ["mg", "ul", "pcs"]);
