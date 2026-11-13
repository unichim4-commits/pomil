"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: NavItem[] };

// Mục đang xem = mục có đường dẫn dài nhất khớp trang hiện tại (để /admin/kho/nhap không sáng cả "Tồn kho").
function activeHref(pathname: string, groups: NavGroup[]): string | null {
  let best: string | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    const match = item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (match && (!best || item.href.length > best.length)) best = item.href;
  }
  return best;
}

export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const current = activeHref(pathname, groups);
  const currentGroup = groups.find((g) => g.items.some((i) => i.href === current))?.label ?? groups[0]?.label ?? "";
  const currentLabel = groups.flatMap((g) => g.items).find((i) => i.href === current)?.label ?? "Menu";

  // Mặc định chỉ mở nhóm chứa trang đang xem; người dùng tự mở thêm nhóm khác
  const [open, setOpen] = useState<Set<string>>(() => new Set([currentGroup]));
  // Điện thoại: cả menu gói sau một nút, đóng lại khi chuyển trang
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    setOpen((prev) => (prev.has(currentGroup) ? prev : new Set(prev).add(currentGroup)));
  }, [pathname, currentGroup]);

  const toggle = (label: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <nav aria-label="Quản trị">
      <div className="px-3 pb-3 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-controls="admin-nav-groups"
          className="flex min-h-11 w-full items-center justify-between border border-bone/20 px-3 text-sm text-bone"
        >
          <span>
            <span className="text-bone/50">Menu · </span>
            {currentLabel}
          </span>
          <span aria-hidden>{mobileOpen ? "−" : "+"}</span>
        </button>
      </div>
      <div id="admin-nav-groups" className={`${mobileOpen ? "block" : "hidden"} space-y-1 px-3 pb-6 lg:block`}>
        {groups.map((g) => {
          const isOpen = open.has(g.label);
          const panelId = `admin-nav-${g.label.replace(/\s+/g, "-")}`;
          return (
            <div key={g.label}>
              <button
                type="button"
                onClick={() => toggle(g.label)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className="flex min-h-11 w-full items-center justify-between px-2 text-left"
              >
                <span className="eyebrow text-[0.6rem] text-bone/50">{g.label}</span>
                <span aria-hidden className="text-xs text-bone/40">
                  {isOpen ? "−" : "+"}
                </span>
              </button>
              {isOpen && (
                <ul id={panelId} className="mb-2 space-y-0.5">
                  {g.items.map((item) => {
                    const active = item.href === current;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`flex min-h-11 items-center px-2 text-sm ${active ? "bg-bone/10 text-bone" : "text-bone/70 hover:text-bone"}`}
                          aria-current={active ? "page" : undefined}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
