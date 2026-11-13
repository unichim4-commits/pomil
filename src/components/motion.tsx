"use client";

import { useEffect } from "react";

// Gắn lớp "in" cho phần tử [data-reveal] khi cuộn tới. Một bộ theo dõi duy nhất cho cả trang;
// MutationObserver bắt cả nội dung hiện sau (chuyển trang, Suspense). Lớp "js" ở <html> do đoạn
// script trong layout gốc đặt trước khi vẽ, nên nếu script này không chạy thì nội dung vẫn hiện.
//
// Chỉ gắn lớp cho phần tử React đã hydrate xong (BUG-7). Trang stream theo từng đoạn: effect này
// chạy khi phần vỏ hydrate, còn các đoạn Suspense về sau đã có trong DOM nhưng React chưa hydrate.
// Nếu thêm lớp lúc đó thì React thấy thuộc tính lệch với HTML máy chủ, báo lỗi hydration và có thể
// vẽ lại cả nhánh phía client (mất chữ người dùng vừa gõ). React gắn khóa "__reactFiber$…" vào nút
// DOM ngay khi hydrate nút đó, nên chờ có khóa này rồi mới thêm lớp.
function isHydrated(el: Element): boolean {
  return Object.keys(el).some((key) => key.startsWith("__reactFiber$"));
}

export function MotionRoot() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("js")) return;

    // Phần tử đã tới màn hình nhưng React chưa hydrate: kiểm lại mỗi khung hình tới khi xong. Chờ quá
    // MAX_WAIT thì vẫn hiện (phòng khi không nhận ra trạng thái hydrate, ví dụ React đổi tên khóa nội bộ);
    // lúc đó trang đã hydrate xong từ lâu nên không gây lệch, và nội dung không bao giờ bị ẩn mãi.
    const MAX_WAIT = 4000;
    const pending = new Map<Element, number>();
    let pendingFrame = 0;
    const flushPending = () => {
      pendingFrame = 0;
      const now = performance.now();
      for (const [el, since] of pending) {
        if (!el.isConnected) pending.delete(el);
        else if (isHydrated(el) || now - since > MAX_WAIT) {
          el.classList.add("in");
          pending.delete(el);
        }
      }
      if (pending.size > 0) pendingFrame = requestAnimationFrame(flushPending);
    };
    const reveal = (el: Element) => {
      if (isHydrated(el)) {
        el.classList.add("in");
        return;
      }
      if (!pending.has(el)) pending.set(el, performance.now());
      if (!pendingFrame) pendingFrame = requestAnimationFrame(flushPending);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          reveal(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );

    const seen = new WeakSet<Element>();
    const scan = () => {
      document.querySelectorAll("[data-reveal]:not(.in)").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        io.observe(el);
      });
    };
    scan();

    let frame = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Chốt an toàn: nếu có gì làm bộ theo dõi không chạy thì sau 4 giây hiện hết phần đang nằm trong màn hình.
    const safety = window.setTimeout(() => {
      document.querySelectorAll("[data-reveal]:not(.in)").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) reveal(el);
      });
    }, MAX_WAIT);

    return () => {
      io.disconnect();
      mo.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pendingFrame);
      window.clearTimeout(safety);
    };
  }, []);

  return null;
}
