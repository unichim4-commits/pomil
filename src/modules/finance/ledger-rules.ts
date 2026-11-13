// Quy tắc thuần của sổ quỹ và công nợ (05-tai-chinh.md R-TC-4, R-TC-7, R-TC-11, R-TC-12). ledger.ts gọi lại.
import { formatVnd } from "@/lib/format";
import type { DebtStatus } from "./ledger";

type DebtLike = { amount: number; paidAmount: number; status: DebtStatus };

// Trạng thái theo số đã trả (R-TC-11): còn lại 0 → paid; đã trả > 0 → partial; chưa trả → open
export function debtStatusFor(amount: number, paidAmount: number): Exclude<DebtStatus, "cancelled"> {
  if (paidAmount >= amount) return "paid";
  return paidAmount > 0 ? "partial" : "open";
}

// Kiểm một lần trả (R-TC-11): 0 < số tiền ≤ còn lại. Trả null nếu hợp lệ, không thì câu lỗi.
export function validateDebtPayment(debt: DebtLike, amount: number): string | null {
  if (debt.status === "cancelled") return "Khoản nợ đã hủy";
  const remaining = debt.amount - debt.paidAmount;
  if (debt.status === "paid" || remaining <= 0) return "Khoản nợ đã trả đủ";
  if (!Number.isSafeInteger(amount) || amount <= 0) return "Số tiền phải là số nguyên lớn hơn 0";
  if (amount > remaining) return `Vượt số còn nợ ${formatVnd(remaining)}`;
  return null;
}

// Chống ghi hai lần khi đọc cũ (R-TC-11, AC-TC-9): form gửi kèm số đã trả lúc mở trang.
// Số đã trả hiện tại khác số đó → có lần thanh toán khác vừa ghi (form gửi lại, hai tab) → từ chối.
export function staleDebtPayment(expectedPaidAmount: number | null | undefined, currentPaidAmount: number): string | null {
  if (expectedPaidAmount === null || expectedPaidAmount === undefined) return null;
  if (expectedPaidAmount === currentPaidAmount) return null;
  return `Khoản nợ vừa được ghi thanh toán khác (đã trả ${formatVnd(currentPaidAmount)}). Tải lại trang để xem số còn nợ.`;
}

// Điều chỉnh số nợ (R-TC-12)
export function debtStatusAfterAdjust(debt: DebtLike, newAmount: number): { amount: number; status: DebtStatus } | { error: string } {
  if (debt.status === "cancelled") return { error: "Khoản nợ đã hủy" };
  if (!Number.isSafeInteger(newAmount) || newAmount < 0) return { error: "Số tiền phải là số nguyên không âm" };
  if (newAmount < debt.paidAmount) return { error: `Thấp hơn số đã trả ${formatVnd(debt.paidAmount)}` };
  // Về 0 khi chưa trả: hủy, giữ số cũ ở amount
  if (newAmount === 0) return { amount: debt.amount, status: "cancelled" };
  return { amount: newAmount, status: debtStatusFor(newAmount, debt.paidAmount) };
}

// R-TC-4: phiếu chi làm tiền mặt âm
export function wouldOverdraw(balance: number, amount: number): boolean {
  return balance - amount < 0;
}

// R-TC-7: phiếu hủy nhả khóa cũ
export function cancelledIdempotencyKey(key: string, id: string): string {
  return `${key}#cancelled-${id}`;
}

// Ngày chứng từ "YYYY-MM-DD" → thời điểm giữa ngày giờ VN, để mã PT/PC/CNT/CNP theo tháng của ngày đó
export function docDate(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00+07:00`);
}

// R-BH-18: số tiền phiếu thu/chi của đơn = total − đã hoàn qua đổi trả (không âm)
export function orderCashAmount(total: number, refundedViaReturns: number): number {
  return Math.max(0, total - refundedViaReturns);
}
