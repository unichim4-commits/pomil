"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Thanh mảnh chạy trên cùng khi bấm liên kết sang trang khác, tắt khi trang mới tới.
// Làm ở phía trình duyệt thay cho loading.tsx, vì loading.tsx làm trang "không tìm thấy" trả mã 200 thay vì 404.
export function NavProgress({ color = "bg-rind" }: { color?: string }) {
  const pathname = usePathname();
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setActive(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Chốt an toàn: nếu việc chuyển trang bị hủy thì tắt thanh sau 8 giây
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setActive(false), 8000);
    return () => window.clearTimeout(t);
  }, [active]);

  if (!active) return null;
  return (
    <div className="loading-in pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-pith" role="progressbar" aria-label="Đang chuyển trang">
      <div className={`load-bar h-full w-2/5 ${color}`} />
    </div>
  );
}
