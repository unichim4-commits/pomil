// Hiện khi chuyển trang quản trị mất hơn 0,2 giây.
export default function AdminLoading() {
  return (
    <div className="loading-in" role="status" aria-live="polite">
      <span className="sr-only">Đang tải…</span>
      <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-pith">
        <div className="load-bar h-full w-2/5 bg-graphite" />
      </div>
      <div className="skeleton h-8 w-56" />
      <div className="skeleton mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-28" />
        ))}
      </div>
      <div className="skeleton mt-6 h-56 w-full" />
    </div>
  );
}
