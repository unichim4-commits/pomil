"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logError } from "@/lib/log";
import { normalizeVnPhone } from "@/lib/phone";
import { VN_PROVINCES } from "@/lib/provinces";
import { decodeUtmCookie, UTM_COOKIE } from "@/lib/utm";
import { VARIANT_COOKIE } from "@/lib/variant";
import { currentCustomer } from "@/modules/accounts/service";
import { readCart, writeCart } from "@/modules/cart/service";
import { CHECKOUT_DATA_CONSENT_TEXT, CHECKOUT_MARKETING_CONSENT_TEXT } from "@/modules/consent/texts";
import { describeCartProblem } from "@/modules/orders/rules";
import { placeOrder } from "@/modules/orders/service";
import { notifyInBackground } from "@/modules/notify/service";
import { getSettings } from "@/modules/settings/service";

export type CheckoutState = { status: "idle" } | { status: "error"; message: string; fieldErrors?: Record<string, string> };

const schema = z.object({
  recipientName: z.string().trim().min(2, "Nhập họ tên người nhận").max(80),
  phone: z.string().trim().min(9, "Nhập số điện thoại"),
  email: z.union([z.literal(""), z.string().trim().email("Email chưa đúng").max(120)]).optional(),
  province: z.string({ required_error: "Chọn tỉnh/thành phố" }).refine((v) => VN_PROVINCES.includes(v), "Chọn tỉnh/thành phố"),
  ward: z.string().trim().min(2, "Nhập phường/xã").max(80),
  addressLine: z.string().trim().min(4, "Nhập số nhà, tên đường").max(200),
  customerNote: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(["cod", "bank_transfer"], { errorMap: () => ({ message: "Chọn cách thanh toán" }) }),
  dataConsent: z.literal("on", { errorMap: () => ({ message: "Cần đồng ý để Pomil giao hàng cho bạn" }) }),
  marketingConsent: z.literal("on").optional(),
  website: z.string().max(0).optional(),
});

export async function checkoutAction(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { status: "error", message: "Kiểm tra lại các ô được đánh dấu.", fieldErrors };
  }
  const data = parsed.data;
  const phoneE164 = normalizeVnPhone(data.phone);
  if (!phoneE164) return { status: "error", message: "Số điện thoại di động chưa đúng.", fieldErrors: { phone: "Số di động Việt Nam, ví dụ 0901 234 567" } };

  const settings = await getSettings();
  if (!settings.salesOpen) return { status: "error", message: "Cửa hàng đang tạm ngừng nhận đơn." };
  if ((data.paymentMethod === "cod" && !settings.codEnabled) || (data.paymentMethod === "bank_transfer" && !settings.bankTransferEnabled)) {
    return { status: "error", message: "Cách thanh toán này đang tạm tắt." };
  }

  const cookieStore = await cookies();
  const me = await currentCustomer();
  let result;
  try {
    result = await placeOrder(
      {
        lines: await readCart(),
        recipientName: data.recipientName,
        phoneE164,
        email: data.email || null,
        province: data.province,
        ward: data.ward,
        addressLine: data.addressLine,
        customerNote: data.customerNote || null,
        paymentMethod: data.paymentMethod,
        marketingConsent: data.marketingConsent === "on",
        consentTexts: { dataProcessing: CHECKOUT_DATA_CONSENT_TEXT, marketing: CHECKOUT_MARKETING_CONSENT_TEXT },
        utm: decodeUtmCookie(cookieStore.get(UTM_COOKIE)?.value),
        landingVariant: cookieStore.get(VARIANT_COOKIE)?.value ?? null,
        accountId: me?.accountId ?? null,
      },
      settings,
    );
  } catch (error) {
    logError("checkout", error);
    return { status: "error", message: "Chưa đặt được đơn, bạn thử lại sau ít phút hoặc nhắn Zalo cho Pomil nhé." };
  }

  if (!result.ok) return { status: "error", message: result.problems.map(describeCartProblem).join(" ") };

  notifyInBackground({
    kind: "order_created",
    orderId: result.orderId,
    code: result.code,
    total: result.total,
    items: result.lines.map((l) => ({ name: l.productName, quantity: l.quantity })),
    recipientName: data.recipientName,
    phoneE164,
    province: data.province,
    paymentMethod: data.paymentMethod,
    customerNote: data.customerNote || null,
  });
  await writeCart([]);
  redirect(`/don-hang/${result.code}?t=${result.accessToken}&moi=1`);
}
