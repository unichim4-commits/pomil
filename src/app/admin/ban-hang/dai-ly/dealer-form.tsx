import { formatBp } from "@/modules/sales/rules";

type DealerLike = {
  id: string;
  name: string;
  tier: string;
  contactName: string | null;
  phoneE164: string | null;
  email: string | null;
  address: string | null;
  taxCode: string | null;
  contractNo: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  priceListId: string | null;
  discountBp: number;
  commissionBp: number;
  creditLimit: number;
  paymentTermsDays: number;
  note: string | null;
};

// Ô nhập hồ sơ đại lý dùng chung cho tạo mới và sửa. Trường giá, hạn mức cần quyền sửa giá.
export function DealerFields({ dealer, priceLists, pricing }: { dealer?: DealerLike; priceLists: { id: string; code: string; name: string }[]; pricing: boolean }) {
  const d = dealer;
  const pct = (bp: number | undefined) => (bp === undefined ? "0" : formatBp(bp).replace("%", "").trim());
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {d && <input type="hidden" name="dealerId" value={d.id} />}
      <label className="block">
        <span className="field-label">Tên đại lý</span>
        <input name="name" required defaultValue={d?.name} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Cấp</span>
        <input name="tier" defaultValue={d?.tier ?? ""} placeholder="Cấp 1, cộng tác viên…" className="field" />
      </label>
      <label className="block">
        <span className="field-label">Người liên hệ</span>
        <input name="contactName" defaultValue={d?.contactName ?? ""} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Điện thoại</span>
        <input name="phone" inputMode="tel" defaultValue={d?.phoneE164 ?? ""} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Email</span>
        <input name="email" type="email" defaultValue={d?.email ?? ""} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Mã số thuế</span>
        <input name="taxCode" defaultValue={d?.taxCode ?? ""} className="field" />
      </label>
      <label className="block sm:col-span-2">
        <span className="field-label">Địa chỉ</span>
        <input name="address" defaultValue={d?.address ?? ""} className="field" />
      </label>
      <label className="block">
        <span className="field-label">Số hợp đồng</span>
        <input name="contractNo" defaultValue={d?.contractNo ?? ""} className="field" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="field-label">Từ ngày</span>
          <input name="contractStart" type="date" defaultValue={d?.contractStart ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="field-label">Đến ngày</span>
          <input name="contractEnd" type="date" defaultValue={d?.contractEnd ?? ""} className="field" />
        </label>
      </div>
      {pricing ? (
        <>
          <label className="block">
            <span className="field-label">Bảng giá riêng</span>
            <select name="priceListId" defaultValue={d?.priceListId ?? ""} className="field min-h-11">
              <option value="">Theo kênh đại lý</option>
              {priceLists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Chiết khấu thêm (%)</span>
            <input name="discount" inputMode="decimal" defaultValue={pct(d?.discountBp)} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Hoa hồng (%)</span>
            <input name="commission" inputMode="decimal" defaultValue={pct(d?.commissionBp)} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Hạn mức công nợ (đ)</span>
            <input name="creditLimit" inputMode="numeric" defaultValue={d?.creditLimit ?? 0} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Số ngày được nợ</span>
            <input name="paymentTermsDays" inputMode="numeric" defaultValue={d?.paymentTermsDays ?? 30} className="field" />
          </label>
        </>
      ) : (
        <>
          {/* Không có quyền sửa giá: gửi lại nguyên giá trị cũ */}
          <input type="hidden" name="priceListId" value={d?.priceListId ?? ""} />
          <input type="hidden" name="discount" value={pct(d?.discountBp)} />
          <input type="hidden" name="commission" value={pct(d?.commissionBp)} />
          <input type="hidden" name="creditLimit" value={d?.creditLimit ?? 0} />
          <input type="hidden" name="paymentTermsDays" value={d?.paymentTermsDays ?? 0} />
        </>
      )}
      <label className="block sm:col-span-2">
        <span className="field-label">Ghi chú</span>
        <textarea name="note" rows={2} defaultValue={d?.note ?? ""} className="field" />
      </label>
      {!pricing && <p className="text-xs text-ink-soft sm:col-span-2">Bảng giá, chiết khấu, hoa hồng và hạn mức do chủ cửa hàng đặt (quyền sửa giá).</p>}
    </div>
  );
}
