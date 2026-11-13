import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/modules/auth/service";
import { standardTargets } from "@/modules/qms/admin";
import { QMS_DISCLAIMER } from "@/modules/qms/rules";
import { Card, PageHeader } from "../../../_components/ui";
import { createStandardAction } from "../../actions";
import { StandardForm } from "../standard-form";

export const metadata: Metadata = { title: "Tạo tiêu chuẩn" };

export default async function NewStandardPage() {
  await requirePermission("quality.write");
  const { items, products } = await standardTargets();
  return (
    <>
      <Link href="/admin/chat-luong/tieu-chuan" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Tiêu chuẩn
      </Link>
      <PageHeader title="Tạo tiêu chuẩn" description="Lưu thành bản nháp v1. Người có quyền duyệt chất lượng kích hoạt để áp dụng cho phiếu kiểm mới." />
      <p className="mb-6 border border-line bg-pith/40 p-3 text-xs text-ink-soft">{QMS_DISCLAIMER}</p>
      <Card>
        <StandardForm
          action={createStandardAction}
          submitLabel="Lưu bản nháp"
          items={items}
          products={products}
          values={{ name: "", appliesTo: "raw_material", itemId: null, productId: null, effectiveFrom: null, note: null, params: [] }}
        />
      </Card>
    </>
  );
}
