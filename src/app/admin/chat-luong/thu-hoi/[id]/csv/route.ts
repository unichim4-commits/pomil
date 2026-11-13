import { getDb } from "@/db/client";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { getRecallDetail } from "@/modules/qms/admin";
import { RECALL_CONTACT_LABEL, toCsv } from "@/modules/qms/rules";

// CSV danh sách liên hệ thu hồi. Số điện thoại theo quyền customers.view_phone.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const db = await getDb();
  const detail = await getRecallDetail(id, can(staff.role, "customers.view_phone"), db);
  if (!detail) return new Response("Không tìm thấy hồ sơ", { status: 404 });
  const rows: (string | number | null)[][] = [["Đơn", "Khách", "Điện thoại", "Đại lý", "Sản phẩm", "Lô", "Số chai", "Kết quả liên hệ", "Ghi chú"]];
  for (const c of detail.contacts) {
    const items = c.items.length ? c.items : [{ productName: "", lotNo: "", qty: 0 }];
    for (const i of items) rows.push([c.orderCode, c.name, c.phone, c.dealer, i.productName, i.lotNo, i.qty, RECALL_CONTACT_LABEL[c.status], c.note ?? ""]);
  }
  const safe = detail.recall.code.replace(/[^A-Za-z0-9-]/g, "");
  return new Response(toCsv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="thu-hoi-${safe}.csv"`, "Cache-Control": "no-store" },
  });
}
