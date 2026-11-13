"use client";

// Nút in phiếu: dùng hộp in của trình duyệt, phần thao tác ẩn khi in (print:hidden).
export function PrintButton({ label = "In phiếu" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-outline print:hidden">
      {label}
    </button>
  );
}
