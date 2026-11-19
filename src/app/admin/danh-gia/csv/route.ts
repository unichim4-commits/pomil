import { displayPhone } from "@/lib/format";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import {
  ACTION_STATUS,
  AGE_RANGE,
  ASPECTS,
  CHANNEL,
  COMPARED_BEFORE,
  CONCERNS,
  HABITS,
  ISSUE_TAGS,
  pickKeys,
  REVIEW_STATUS_LABEL,
  SCALP_FEEL,
  SCALP_TYPE,
  SCENT_INTENSITY,
  USAGE_FREQUENCY,
  USED_FOR,
  WOULD_REBUY,
  type ActionStatus,
  type Aspect,
} from "@/modules/reviews/rules";
import { listReviewsForAdmin } from "@/modules/reviews/service";
import { kmCsv } from "../../kho/_lib/csv";

const lab = (map: Record<string, string>, v: string | null | undefined) => (v ? (map[v] ?? v) : "");
const labs = (map: Record<string, string>, vs: readonly string[] | null | undefined) =>
  pickKeys(map, vs ?? [])
    .map((k) => map[k])
    .join("; ");

// Tải toàn bộ góp ý theo bộ lọc đang xem (tối đa 5.000 dòng) để phân tích trong bảng tính.
// Số điện thoại chỉ hiện đủ khi nhân viên có quyền xem số.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const status = sp.get("status");
  const xl = sp.get("xl");
  const filter = {
    status: status && status in REVIEW_STATUS_LABEL ? (status as keyof typeof REVIEW_STATUS_LABEL) : undefined,
    productId: sp.get("sp") && /^[0-9a-f-]{36}$/i.test(sp.get("sp")!) ? sp.get("sp")! : undefined,
    actionStatus: xl && xl in ACTION_STATUS ? (xl as ActionStatus) : undefined,
  };
  return kmCsv("gop-y-san-pham", async (staff) => {
    const showPhone = can(staff.role, "customers.view_phone");
    const rows = await listReviewsForAdmin(filter, 5000);
    const aspectKeys = Object.keys(ASPECTS) as Aspect[];
    return {
      headers: [
        "Thời điểm",
        "Sản phẩm",
        "Người góp ý",
        "Điện thoại",
        "Có tài khoản",
        "Đã mua",
        "Lô (khớp)",
        "Lô khách ghi",
        "Mua ở",
        "Đã dùng",
        "Tần suất",
        "Loại da đầu",
        "Tuổi",
        "Hay gặp",
        "Thói quen",
        "Sao",
        "Da đầu sau khi dùng",
        "So với trước",
        "Mùi (1-5)",
        "Độ đậm mùi",
        ...aspectKeys.map((k) => `${ASPECTS[k]} (1-5)`),
        "Mua lại",
        "Giới thiệu (0-10)",
        "Nhận xét",
        "Góp ý",
        "Cho hiện công khai",
        "Đồng ý được hỏi thêm",
        "Hiện trên web",
        "Nhãn vấn đề",
        "Xử lý",
        "Việc đã làm",
        "Ghi chú nội bộ",
      ],
      rows: rows.map(({ review: r, productName, customerName, phoneE164, lotNo }) => {
        const phone = phoneE164 ?? r.contactPhone;
        return [
          r.createdAt.toISOString(),
          productName,
          customerName || r.guestName || "",
          phone ? (showPhone ? displayPhone(phone) : maskPhone(phone)) : "",
          r.accountId ? "Có" : "Không",
          r.verifiedPurchase ? "Có" : "Không",
          lotNo ?? "",
          r.reportedLotNo ?? "",
          lab(CHANNEL, r.channel),
          lab(USED_FOR, r.usedFor),
          lab(USAGE_FREQUENCY, r.usageFrequency),
          lab(SCALP_TYPE, r.scalpType),
          lab(AGE_RANGE, r.ageRange),
          labs(CONCERNS, r.concerns),
          labs(HABITS, r.habits),
          r.rating,
          lab(SCALP_FEEL, r.scalpFeel),
          lab(COMPARED_BEFORE, r.comparedBefore),
          r.scentRating,
          lab(SCENT_INTENSITY, r.scentIntensity),
          ...aspectKeys.map((k) => r.aspectRatings?.[k] ?? ""),
          lab(WOULD_REBUY, r.wouldRebuy),
          r.nps,
          r.comment,
          r.suggestion,
          r.publishConsent ? "Có" : "Không",
          r.followUpConsent ? "Có" : "Không",
          REVIEW_STATUS_LABEL[r.status],
          labs(ISSUE_TAGS, r.issueTags),
          lab(ACTION_STATUS, r.actionStatus),
          r.actionTaken ?? "",
          r.staffNote ?? "",
        ];
      }),
    };
  });
}
