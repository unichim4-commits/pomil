"use client";

import { useEffect } from "react";

// Gắn lớp "in" cho phần tử [data-reveal] khi cuộn tới. Một bộ theo dõi duy nhất cho cả trang;
// MutationObserver bắt cả nội dung hiện sau (chuyển trang, Suspense). Lớp "js" ở <html> do đoạn
// script trong layout gốc đặt trước khi vẽ, nên nếu script này không chạy thì nội dung vẫn hiện.
export function MotionRoot() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("js")) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("in");
          io.unobserve(entry.target);
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
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add("in");
      });
    }, 4000);

    return () => {
      io.disconnect();
      mo.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(safety);
    };
  }, []);

  return null;
}
