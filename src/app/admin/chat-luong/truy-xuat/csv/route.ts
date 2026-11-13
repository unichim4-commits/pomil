import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { toCsv } from "@/modules/qms/rules";
import { resolveTraceCode, traceBackward, traceForward, type TraceNode } from "@/modules/qms/trace";

// CSV truy xuất: cây ngược, cây xuôi (mỗi nút một dòng có cấp) và danh sách đơn. Số điện thoại theo quyền xem.
export async function GET(request: Request) {
  const staff = await requireStaff();
  const code = (new URL(request.url).searchParams.get("ma") ?? "").trim().slice(0, 60);
  const db = await getDb();
  const ref = code ? await resolveTraceCode(db, code) : null;
  if (!ref) return new Response("Không tìm thấy lô", { status: 404 });
  const showPhone = can(staff.role, "customers.view_phone");
  const [back, fwd] = await Promise.all([ref.kind === "lot" ? traceBackward(db, ref.id) : Promise.resolve(null), traceForward(db, ref, showPhone)]);
  const rows: (string | number | null)[][] = [["Chiều", "Cấp", "Mã", "Nội dung", "Số lượng", "Ghi chú"]];
  const walk = (dir: string, n: TraceNode, level: number) => {
    rows.push([dir, level, n.code, n.title, n.qty ?? "", n.meta.join("; ")]);
    for (const c of n.children) walk(dir, c, level + 1);
  };
  if (back) walk("Ngược", back, 0);
  if (fwd.tree) walk("Xuôi", fwd.tree, 0);
  rows.push([]);
  rows.push(["Lô", "Đơn", "Trạng thái", "Khách", "Điện thoại", "Đại lý", "Số chai"]);
  for (const o of fwd.orders) rows.push([o.lotNo, o.orderCode, o.status, o.customerName, o.phone, o.dealer, o.qty]);
  const safe = code.replace(/[^A-Za-z0-9-]/g, "");
  return new Response(toCsv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="truy-xuat-${safe}.csv"`, "Cache-Control": "no-store" },
  });
}
