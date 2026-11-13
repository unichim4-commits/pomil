import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { reportExpiry, reportSlowMoving, reportValuation, type LotReportRow } from "@/modules/inventory/admin";
import { formatQty, type DisplayUom } from "@/modules/inventory/rules";
import { vnToday } from "@/modules/numbering/rules";
import { getErpSettings } from "@/modules/settings/service";
import { kmCsv } from "../../_lib/csv";
import { ITEM_KIND_LABEL } from "../../_lib/labels";

const KINDS = ["sap-het-han", "het-han", "ton-lau", "gia-tri"] as const;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("bc") ?? "";
  const kind = (KINDS as readonly string[]).includes(raw) ? (raw as (typeof KINDS)[number]) : "sap-het-han";
  return kmCsv(`bao-cao-kho-${kind}`, async (staff) => {
    const db = await getDb();
    const erp = await getErpSettings();
    const today = vnToday();
    // Cột giá trị chỉ cho người có finance.view (R-CHUNG-14)
    const showValue = can(staff.role, "finance.view");
    if (kind === "gia-tri") {
      if (!showValue) return { headers: ["Không có quyền xem giá trị"], rows: [] };
      const v = await reportValuation(db);
      return {
        headers: ["Nhóm", "Tên", "Giá trị (đồng)"],
        rows: [["Tổng", "", v.total], ...v.byWarehouse.map((w) => ["Kho", `${w.code} · ${w.name}`, w.value]), ...v.byGroup.map((g) => ["Nhóm hàng", `${ITEM_KIND_LABEL[g.kind]}${g.group ? ` · ${g.group}` : ""}`, g.value])],
      };
    }
    let rows: LotReportRow[];
    if (kind === "ton-lau") rows = await reportSlowMoving(db, today, erp.slowMovingDays);
    else {
      const e = await reportExpiry(db, today, erp.expiryWarnDays);
      rows = kind === "het-han" ? e.expired : e.expiring;
    }
    const headers = ["Lô", "Mã hàng", "Tên hàng", "Số dư", "Đơn vị cơ sở", "Số dư (hiển thị)", "HSD", kind === "ton-lau" ? "Số ngày không xuất" : "Số ngày còn"];
    if (showValue) headers.push("Giá trị (đồng)");
    return {
      headers,
      rows: rows.map((r) => {
        const row: (string | number | null)[] = [r.lotCode, r.itemCode, r.itemName, r.qty, r.baseUom, formatQty(r.qty, r.baseUom, r.displayUom as DisplayUom), r.expiresOn, r.days];
        if (showValue) row.push(r.value);
        return row;
      }),
    };
  });
}
