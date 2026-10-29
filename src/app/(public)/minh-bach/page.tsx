import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { parseLotNo } from "@/lib/lot-no";
import { LOT_COPY } from "@/modules/quality/copy";

export const metadata: Metadata = {
  title: "Minh bạch từng lô",
  description: "Nhập số lô in dưới đáy chai Pomil để xem nguồn vỏ bưởi, ngày đóng chai và kết quả kiểm nghiệm.",
};

type Props = { searchParams: Promise<{ lot?: string }> };

export default async function TransparencyPage({ searchParams }: Props) {
  const { lot } = await searchParams;
  let error: string | null = null;
  if (lot) {
    const clean = lot.trim().toUpperCase();
    if (parseLotNo(clean)) redirect(`/l/${encodeURIComponent(clean)}`);
    error = LOT_COPY.badFormat;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="grid gap-14 md:grid-cols-2">
        <div>
          <p className="eyebrow enter text-rind">Truy xuất</p>
          <h1 className="display enter mt-4 text-5xl" style={{ ["--d" as string]: "100ms" }}>Minh bạch từng lô</h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-soft">
            Mỗi chai Pomil có một số lô in dưới đáy và một mã QR. Quét mã hoặc nhập số lô để xem vỏ bưởi lấy từ đâu, thu hoạch khi nào, đóng chai ngày nào, và kết quả kiểm nghiệm vi sinh, kim loại nặng của chính lô đó.
          </p>
          <form className="mt-10 max-w-md">
            <label className="field-label" htmlFor="lot">
              Số lô trên chai
            </label>
            <div className="flex gap-2">
              <input id="lot" name="lot" defaultValue={lot} placeholder="PST-YYMMDD-NN" required className="field font-mono uppercase" />
              <button className="btn btn-primary shrink-0">Xem lô</button>
            </div>
            {error && (
              <p className="mt-2 text-sm text-danger" role="alert">
                {error}
              </p>
            )}
          </form>
        </div>
        <div className="space-y-px bg-line" data-reveal="right">
          {[
            ["Lô chỉ hiện khi đã qua cách ly", "Trang lô chỉ mở sau khi lô có đủ phiếu kiểm nghiệm và được duyệt xuất kho."],
            ["Ô trống là ô chưa có số", "Bọn mình chỉ điền số đo thật, không điền trước, không làm tròn cho đẹp."],
            ["3 phản ánh trong 7 ngày thì giữ lô", "Hệ thống tự dừng bán lô đó để kiểm tra. Trạng thái hiện ngay trên trang lô."],
          ].map(([title, body]) => (
            <div key={title} className="bg-bone p-7">
              <h2 className="text-lg font-medium">{title}</h2>
              <p className="mt-2 text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
