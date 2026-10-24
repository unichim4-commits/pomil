import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime } from "@/lib/format";
import { can } from "@/modules/auth/rules";
import { requireStaff } from "@/modules/auth/service";
import { lotNotPublicWarning } from "@/modules/quality/rules";
import { getLotDetail, LOT_STATUS_LABEL, SEVERITY_LABEL, TEST_LABEL, COMPLAINT_STATUS_LABEL } from "@/modules/quality/admin";
import { ActionForm } from "../../_components/action-form";
import { Badge, Card, Table } from "../../_components/ui";
import { addTestAction, holdLotAction, notificationAction, publicInfoAction, releaseLotAction, testResultAction } from "../actions";

export const metadata: Metadata = { title: "Chi tiết lô" };

const RESULT = { pass: "Đạt", fail: "Không đạt", pending: "Đang chờ" } as const;

export default async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, detail] = await Promise.all([requireStaff(), getLotDetail(id)]);
  if (!detail) notFound();
  const { lot, product, tests, notification, complaints } = detail;
  const canWrite = can(staff.role, "lots.write");
  const info = lot.publicInfo;
  const notPublicWarning = lotNotPublicWarning(lot);

  return (
    <>
      <Link href="/admin/lo" className="text-sm text-ink-soft hover:text-graphite">
        ← Lô và kiểm nghiệm
      </Link>
      <div className="mb-8 mt-3 flex flex-wrap items-center gap-4">
        <h1 className="font-mono text-2xl">{lot.lotNo}</h1>
        <Badge tone={lot.releaseStatus === "released" ? "green" : lot.releaseStatus === "quarantine" ? "amber" : "red"}>{LOT_STATUS_LABEL[lot.releaseStatus]}</Badge>
        <span className="text-sm text-ink-soft">
          {product?.name} · công thức {lot.formulaVersion} · {lot.unitsProduced} chai
        </span>
        <div className="ml-auto flex gap-3 text-sm">
          <a href={`/api/lots/${encodeURIComponent(lot.lotNo)}/qr`} target="_blank" className="underline underline-offset-4">
            Mã QR cho nhãn ↗
          </a>
          {lot.isPublic && lot.releaseStatus !== "quarantine" && (
            <Link href={`/l/${lot.lotNo}`} target="_blank" className="underline underline-offset-4">
              Trang lô ↗
            </Link>
          )}
        </div>
      </div>
      {lot.holdReason && <p className="mb-6 border border-danger/40 bg-danger/5 p-3 text-sm text-danger">Lý do giữ: {lot.holdReason}</p>}
      {notPublicWarning && (
        <p className="mb-6 bg-[#f1e2c4] p-3 text-sm text-[#6b4e12]" role="status">
          {notPublicWarning} Bật ở khung thông tin lô (ô “Bật trang lô công khai”) rồi lưu.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card title="Phiếu kiểm nghiệm">
            {tests.length === 0 ? (
              <p className="text-sm text-ink-soft">Chưa có phiếu nào. Cần ít nhất vi sinh và kim loại nặng đạt để duyệt xuất kho.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Loại</th>
                    <th>Đơn vị</th>
                    <th>Số phiếu</th>
                    <th>Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {TEST_LABEL[t.type]}
                        {!t.isPublic && <span className="block text-xs text-ink-soft">không công khai</span>}
                      </td>
                      <td className="text-ink-soft">
                        {t.lab ?? "—"}
                        {t.testedOn && <span className="block text-xs">{formatDate(t.testedOn)}</span>}
                      </td>
                      <td className="font-mono text-xs">{t.reportNo ?? "—"}</td>
                      <td>
                        {canWrite ? (
                          <ActionForm action={testResultAction} submitLabel="Lưu" pendingLabel="…" className="flex items-center gap-2" submitClassName="text-xs underline" inline>
                            <input type="hidden" name="testId" value={t.id} />
                            <input type="hidden" name="lotId" value={lot.id} />
                            <select name="result" defaultValue={t.result} className="field min-h-8 py-1 text-sm">
                              {Object.entries(RESULT).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </ActionForm>
                        ) : (
                          <Badge tone={t.result === "pass" ? "green" : t.result === "fail" ? "red" : "amber"}>{RESULT[t.result]}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {canWrite && (
              <details className="mt-5 border-t border-line pt-4">
                <summary className="cursor-pointer text-sm font-medium">Thêm phiếu kiểm nghiệm</summary>
                <ActionForm action={addTestAction} submitLabel="Thêm phiếu" className="mt-4 grid gap-3 sm:grid-cols-2" resetOnSuccess>
                  <input type="hidden" name="lotId" value={lot.id} />
                  <label className="block">
                    <span className="field-label">Loại</span>
                    <select name="type" className="field">
                      {Object.entries(TEST_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Kết quả</span>
                    <select name="result" className="field" defaultValue="pending">
                      {Object.entries(RESULT).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Đơn vị kiểm nghiệm</span>
                    <input name="lab" className="field" />
                  </label>
                  <label className="block">
                    <span className="field-label">Số phiếu</span>
                    <input name="reportNo" className="field font-mono" />
                  </label>
                  <label className="block">
                    <span className="field-label">Ngày</span>
                    <input type="date" name="testedOn" className="field" />
                  </label>
                  <label className="flex items-center gap-2 self-end pb-3 text-sm">
                    <input type="checkbox" name="isPublic" defaultChecked className="accent-graphite" /> Hiện trên trang lô
                  </label>
                </ActionForm>
              </details>
            )}
          </Card>

          <Card title="Thông tin công khai trên trang lô">
            <ActionForm action={publicInfoAction} submitLabel="Lưu thông tin công khai">
              <fieldset disabled={!canWrite} className="space-y-4">
                <input type="hidden" name="lotId" value={lot.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Vùng bưởi</span>
                    <input name="pomeloOrigin" defaultValue={info.pomeloOrigin ?? ""} className="field" placeholder="Bưởi da xanh, Bến Tre" />
                  </label>
                  <label className="block">
                    <span className="field-label">Mùa vụ thu vỏ</span>
                    <input name="harvestSeason" defaultValue={info.harvestSeason ?? ""} className="field" placeholder="09/2027" />
                  </label>
                </div>
                <label className="block">
                  <span className="field-label">Thành phần chính của tinh dầu (mỗi dòng: Tên | %)</span>
                  <textarea name="oilMainComponents" rows={3} defaultValue={(info.oilMainComponents ?? []).map((c) => `${c.name} | ${c.percent}`).join("\n")} className="field font-mono text-sm" />
                </label>
                <label className="block">
                  <span className="field-label">Ghi chú cho khách</span>
                  <textarea name="note" rows={2} defaultValue={info.note ?? ""} className="field" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isPublic" defaultChecked={lot.isPublic} className="accent-graphite" /> Bật trang lô công khai (chỉ hiện sau khi lô qua cách ly)
                </label>
              </fieldset>
            </ActionForm>
          </Card>

          {complaints.length > 0 && (
            <Card title={`Phản ánh của lô · ${complaints.length}`}>
              <ul className="space-y-3 text-sm">
                {complaints.map((c) => (
                  <li key={c.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                    <span className="text-ink-soft">{formatDateTime(c.openedAt)}</span> · {SEVERITY_LABEL[c.severity]} · {COMPLAINT_STATUS_LABEL[c.status]}
                    <p className="mt-1">{c.symptoms}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Thông tin lô">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Ngày sản xuất</dt>
                <dd>{formatDate(lot.manufacturedOn)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Hạn dùng</dt>
                <dd>{formatDate(lot.expiresOn)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Nhà máy</dt>
                <dd className="text-right">{lot.factory ?? "—"}</dd>
              </div>
              {lot.releasedAt && (
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Duyệt lúc</dt>
                  <dd>{formatDateTime(lot.releasedAt)}</dd>
                </div>
              )}
            </dl>
          </Card>

          {canWrite && lot.releaseStatus === "quarantine" && (
            <Card title="Duyệt xuất kho">
              <p className="mb-4 text-sm text-ink-soft">Hệ thống kiểm tra: vi sinh và kim loại nặng đạt, phiếu công bố còn hạn, lô chưa hết hạn.</p>
              <ActionForm action={releaseLotAction} submitLabel="Duyệt xuất kho" confirm={`Duyệt xuất kho lô ${lot.lotNo}?`}>
                <input type="hidden" name="lotId" value={lot.id} />
              </ActionForm>
            </Card>
          )}
          {canWrite && (lot.releaseStatus === "released" || lot.releaseStatus === "on_hold") && (
            <Card title={lot.releaseStatus === "released" ? "Giữ lô lại" : "Mở lại lô"}>
              <ActionForm
                action={holdLotAction}
                submitLabel={lot.releaseStatus === "released" ? "Giữ lô" : "Mở lại lô"}
                submitClassName={lot.releaseStatus === "released" ? "btn border-danger bg-danger text-bone" : "btn btn-primary"}
                confirm={lot.releaseStatus === "released" ? "Giữ lô này? Trang lô sẽ báo đang kiểm tra lại." : "Mở lại lô này?"}
              >
                <input type="hidden" name="lotId" value={lot.id} />
                <input type="hidden" name="hold" value={lot.releaseStatus === "released" ? "1" : "0"} />
                {lot.releaseStatus === "released" && <input name="reason" placeholder="Lý do (bắt buộc)" className="field" />}
              </ActionForm>
            </Card>
          )}

          <Card title="Phiếu công bố của sản phẩm">
            {notification ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Số tiếp nhận</dt>
                  <dd className="font-mono">{notification.number}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Hiệu lực đến</dt>
                  <dd>{formatDate(notification.expiresAt)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-soft">Chưa có. Không duyệt xuất kho được khi chưa có phiếu công bố còn hạn.</p>
            )}
            {canWrite && (
              <details className="mt-4 border-t border-line pt-3">
                <summary className="cursor-pointer text-sm font-medium">{notification ? "Thêm phiếu mới" : "Nhập phiếu công bố"}</summary>
                <ActionForm action={notificationAction} submitLabel="Lưu phiếu" className="mt-3 space-y-3">
                  <input type="hidden" name="productId" value={lot.productId} />
                  <input type="hidden" name="lotId" value={lot.id} />
                  <input name="number" placeholder="Số tiếp nhận" required className="field font-mono" />
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="field-label">Ngày cấp</span>
                      <input type="date" name="issuedAt" required className="field" />
                    </label>
                    <label className="block">
                      <span className="field-label">Hết hạn</span>
                      <input type="date" name="expiresAt" required className="field" />
                    </label>
                  </div>
                </ActionForm>
              </details>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
