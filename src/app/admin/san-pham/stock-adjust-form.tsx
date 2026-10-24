import { ActionForm } from "../_components/action-form";
import { adjustStockAction } from "./actions";

// Chọn chiều bằng 2 nút radio thay vì gõ dấu trừ: bàn phím số của iPhone không có phím "−".
function DirectionChoice({ productName, compact }: { productName: string; compact: boolean }) {
  const option = (value: "in" | "out", label: string) => (
    <label
      className={`flex min-h-11 cursor-pointer items-center justify-center whitespace-nowrap border border-line bg-paper px-3 text-sm has-[:checked]:border-graphite has-[:checked]:bg-graphite has-[:checked]:text-bone has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-graphite ${compact ? "" : "flex-1"}`}
    >
      <input type="radio" name="direction" value={value} required className="sr-only" />
      {label}
    </label>
  );
  return (
    <fieldset aria-label={compact ? `Loại điều chỉnh cho ${productName}` : undefined}>
      {!compact && <legend className="field-label">Loại điều chỉnh</legend>}
      <div className={compact ? "flex gap-1" : "flex max-w-sm gap-2"}>
        {option("in", "Nhập thêm")}
        {option("out", "Bớt đi")}
      </div>
    </fieldset>
  );
}

// Điều chỉnh tồn kho bằng nhập thêm/bớt đi kèm lý do. Không có ô "tồn kho = N" để tránh ghi đè số đã bán.
export function StockAdjustForm({ productId, productName, stock, compact = false }: { productId: string; productName: string; stock: number; compact?: boolean }) {
  if (compact) {
    return (
      <ActionForm
        action={adjustStockAction}
        submitLabel="Điều chỉnh"
        pendingLabel="Đang lưu…"
        className="flex flex-wrap items-center gap-2"
        submitClassName="btn btn-outline whitespace-nowrap px-3 text-sm"
        inline
        resetOnSuccess
        noValidate
      >
        <input type="hidden" name="id" value={productId} />
        <span className="w-16 whitespace-nowrap tabular-nums" title="Tồn hiện tại">
          {stock} chai
        </span>
        <DirectionChoice productName={productName} compact />
        <input name="amount" inputMode="numeric" pattern="[0-9]*" required placeholder="Số chai" aria-label={`Số chai điều chỉnh cho ${productName}`} className="field w-20 text-sm tabular-nums" />
        <input name="reason" required maxLength={200} placeholder="Lý do" aria-label={`Lý do điều chỉnh ${productName}`} className="field w-32 text-sm" />
      </ActionForm>
    );
  }
  return (
    <ActionForm action={adjustStockAction} submitLabel="Điều chỉnh tồn kho" className="space-y-4" resetOnSuccess noValidate>
      <input type="hidden" name="id" value={productId} />
      <p className="text-sm">
        Tồn hiện tại: <span className="text-lg tabular-nums">{stock}</span> chai
      </p>
      <DirectionChoice productName={productName} compact={false} />
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <label className="block">
          <span className="field-label">Số chai</span>
          <input name="amount" inputMode="numeric" pattern="[0-9]*" required placeholder="50" className="field tabular-nums" />
        </label>
        <label className="block">
          <span className="field-label">Lý do</span>
          <input name="reason" required maxLength={200} placeholder="Nhập lô PST-… / Vỡ 2 chai / Kiểm kho lệch" className="field" />
        </label>
      </div>
      <p className="text-xs text-ink-soft">Tồn kho tự trừ khi khách đặt và tự cộng khi hủy đơn, nên không cần sửa tay cho các đơn đó. Mỗi lần điều chỉnh ghi vào Nhật ký thao tác.</p>
    </ActionForm>
  );
}
