import { getDb } from "@/db/client";
import { listPayables, listReceivables } from "@/modules/finance/debts";
import { AGING_LABEL, DEBT_STATUS_LABEL } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";
import { getErpSettings } from "@/modules/settings/service";
import { csvResponse } from "../../_csv";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payable = url.searchParams.get("the") === "phai-tra";
  const status = url.searchParams.get("trang_thai") ?? "open_all";
  return csvResponse(payable ? "phai-tra" : "phai-thu", async () => {
    const db = await getDb();
    const cfg = await getErpSettings();
    const opts = { today: vnToday(), dueSoonDays: cfg.debtDueSoonDays };
    const all = payable ? await listPayables(db, opts) : await listReceivables(db, opts);
    const rows = status === "all" ? all : status === "open_all" ? all.filter((r) => r.status === "open" || r.status === "partial") : all.filter((r) => r.status === status);
    return {
      headers: ["Mã", payable ? "Nhà cung cấp" : "Khách / đại lý", "Nguồn", "Ngày ghi", "Hạn", "Số nợ", "Đã trả", "Còn lại", "Quá hạn (ngày)", "Tuổi nợ", "Trạng thái", "Ghi chú"],
      rows: rows.map((r) => [r.code, r.partyName, r.sourceLabel, r.issuedOn, r.dueOn, r.amount, r.paidAmount, r.remaining, r.overdueDays, r.bucket ? AGING_LABEL[r.bucket] : "", DEBT_STATUS_LABEL[r.status], r.note ?? ""]),
    };
  });
}
