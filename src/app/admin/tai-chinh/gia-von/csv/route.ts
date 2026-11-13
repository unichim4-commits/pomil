import { getDb } from "@/db/client";
import { listProductionCosts } from "@/modules/finance/cost";
import { csvResponse } from "../../_csv";

export async function GET() {
  return csvResponse("gia-von", async () => {
    const rows = await listProductionCosts(await getDb());
    return {
      headers: ["Lệnh", "Sản phẩm", "Lô", "Ngày xong", "NVL", "Bao bì", "Gia công", "Nhân công", "Chung (tay)", "Chung (phân bổ)", "Khác", "Tổng", "Chai đạt", "Giá/chai", "Giá/chai kế hoạch", "Chênh/chai", "Chênh so kế hoạch (bp)", "So lô trước (bp)", "Đã chốt"],
      rows: rows.map((c) => [
        c.code,
        c.productName,
        c.lotNo ?? "",
        c.finishedOn ?? "",
        c.material,
        c.packaging,
        c.outsourcing,
        c.labor,
        c.overheadManual,
        c.overheadAllocated,
        c.other,
        c.total,
        c.goodUnits,
        c.unitCost,
        c.plannedUnitCost,
        c.diffPerUnit,
        c.diffBp,
        c.vsPreviousBp,
        c.locked ? "Có" : "Không",
      ]),
    };
  });
}
