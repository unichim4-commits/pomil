import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { docSequences } from "@/db/schema";
import { vnYearMonth } from "@/modules/orders/rules";
import { docSequenceKey, formatDocCode, isMonthlyPrefix, type DocPrefix } from "./rules";

// Mã chứng từ kế tiếp (R-CHUNG-7). Một câu INSERT … ON CONFLICT DO UPDATE … RETURNING nên hai giao dịch
// tạo cùng lúc không trùng số: giao dịch sau chờ khóa dòng rồi cộng tiếp. Chạy trong giao dịch của người gọi.
export async function nextDocCode(tx: Tx, prefix: DocPrefix, at: Date = new Date()): Promise<string> {
  const key = docSequenceKey(prefix, at);
  const [row] = await tx
    .insert(docSequences)
    .values({ key, lastValue: 1 })
    .onConflictDoUpdate({
      target: docSequences.key,
      set: { lastValue: sql`${docSequences.lastValue} + 1`, updatedAt: new Date() },
    })
    .returning({ lastValue: docSequences.lastValue });
  if (!row) throw new Error(`Không lấy được số thứ tự cho ${key}`);
  return formatDocCode(prefix, isMonthlyPrefix(prefix) ? vnYearMonth(at) : null, row.lastValue);
}
