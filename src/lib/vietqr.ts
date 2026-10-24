// Ảnh mã QR chuyển khoản theo chuẩn VietQR (dịch vụ ảnh công khai img.vietqr.io).
// Khách quét bằng app ngân hàng là điền sẵn số tài khoản, số tiền và nội dung là mã đơn.
export type BankAccount = { bankBin: string; accountNo: string; accountName: string };

export function vietQrImageUrl(account: BankAccount, amount: number, addInfo: string): string | null {
  const bin = account.bankBin.trim();
  const acc = account.accountNo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(bin) || !/^[0-9A-Za-z]{4,25}$/.test(acc)) return null;
  const params = new URLSearchParams({
    amount: String(Math.max(0, Math.round(amount))),
    addInfo: addInfo.slice(0, 50),
    accountName: account.accountName.trim(),
  });
  return `https://img.vietqr.io/image/${bin}-${acc}-compact2.png?${params.toString()}`;
}
