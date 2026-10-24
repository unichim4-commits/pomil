import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { listAllProducts } from "@/modules/catalog/service";
import { listLots, LOT_STATUS_LABEL } from "@/modules/quality/admin";
import { ActionForm } from "../_components/action-form";
import { Badge, Card, Empty, PageHeader, Table } from "../_components/ui";
import { createLotAction } from "./actions";

export const metadata: Metadata = { title: "Lô và kiểm nghiệm" };

const TONE = { quarantine: "amber", released: "green", on_hold: "red", recalled: "red" } as const;

export default async function LotsPage() {
  const [staff, lots, products] = await Promise.all([requireStaff(), listLots(), listAllProducts()]);
  const canWrite = can(staff.role, "lots.write");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Lô và kiểm nghiệm" description="Lô mới ở trạng thái cách ly. Chỉ duyệt xuất kho khi vi sinh và kim loại nặng đạt, phiếu công bố còn hạn. 3 phản ánh trong 7 ngày thì lô tự giữ lại." />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div>
          {lots.length === 0 ? (
            <Empty>Chưa có lô nào.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Số lô</th>
                  <th>Sản phẩm</th>
                  <th>Sản xuất</th>
                  <th>Đã bán / SX</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.id} className="hover:bg-bone">
                    <td>
                      <Link href={`/admin/lo/${l.id}`} className="font-mono hover:underline">
                        {l.lotNo}
                      </Link>
                      {l.isPublic && <span className="ml-2 text-xs text-rind">công khai</span>}
                      {!l.isPublic && l.releaseStatus === "released" && (
                        <span className="ml-2 whitespace-nowrap text-xs text-[#6b4e12]" title="Khách quét mã sẽ không xem được trang lô">
                          chưa công khai
                        </span>
                      )}
                    </td>
                    <td>{l.productName}</td>
                    <td className="text-ink-soft">{formatDate(l.manufacturedOn)}</td>
                    <td className="tabular-nums">
                      {l.sold} / {l.unitsProduced}
                    </td>
                    <td>
                      <Badge tone={TONE[l.releaseStatus]}>{LOT_STATUS_LABEL[l.releaseStatus]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        {canWrite && (
          <Card title="Tạo lô mới">
            <ActionForm action={createLotAction} submitLabel="Tạo lô">
              <label className="block">
                <span className="field-label">Sản phẩm</span>
                <select name="productId" required className="field">
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Ngày sản xuất</span>
                  <input type="date" name="manufacturedOn" defaultValue={today} required className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Mẻ trong ngày</span>
                  <input type="number" name="batch" min={1} max={99} defaultValue={1} required className="field" />
                </label>
              </div>
              <label className="block">
                <span className="field-label">Hạn dùng</span>
                <input type="date" name="expiresOn" required className="field" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Công thức</span>
                  <input name="formulaVersion" defaultValue="PST-v1" required className="field font-mono" />
                </label>
                <label className="block">
                  <span className="field-label">Số chai</span>
                  <input type="number" name="unitsProduced" min={1} defaultValue={300} required className="field" />
                </label>
              </div>
              <label className="block">
                <span className="field-label">Nhà máy</span>
                <input name="factory" className="field" />
              </label>
              <p className="text-xs text-ink-soft">Số lô tự tạo theo dạng MÃ-YYMMDD-NN, ví dụ PST-271101-01.</p>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
