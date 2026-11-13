import type { CurrentStaff } from "@/modules/auth/service";
import { readSession } from "@/modules/auth/service";
import { toCsv } from "@/modules/inventory/rules";
import { vnToday } from "@/modules/numbering/rules";

// Trả file CSV cho route handler của Kho. Chưa đăng nhập thì 401 (không chuyển hướng giữa lúc tải file).
export async function kmCsv(name: string, build: (staff: CurrentStaff) => Promise<{ headers: string[]; rows: (string | number | null | undefined)[][] }>): Promise<Response> {
  const session = await readSession();
  if (!session.ok) return new Response("Cần đăng nhập", { status: 401 });
  const { headers, rows } = await build(session.staff);
  return new Response(toCsv([headers, ...rows]), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-${vnToday()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
