import { getDb } from "@/db/client";
import { listMovements } from "@/modules/inventory/admin";
import { formatQty, type DisplayUom } from "@/modules/inventory/rules";
import { kmCsv } from "../../_lib/csv";
import { MOVE_TYPE_LABEL } from "../../_lib/labels";
import { parseLedgerQuery } from "../filter";

// Tải sổ kho theo bộ lọc đang xem (tối đa 5.000 dòng)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const f = parseLedgerQuery(Object.fromEntries(url.searchParams));
  return kmCsv("so-kho", async () => {
    const db = await getDb();
    const rows = await listMovements(db, f, 5000);
    return {
      headers: ["Thời điểm", "Loại", "Chứng từ", "Mã hàng", "Tên hàng", "Lô", "Kho", "Vị trí", "Số lượng", "Số dư sau", "Đơn vị cơ sở", "Số lượng (hiển thị)", "Người ghi", "Ghi chú"],
      rows: rows.map((m) => [
        m.occurredAt.toISOString(),
        MOVE_TYPE_LABEL[m.type],
        m.docCode,
        m.itemCode,
        m.itemName,
        m.lotCode,
        m.warehouseCode,
        m.locationCode,
        m.qty,
        m.balanceAfter,
        m.baseUom,
        formatQty(m.qty, m.baseUom, m.displayUom as DisplayUom),
        m.actorName ?? "",
        m.note ?? "",
      ]),
    };
  });
}
