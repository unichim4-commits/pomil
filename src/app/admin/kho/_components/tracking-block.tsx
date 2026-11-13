import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { can, type StaffRole } from "@/modules/auth/rules";
import { previewInventoryTracking } from "@/modules/inventory/ledger";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card } from "../../_components/ui";
import { toggleTrackingAction } from "../actions";

// Khối "Quản lý tồn theo kho" cho hàng thành phẩm (R-KHO-25, AC-KHO-27). Dùng ở trang sản phẩm và trang hàng hóa.
export async function InventoryTrackingBlock({ productId, tracked, role, itemId }: { productId: string; tracked: boolean; role: StaffRole; itemId?: string | null }) {
  const db = await getDb();
  const p = await previewInventoryTracking(db, productId);
  // Trang sản phẩm không truyền itemId: tự tìm hàng thành phẩm gắn với sản phẩm để dẫn sang Kho
  if (itemId === undefined) {
    const [it] = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.productId, productId));
    itemId = it?.id ?? null;
  }
  const canApprove = can(role, "inventory.approve");
  const preview = `Số bán được trên web: ${p.before} → ${p.after} (khả dụng ${p.availableFg}, đang giữ ${p.reserved})`;
  return (
    <Card title="Quản lý tồn theo kho" actions={tracked ? <Badge tone="green">Đang bật</Badge> : <Badge>Chưa bật</Badge>}>
      {tracked ? (
        <p className="text-sm">
          Tồn quản lý ở Kho: số bán được = khả dụng ở kho thành phẩm trừ hàng đang giữ cho đơn. Nhập, xuất hoặc kiểm kê ở mục Kho.
          {itemId && (
            <>
              {" "}
              <Link href={`/admin/kho/hang-hoa/${itemId}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                Xem tồn theo lô
              </Link>
            </>
          )}
        </p>
      ) : (
        <p className="text-sm">
          Bật để số bán được trên web lấy từ kho thành phẩm theo lô đã duyệt. <span className="text-ink-soft">Xem trước: {preview}.</span>
        </p>
      )}
      {canApprove ? (
        <div className="mt-4">
          <ActionForm
            action={toggleTrackingAction}
            submitLabel={tracked ? "Tắt quản lý theo kho" : "Bật quản lý theo kho"}
            submitClassName={tracked ? "btn btn-outline" : "btn btn-primary"}
            confirm={tracked ? "Tắt quản lý theo kho? Số bán được giữ nguyên số hiện tại, sau đó chỉnh tay như cũ." : `Bật quản lý theo kho?\n${preview}`}
          >
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="on" value={tracked ? "0" : "1"} />
          </ActionForm>
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-soft">Chỉ chủ cửa hàng bật hoặc tắt được.</p>
      )}
    </Card>
  );
}
