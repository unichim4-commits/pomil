import Link from "next/link";
import { Empty } from "../../_components/ui";

export type Col<T> = { label: string; cell: (row: T) => React.ReactNode; className?: string; hideOnCard?: boolean };

// Bảng trên máy tính, thẻ trên điện thoại (01-kho.md: "Mọi trang chạy ở 375 px: bảng chuyển thành thẻ").
// Cột đầu là tiêu đề thẻ; các cột sau hiện dạng "nhãn: giá trị".
export function DataList<T>({ rows, cols, rowKey, empty }: { rows: T[]; cols: Col<T>[]; rowKey: (row: T) => string; empty: React.ReactNode }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  const [head, ...rest] = cols;
  return (
    <>
      <div className="rows-in hidden overflow-x-auto border border-line bg-paper md:block">
        <table className="w-full text-left text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-medium [&_th]:text-ink-soft">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.label} className={c.className}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="hover:bg-bone">
                {cols.map((c) => (
                  <td key={c.label} className={c.className}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} className="border border-line bg-paper p-4 text-sm">
            <div className="mb-2">{head!.cell(r)}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {rest
                .filter((c) => !c.hideOnCard)
                .map((c) => (
                  <div key={c.label} className="contents">
                    <dt className="text-xs text-ink-soft">{c.label}</dt>
                    <dd className="tabular-nums">{c.cell(r)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

// Liên kết vùng bấm ≥ 44 px
export function TapLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={`inline-flex min-h-11 items-center underline-offset-4 hover:underline ${className}`}>
      {children}
    </Link>
  );
}
