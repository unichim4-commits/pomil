import { NextResponse, type NextRequest } from "next/server";
import { encodeUtmCookie, parseUtm, UTM_COOKIE } from "@/lib/utm";
import { VARIANT_COOKIE } from "@/lib/variant";

const NINETY_DAYS = 60 * 60 * 24 * 90;

// Ghi UTM gần nhất và chia phiên bản trang đích A/B. Không làm xác thực ở đây:
// trang quản trị tự kiểm tra phiên trong layout.
export function proxy(request: NextRequest) {
  const utm = parseUtm(request.nextUrl.searchParams);
  const newVariant =
    request.nextUrl.pathname === "/" && !request.cookies.get(VARIANT_COOKIE) ? (Math.random() < 0.5 ? "A" : "B") : null;

  // Ghi cả vào request để trang thấy ngay ở lần tải đầu, không chỉ từ lần sau.
  if (utm) request.cookies.set(UTM_COOKIE, encodeUtmCookie(utm));
  if (newVariant) request.cookies.set(VARIANT_COOKIE, newVariant);

  const response = NextResponse.next({ request: { headers: request.headers } });
  if (utm) response.cookies.set(UTM_COOKIE, encodeUtmCookie(utm), { maxAge: NINETY_DAYS, sameSite: "lax", path: "/" });
  if (newVariant) response.cookies.set(VARIANT_COOKIE, newVariant, { maxAge: NINETY_DAYS, sameSite: "lax", path: "/" });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
