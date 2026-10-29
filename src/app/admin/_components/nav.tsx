"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Group = { label: string; items: { href: string; label: string }[] };

export function AdminNav({ groups }: { groups: Group[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <nav aria-label="Quản trị">
      {/* Điện thoại: một hàng cuộn ngang */}
      <div className="flex gap-1 overflow-x-auto px-3 pb-3 lg:hidden">
        {groups.flatMap((g) => g.items).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`inline-flex min-h-11 items-center whitespace-nowrap px-3 text-sm ${isActive(item.href) ? "bg-bone text-graphite" : "text-bone/75"}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
      {/* Máy tính: menu dọc theo nhóm */}
      <div className="hidden space-y-6 px-3 pb-6 lg:block">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="eyebrow px-2 text-[0.6rem] text-bone/40">{g.label}</p>
            <ul className="mt-2 space-y-0.5">
              {g.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex min-h-11 items-center px-2 text-sm lg:min-h-9 ${isActive(item.href) ? "bg-bone/10 text-bone" : "text-bone/70 hover:text-bone"}`}
                    aria-current={isActive(item.href) ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
