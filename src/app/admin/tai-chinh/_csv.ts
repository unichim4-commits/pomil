import { can } from "@/modules/auth/rules";
import { readSession } from "@/modules/auth/service";
import { toCsv } from "@/modules/finance/rules";
import { vnToday } from "@/modules/numbering";

// R-TC-29: mọi báo cáo tải CSV (UTF-8 có BOM); chỉ người có finance.view
export async function csvResponse(name: string, build: () => Promise<{ headers: string[]; rows: (string | number | null | undefined)[][] }>): Promise<Response> {
  const session = await readSession();
  const me = session.ok ? session.staff : null;
  if (!me || !can(me.role, "finance.view")) return new Response("Không có quyền", { status: 403 });
  const { headers, rows } = await build();
  return new Response(toCsv(headers, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pomil-${name}-${vnToday()}.csv"`,
      "cache-control": "no-store",
    },
  });
}

export function searchObject(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams.entries());
}
