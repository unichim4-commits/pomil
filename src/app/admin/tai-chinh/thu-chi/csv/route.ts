import { getDb } from "@/db/client";
import { listCashTransactions } from "@/modules/finance/cash";
import { CASH_STATUS_LABEL, SOURCE_LABEL } from "@/modules/finance/rules";
import { csvResponse, searchObject } from "../../_csv";
import { cashFilterFrom } from "../_filter";

export async function GET(request: Request) {
  return csvResponse("thu-chi", async () => {
    const filter = { ...cashFilterFrom(searchObject(new URL(request.url))), page: 1, limit: 100000 };
    const { rows } = await listCashTransactions(await getDb(), filter);
    return {
      headers: ["Mã", "Ngày", "Loại", "Tài khoản", "Sang tài khoản", "Hạng mục", "Đối tượng", "Kênh", "Nguồn", "Chứng từ gốc", "Số tiền", "Trạng thái", "Ghi chú"],
      rows: rows.map((r) => [
        r.code,
        r.occurredOn,
        r.direction === "in" ? "Thu" : r.direction === "out" ? "Chi" : "Chuyển quỹ",
        r.accountName,
        r.toAccountName ?? "",
        r.categoryName ?? "",
        r.counterpartyName,
        r.channelCode ?? "",
        r.sourceType ? (SOURCE_LABEL[r.sourceType] ?? r.sourceType) : "Phiếu tay",
        r.sourceCode ?? "",
        r.direction === "out" ? -r.amount : r.amount,
        CASH_STATUS_LABEL[r.status],
        r.note ?? "",
      ]),
    };
  });
}
