import Link from "next/link";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="enter mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-light tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "", actions }: { title?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={`border border-line bg-paper ${className}`} data-reveal>
      {title && (
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="eyebrow text-[0.68rem]">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="eyebrow text-[0.65rem] text-ink-soft">{label}</p>
      <p className="mt-2 text-3xl font-light tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="lift block border border-line bg-paper p-5 hover:border-graphite" data-reveal>
      {body}
    </Link>
  ) : (
    <div className="border border-line bg-paper p-5" data-reveal>{body}</div>
  );
}

const TONE = {
  neutral: "bg-pith text-graphite",
  dark: "bg-graphite text-bone",
  green: "bg-rind/15 text-[#3f4a33]",
  amber: "bg-[#f1e2c4] text-[#6b4e12]",
  red: "bg-danger/10 text-danger",
} as const;

export type BadgeTone = keyof typeof TONE;

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: BadgeTone }) {
  return <span className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

export const ORDER_TONE: Record<string, BadgeTone> = {
  pending: "amber",
  confirmed: "neutral",
  packing: "neutral",
  shipping: "dark",
  delivered: "green",
  cancelled: "red",
  returned: "red",
};

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="rows-in overflow-x-auto border border-line bg-paper">
      <table className="w-full min-w-[640px] text-left text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-medium [&_th]:text-ink-soft">
        {children}
      </table>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-line px-6 py-12 text-center text-sm text-ink-soft">{children}</div>;
}

export function Pagination({ page, total, pageSize, hrefFor }: { page: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Phân trang">
      <span className="text-ink-soft">
        Trang {page}/{pages} · {total} mục
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={hrefFor(page - 1)} className="border border-line px-3 py-1.5 hover:border-graphite">
            ← Trước
          </Link>
        )}
        {page < pages && (
          <Link href={hrefFor(page + 1)} className="border border-line px-3 py-1.5 hover:border-graphite">
            Sau →
          </Link>
        )}
      </div>
    </nav>
  );
}

export function FilterTabs({ items, active }: { items: { href: string; label: string; count?: number; key: string }[]; active: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm ${item.key === active ? "border-graphite text-graphite" : "border-transparent text-ink-soft hover:text-graphite"}`}
        >
          {item.label}
          {item.count !== undefined && <span className="ml-1.5 text-xs text-ink-soft">{item.count}</span>}
        </Link>
      ))}
    </div>
  );
}
