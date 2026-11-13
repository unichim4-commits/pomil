import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { APPLIES_TO_LABEL, STANDARD_STATUS_LABEL, standardTargets } from "@/modules/qms/admin";
import { formatLimits, PARAM_GROUP_LABEL, PARAM_KIND_LABEL, QMS_DISCLAIMER } from "@/modules/qms/rules";
import { getStandard } from "@/modules/qms/standards";
import { TEST_LABEL } from "@/modules/quality/admin";
import { ActionForm } from "../../../_components/action-form";
import { Badge, Card, Table } from "../../../_components/ui";
import { standardStatusAction, updateStandardAction } from "../../actions";
import { StandardForm } from "../standard-form";

export const metadata: Metadata = { title: "Tiêu chuẩn" };

const TONE = { draft: "amber", active: "green", archived: "neutral" } as const;

export default async function StandardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, data] = await Promise.all([requireStaff(), getStandard(id)]);
  if (!data) notFound();
  const { standard: s, params: rows, versions, item, product } = data;
  const canWrite = can(staff.role, "quality.write");
  const canApprove = can(staff.role, "quality.approve");
  const targets = canWrite && s.status === "draft" ? await standardTargets() : null;

  return (
    <>
      <Link href="/admin/chat-luong/tieu-chuan" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-graphite">
        ← Tiêu chuẩn
      </Link>
      <div className="mb-6 mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl">
          {s.code} v{s.version}
        </h1>
        <Badge tone={TONE[s.status]}>{STANDARD_STATUS_LABEL[s.status]}</Badge>
        <span className="text-sm text-ink-soft">
          {s.name} · {APPLIES_TO_LABEL[s.appliesTo]} · {item ? `${item.code} ${item.name}` : product ? product.name : "Dùng chung"}
        </span>
      </div>
      <p className="mb-6 border border-line bg-pith/40 p-3 text-xs text-ink-soft">{QMS_DISCLAIMER}</p>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-6">
          {targets ? (
            <Card title="Sửa bản nháp">
              <StandardForm
                action={updateStandardAction}
                submitLabel="Lưu bản nháp"
                items={targets.items}
                products={targets.products}
                values={{ id: s.id, name: s.name, appliesTo: s.appliesTo, itemId: s.itemId, productId: s.productId, effectiveFrom: s.effectiveFrom, note: s.note, params: rows }}
              />
            </Card>
          ) : (
            <Card title={`Chỉ tiêu · ${rows.length}`}>
              {rows.length === 0 ? (
                <p className="text-sm text-ink-soft">Chưa có chỉ tiêu.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>Chỉ tiêu</th>
                      <th>Nhóm</th>
                      <th>Kiểu</th>
                      <th>Giới hạn</th>
                      <th>Phương pháp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.name}
                          {p.isCritical && <span className="ml-2 text-xs text-danger">trọng yếu</span>}
                          {p.lotTestType && <span className="block text-xs text-ink-soft">lấy từ phiếu {TEST_LABEL[p.lotTestType]}</span>}
                        </td>
                        <td>{PARAM_GROUP_LABEL[p.paramGroup]}</td>
                        <td>{PARAM_KIND_LABEL[p.kind]}</td>
                        <td className="tabular-nums">{p.kind === "range" ? formatLimits(p.minMilli, p.maxMilli, p.unit) : (p.expectedText ?? "—")}</td>
                        <td className="text-ink-soft">{p.method || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Thông tin">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Hiệu lực từ</dt>
                <dd>{formatDate(s.effectiveFrom)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Duyệt lúc</dt>
                <dd>{s.approvedAt ? formatDateTime(s.approvedAt) : "—"}</dd>
              </div>
            </dl>
            {s.note && <p className="mt-3 text-sm text-ink-soft">{s.note}</p>}
          </Card>
          <Card title="Thao tác">
            <div className="flex flex-wrap gap-3">
              {s.status === "draft" && canApprove && (
                <ActionForm action={standardStatusAction} submitLabel="Kích hoạt" confirm="Kích hoạt bản này? Bản đang áp dụng cùng mã sẽ chuyển lưu trữ." inline>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="op" value="activate" />
                </ActionForm>
              )}
              {s.status !== "draft" && canWrite && (
                <ActionForm action={standardStatusAction} submitLabel="Tạo phiên bản mới" submitClassName="btn btn-outline" inline>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="op" value="new_version" />
                </ActionForm>
              )}
              {s.status !== "archived" && canApprove && (
                <ActionForm action={standardStatusAction} submitLabel="Lưu trữ" submitClassName="btn btn-outline" confirm="Lưu trữ tiêu chuẩn này? Phiếu kiểm mới sẽ không dùng nữa." inline>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="op" value="archive" />
                </ActionForm>
              )}
            </div>
            {!canApprove && s.status === "draft" && <p className="mt-3 text-xs text-ink-soft">Cần người có quyền duyệt chất lượng kích hoạt.</p>}
          </Card>
          <Card title="Các phiên bản">
            <ul className="space-y-1 text-sm">
              {versions.map((v) => (
                <li key={v.id}>
                  <Link href={`/admin/chat-luong/tieu-chuan/${v.id}`} className={`inline-flex min-h-11 items-center gap-2 ${v.id === s.id ? "" : "underline underline-offset-4"}`}>
                    v{v.version} · {STANDARD_STATUS_LABEL[v.status]}
                    {v.approvedAt && <span className="text-xs text-ink-soft">{formatDate(v.approvedAt)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
