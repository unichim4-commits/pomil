import QRCode from "qrcode";
import { lotPageUrl, parseLotNo } from "@/lib/lot-no";

// Sinh QR dạng SVG trỏ về trang lô, để đưa vào file nhãn (POM-78).
export async function GET(request: Request, { params }: { params: Promise<{ lotNo: string }> }) {
  const { lotNo: raw } = await params;
  const lotNo = decodeURIComponent(raw).toUpperCase();
  if (!parseLotNo(lotNo)) return new Response("Số lô không hợp lệ", { status: 400 });

  // Bản chạy thật phải đặt NEXT_PUBLIC_SITE_URL để QR in trên nhãn trỏ đúng tên miền
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.NODE_ENV === "production" ? null : new URL(request.url).origin);
  if (!siteUrl) return new Response("Thiếu NEXT_PUBLIC_SITE_URL", { status: 500 });

  const svg = await QRCode.toString(lotPageUrl(siteUrl, lotNo), { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `inline; filename="qr-${lotNo}.svg"`,
    },
  });
}
