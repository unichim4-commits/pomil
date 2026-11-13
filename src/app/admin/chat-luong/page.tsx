import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireStaff } from "@/modules/auth/service";
import { inspectionCounts, listNcrs, listRecalls, STAGE_DESCRIPTION, STAGE_LABEL } from "@/modules/qms/admin";
import { computeQmsAlerts } from "@/modules/qms/alerts";
import { QMS_DISCLAIMER, type InspectionStageKey } from "@/modules/qms/rules";
import { vnToday } from "@/modules/numbering";
import { Card, Empty, PageHeader, Stat } from "../_components/ui";

export const metadata: Metadata = { title: "Tổng quan chất lượng" };

const LEVEL_CLASS = { danger: "border-danger/40 bg-danger/5 text-danger", warn: "border-[#e2c98f] bg-[#f1e2c4]/50 text-[#6b4e12]", info: "border-line bg-paper" } as const;

export default async function QualityOverviewPage() {
  await requireStaff();
  const db = await getDb();
  const today = vnToday();
  const [alerts, counts, openNcrs, recalls] = await Promise.all([computeQmsAlerts(db, today), inspectionCounts(db), listNcrs({}, db), listRecalls(db)]);
  const ncrOpen = openNcrs.filter((n) => n.status !== "closed" && n.status !== "cancelled").length;
  const recallOpen = recalls.filter((r) => r.status !== "closed").length;
  const order = { danger: 0, warn: 1, info: 2 } as const;
  const sorted = [...alerts].sort((a, b) => order[a.level] - order[b.level]);

  return (
    <>
      <PageHeader
        title="Tổng quan chất lượng"
        description="Phiếu kiểm đang chờ, sai lỗi, CAPA, lô đang giữ và thu hồi."
        actions={
          <Link href="/admin/chat-luong/truy-xuat" className="btn btn-primary min-h-11">
            Truy xuất lô
          </Link>
        }
      />
      <p className="mb-6 border border-line bg-pith/40 p-3 text-xs text-ink-soft">{QMS_DISCLAIMER}</p>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(Object.keys(STAGE_LABEL) as InspectionStageKey[]).map((s) => (
          <Stat key={s} label={`${STAGE_LABEL[s]} chờ`} value={String(counts[s])} hint={STAGE_DESCRIPTION[s]} href={`/admin/chat-luong/phieu-kiem?stage=${s}&status=pending`} />
        ))}
        <Stat label="NCR đang mở" value={String(ncrOpen)} href="/admin/chat-luong/ncr" />
        <Stat label="Thu hồi đang mở" value={String(recallOpen)} href="/admin/chat-luong/thu-hoi" />
      </div>
      <Card title="Cần xử lý">
        {sorted.length === 0 ? (
          <Empty>Không có việc nào cần xử lý.</Empty>
        ) : (
          <ul className="space-y-2">
            {sorted.map((a, i) => (
              <li key={`${a.href}-${i}`}>
                <Link href={a.href} className={`flex min-h-11 items-center border px-3 py-2 text-sm hover:border-graphite ${LEVEL_CLASS[a.level]}`}>
                  {a.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
