import type { Metadata } from "next";
import Link from "next/link";
import { Mark } from "@/components/brand";
import { formatDate } from "@/lib/format";
import { parseLotNo } from "@/lib/lot-no";
import { LOT_COPY, LOT_FORMAT_HINT } from "@/modules/quality/copy";
import { classifyLotLookup } from "@/modules/quality/rules";
import { getPublicLot } from "@/modules/quality/service";

const TEST_LABEL: Record<string, string> = {
  microbial: "Vi sinh vật",
  heavy_metals: "Kim loại nặng",
  stability: "Độ ổn định",
  gc_ms: "Thành phần tinh dầu (GC-MS)",
  irritation: "Thử kích ứng da",
  sensory: "Cảm quan",
};

const RESULT_LABEL: Record<string, string> = { pass: "Đạt", fail: "Không đạt", pending: "Đang chờ" };

type Props = { params: Promise<{ lotNo: string }> };

// Đường dẫn có thể chứa % sai (gõ tay, link hỏng): không để trang lỗi 500
function readLotNo(raw: string): string {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // giữ nguyên chuỗi gốc
  }
  return text.trim().toUpperCase().slice(0, 40);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lotNo = readLotNo((await params).lotNo);
  return { title: parseLotNo(lotNo) ? `Lô ${lotNo}` : "Tra số lô", robots: { index: false } };
}

export default async function LotPage({ params }: Props) {
  const lotNo = readLotNo((await params).lotNo);
  if (classifyLotLookup(!!parseLotNo(lotNo), null) === "bad_format") {
    return <LotProblem lotNo={lotNo} title={LOT_COPY.badFormatTitle} body={LOT_COPY.badFormat} />;
  }

  const found = await getPublicLot(lotNo);
  if (found.kind === "missing") return <LotProblem lotNo={lotNo} title={LOT_COPY.missingTitle} body={LOT_COPY.missingBody} />;
  if (found.kind === "pending") return <LotProblem lotNo={lotNo} title={LOT_COPY.pendingTitle} body={LOT_COPY.pendingBody} hint={LOT_COPY.pendingHint} complaintLot={lotNo} />;
  const lot = found.lot;

  const rows: [string, string | undefined][] = [
    ["Nguyên liệu", "Vỏ bưởi"],
    ["Vùng trồng", lot.info.pomeloOrigin],
    ["Mùa vụ", lot.info.harvestSeason],
    ["Đóng chai", formatDate(lot.manufacturedOn)],
    ["Hạn dùng", formatDate(lot.expiresOn)],
  ];

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between">
        <p className="eyebrow text-ink-soft">Truy xuất lô</p>
        <Mark className="h-7 w-7 text-rind" />
      </div>
      <p className="mt-8 text-sm text-ink-soft">Lô số</p>
      <h1 className="font-mono text-3xl tracking-wider sm:text-4xl">{lot.lotNo}</h1>

      {lot.status !== "released" && (
        <p className="mt-6 border border-danger/40 bg-danger/5 p-4 text-sm text-danger" role="alert">
          Lô này đang được Pomil kiểm tra lại. Nếu bạn đang dùng sản phẩm của lô này và thấy khó chịu, hãy ngừng dùng và báo cho Pomil.
        </p>
      )}

      <dl className="mt-8 divide-y divide-line border-y border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-3.5">
            <dt className="text-ink-soft">{k}</dt>
            <dd className="text-right">{v || <span className="text-ink-soft/70">Đang cập nhật</span>}</dd>
          </div>
        ))}
        {lot.tests.map((t) => (
          <div key={`${t.type}-${t.reportNo ?? ""}`} className="flex justify-between gap-4 py-3.5">
            <dt className="text-ink-soft">{TEST_LABEL[t.type] ?? t.type}</dt>
            <dd className="text-right">
              <span className={t.result === "pass" ? "text-ok" : t.result === "fail" ? "text-danger" : ""}>{RESULT_LABEL[t.result] ?? t.result}</span>
              {(t.lab || t.reportNo) && (
                <span className="block text-xs text-ink-soft">
                  {t.lab}
                  {t.reportNo ? ` · phiếu ${t.reportNo}` : ""}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {lot.info.oilMainComponents && lot.info.oilMainComponents.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow">Thành phần chính của tinh dầu</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {lot.info.oilMainComponents.map((c) => (
              <li key={c.name} className="flex justify-between">
                <span>{c.name}</span>
                <span className="font-mono">{c.percent}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lot.info.note && <p className="mt-6 text-sm text-ink-soft">{lot.info.note}</p>}

      <div className="mt-8 bg-graphite p-6 text-bone">
        <p className="eyebrow text-bone/60">Điều sản phẩm không làm</p>
        <p className="mt-3">Không làm mọc tóc. Không trị rụng tóc. Giúp da đầu dịu và thoáng.</p>
      </div>

      <Link href={`/phan-anh?lot=${encodeURIComponent(lot.lotNo)}`} className="btn btn-outline mt-6 w-full">
        Báo vấn đề với lô này
      </Link>
    </div>
  );
}

// "PST-YYMMDD-NN" không được ngắt ở dấu gạch trên màn hẹp
function KeepFormat({ text }: { text: string }) {
  const parts = text.split(LOT_FORMAT_HINT);
  return parts.map((part, i) => (
    <span key={i}>
      {part}
      {i < parts.length - 1 && <span className="whitespace-nowrap">{LOT_FORMAT_HINT}</span>}
    </span>
  ));
}

// Trang tiếng Việt cho 3 trường hợp không xem được lô: sai dạng, không có lô, lô chưa mở trang.
function LotProblem({ lotNo, title, body, hint, complaintLot }: { lotNo: string; title: string; body: string; hint?: string; complaintLot?: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between">
        <p className="eyebrow text-ink-soft">{LOT_COPY.eyebrow}</p>
        <Mark className="h-7 w-7 text-rind" />
      </div>
      {lotNo && <p className="mt-8 break-all font-mono text-lg tracking-wider text-ink-soft">{lotNo}</p>}
      <h1 className="display mt-2 text-3xl sm:text-4xl">{title}</h1>
      <p className="mt-4 leading-relaxed">
        <KeepFormat text={body} />
      </p>
      {hint && (
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          <KeepFormat text={hint} />
        </p>
      )}

      <form action="/minh-bach" className="mt-8">
        <label htmlFor="lot" className="field-label">
          {LOT_COPY.retryLabel}
        </label>
        <div className="flex gap-2">
          <input id="lot" name="lot" required defaultValue={lotNo} placeholder={LOT_FORMAT_HINT} autoCapitalize="characters" spellCheck={false} className="field font-mono uppercase" />
          <button className="btn btn-primary shrink-0">{LOT_COPY.retryButton}</button>
        </div>
      </form>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Link href={complaintLot ? `/phan-anh?lot=${encodeURIComponent(complaintLot)}` : "/phan-anh"} className="btn btn-outline">
          {LOT_COPY.complaintLink}
        </Link>
        <Link href="/" className="btn btn-outline">
          {LOT_COPY.homeLink}
        </Link>
      </div>
    </div>
  );
}
