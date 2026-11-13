import { checkClaims } from "@/modules/content/rules";

// Câu in ra cho khách (phiếu, nhãn) phải qua checkClaims; câu vi phạm thì bỏ, không in.
export function customerSafe(text: string | null | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  return checkClaims(t).length === 0 ? t : null;
}

// Khi in chỉ giữ vùng .print-area (ẩn khung quản trị), cỡ giấy theo từng trang.
export function PrintStyle({ size }: { size: string }) {
  const css = `@media print {
  @page { size: ${size}; margin: 6mm; }
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

export function PrintButton() {
  return (
    <p className="no-print mb-4 text-sm text-ink-soft">
      Bấm Ctrl+P (hoặc Chia sẻ → In trên điện thoại) để in. Khung quản trị tự ẩn khi in.
    </p>
  );
}
