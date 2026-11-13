// Dữ liệu ban đầu lấy từ kế hoạch dự án, bộ nhận diện v2 và 6 bài Instagram (10/2026).
// Không import "server-only" để script `npm run db:seed` dùng lại được.
// Giá, tồn kho, thành phần là số dự kiến: sửa trong trang quản trị khi có báo giá và phiếu công bố.
//
// Hai chế độ:
// - "production" (npm run db:seed): mọi sản phẩm "sắp ra mắt" hoặc "nháp", tồn kho 0, TẮT nhận đơn,
//   không có lô mẫu. Deploy xong không ai đặt được đơn cho hàng chưa có.
// - "demo" (PGlite chạy thử trên máy): Tonic "đang bán" 265 chai, BẬT nhận đơn để thử mua, có 1 lô mẫu
//   đang cách ly. Trang tổng quan quản trị báo "Đang dùng dữ liệu mẫu".
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { seedErpMasterData } from "./seed-erp";
import { seedErpDemo } from "./seed-erp-demo";

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export type SeedMode = "production" | "demo";
export const SEED_MODE_KEY = "seed_mode";

// Sản phẩm cho bản chạy thật: chưa sản phẩm nào "đang bán", tồn kho 0.
export function productionProducts(list: (typeof schema.products.$inferInsert)[]): (typeof schema.products.$inferInsert)[] {
  return list.map((p) => ({ ...p, status: p.status === "draft" ? "draft" : "coming_soon", stock: 0 }));
}

export async function seedInitialData(db: AnyDb, mode: SeedMode): Promise<boolean> {
  const existing = await db.select({ key: schema.settings.key }).from(schema.settings).where(eq(schema.settings.key, "store"));
  if (existing.length > 0) {
    // DB đã có dữ liệu cũ: vẫn bổ sung dữ liệu nền ERP còn thiếu (chạy nhiều lần được)
    await seedErpMasterData(db);
    return false;
  }

  await db.transaction(async (tx) => {
    await tx.insert(schema.settings).values([
      {
        key: "store",
        value: {
          announcement: "Lô đầu khoảng 300 chai · Miễn phí giao cho đơn từ 450.000đ",
          shippingNote: "Giao toàn quốc trong 2–5 ngày làm việc. Mỗi chai đi kèm thẻ ghi số lô.",
          // Ghi rõ, không dựa vào mặc định: bản chạy thật tắt bán, bản chạy thử bật để thử mua
          salesOpen: mode === "demo",
        },
      },
      { key: SEED_MODE_KEY, value: { mode, seededAt: new Date().toISOString() } },
    ]);

    // dev_stage theo status như migration 0011 làm với DB cũ: đang bán → commercial
    const productRows = (mode === "production" ? productionProducts(PRODUCTS) : PRODUCTS).map((p) => ({ ...p, devStage: p.status === "active" ? ("commercial" as const) : ("developing" as const) }));
    const inserted = await tx
      .insert(schema.products)
      .values(productRows)
      .returning({ id: schema.products.id, code: schema.products.code });
    const tonicId = inserted.find((p) => p.code === "PST")?.id;

    await tx.insert(schema.contentPages).values(PAGES.map((p) => ({ ...p, publishedAt: new Date() })));

    // Lô mẫu chỉ có ở bản chạy thử (dữ liệu giả, không đưa lên bản chạy thật)
    if (tonicId && mode === "demo") {
      await tx.insert(schema.lots).values({
        lotNo: "PST-271101-01",
        productId: tonicId,
        formulaVersion: "PST-v1",
        factory: "Nhà máy gia công (điền tên khi ký hợp đồng)",
        manufacturedOn: "2027-11-01",
        expiresOn: "2029-11-01",
        unitsProduced: 300,
        publicInfo: { pomeloOrigin: "Bưởi da xanh (điền vùng trồng)", harvestSeason: "(điền mùa vụ)", note: "Lô mẫu để thử quy trình, chưa phải dữ liệu thật." },
      });
    }

    // Dữ liệu nền ERP (mọi chế độ) rồi dữ liệu chạy thử ERP (chỉ demo), sau dữ liệu demo cũ
    await seedErpMasterData(tx);
    if (mode === "demo") await seedErpDemo(tx);
  });
  return true;
}

// Giữ tên cũ cho chỗ gọi cũ: dữ liệu chạy thử
export function seedDemoData(db: AnyDb): Promise<boolean> {
  return seedInitialData(db, "demo");
}

const PRODUCTS: (typeof schema.products.$inferInsert)[] = [
  {
    code: "PST",
    slug: "pomelo-scalp-tonic",
    name: "Pomelo Scalp Tonic",
    subtitle: "Nước dưỡng da đầu vỏ bưởi",
    size: "100 ml",
    price: 229_000,
    stock: 265,
    status: "active",
    featured: true,
    sortOrder: 1,
    tone: "graphite",
    description: [
      "Nước dưỡng da đầu chiết từ vỏ bưởi Việt Nam. Một pha trong, không dầu, khô nhanh. Mỗi chai ghi rõ vùng, mùa vụ và số lô; quét mã để xem kết quả kiểm nghiệm của chính lô đó.",
      "",
      "Pomil làm một việc nhỏ: giúp da đầu thoáng, dịu và thơm sạch mùi vỏ bưởi giữa hai lần gội. Da đầu ổn thì tóc mới có nền để khỏe.",
      "",
      "## Dùng lúc nào",
      "- Buổi sáng, sau khi sấy tóc.",
      "- Buổi chiều, sau khi tháo mũ bảo hiểm.",
      "- Buổi tối của ngày không gội.",
    ].join("\n"),
    highlights: ["Một pha trong, không lớp dầu", "Vòi xịt đưa sát da đầu", "Tinh dầu vỏ bưởi chưng cất, nồng độ thấp", "Số lô và mã QR trên từng chai"],
    ingredients: [
      { name: "Aqua", purpose: "Nền nước, nhẹ, không để lại lớp dầu trên da đầu." },
      { name: "Citrus Grandis Peel Oil", purpose: "Tinh dầu vỏ bưởi chưng cất, dùng ở nồng độ thấp để tạo mùi vỏ bưởi đặc trưng." },
      { name: "Panthenol", purpose: "Giữ ẩm và làm dịu cảm giác khô căng trên da đầu." },
      { name: "Niacinamide", purpose: "Hỗ trợ da đầu cân bằng dầu, bớt bết giữa hai lần gội." },
      { name: "Zinc PCA", purpose: "Hỗ trợ kiểm soát dầu, giữ da đầu thoáng hơn." },
      { name: "Bisabolol", purpose: "Làm dịu cảm giác ngứa, nóng sau một ngày đội mũ." },
    ],
    howToUse:
      "Rẽ ngôi, xịt sát da đầu 6–8 lần, mát xa nhẹ bằng đầu ngón tay. Không cần xả lại. Tránh vùng mắt. Ngưng dùng nếu da đầu đỏ, rát và báo cho Pomil tại trang Phản ánh.",
    notDo: ["Không làm mọc tóc.", "Không trị rụng tóc.", "Không thay được dầu gội.", "Không dùng ảnh trước và sau để quảng cáo."],
    seoDescription: "Nước dưỡng da đầu từ vỏ bưởi Việt Nam, một pha trong, không dầu, minh bạch từng lô. 100 ml.",
  },
  {
    code: "PSTM",
    slug: "scalp-tonic-mini",
    name: "Scalp Tonic mini",
    subtitle: "Bản dùng thử 30 ml",
    size: "30 ml",
    price: 69_000,
    stock: 0,
    status: "coming_soon",
    sortOrder: 2,
    tone: "rind",
    description:
      "Cùng công thức Pomelo Scalp Tonic, chai 30 ml để thử trước hoặc mang theo khi đi làm. Chỉ có khi nhà máy chiết cùng lô với chai 100 ml.",
    highlights: ["Cùng công thức, cùng số lô với chai 100 ml", "Gọn trong túi, cốp xe"],
    howToUse: "Rẽ ngôi, xịt sát da đầu 6–8 lần, mát xa nhẹ.",
    notDo: ["Không làm mọc tóc.", "Không trị rụng tóc."],
  },
  {
    code: "PSH",
    slug: "dau-goi-da-dau-vo-buoi",
    name: "Dầu gội da đầu vỏ bưởi",
    subtitle: "Gội dịu mỗi ngày cho da đầu dầu",
    size: "300 ml",
    price: 219_000,
    stock: 0,
    status: "coming_soon",
    sortOrder: 3,
    tone: "bone",
    description:
      "Dành cho da đầu nhanh dầu cần gội mỗi ngày mà không khô căng. Hệ làm sạch dịu không SLS, pH 5–5,5, cùng họ mùi vỏ bưởi với Scalp Tonic. Pomil chỉ làm dầu gội khi khách dùng tonic thật sự cần, nên sản phẩm này đang ở giai đoạn hỏi ý kiến.",
    highlights: ["Hệ làm sạch dịu, không SLS", "pH 5–5,5", "Cùng họ mùi với Scalp Tonic"],
    notDo: ["Không làm mọc tóc.", "Không trị gàu."],
  },
  {
    code: "PSS",
    slug: "serum-da-dau",
    name: "Serum da đầu",
    subtitle: "Đậm đặc, nhỏ giọt",
    size: "50 ml",
    price: 329_000,
    status: "draft",
    sortOrder: 4,
    tone: "graphite",
    description: "Gốc nước, liệu trình 8 tuần, ít hoặc không tinh dầu. Chỉ phát triển khi từ 20% khách dùng tonic hỏi sản phẩm tập trung hơn.",
  },
  {
    code: "PCD",
    slug: "dau-xa-toc-manh",
    name: "Dầu xả nhẹ cho tóc mảnh",
    subtitle: "Mềm tóc, không nặng chân tóc",
    size: "250 ml",
    price: 199_000,
    status: "draft",
    sortOrder: 5,
    tone: "bone",
    description: "Bán chủ yếu trong combo với dầu gội. Chỉ làm khi dầu gội đạt 300 chai mỗi tháng.",
  },
];

const PAGES: (typeof schema.contentPages.$inferInsert)[] = [
  {
    kind: "page",
    slug: "cau-chuyen",
    title: "Câu chuyện Pomil",
    status: "published",
    excerpt: "Một chai nước dưỡng da đầu từ vỏ bưởi Việt Nam, nói thật về công dụng và minh bạch từng lô.",
    body: [
      "Bọn mình đang làm một chai nước dưỡng da đầu từ vỏ bưởi Việt Nam.",
      "",
      "Không phải để hứa tóc dày lên sau một tháng. Mục tiêu nhỏ hơn: da đầu dễ chịu hơn mỗi ngày, thoáng và thơm sạch mùi vỏ bưởi. Da đầu ổn thì tóc mới có nền để khỏe.",
      "",
      "## Vì sao là vỏ bưởi",
      "Bóc bưởi xong, phần vỏ thường vào thùng rác. Nhưng mùi thơm của quả bưởi nằm chính ở đó, trong vô số túi tinh dầu li ti trên lớp vỏ xanh. Pomil dùng tinh dầu chưng cất từ vỏ bưởi, ở nồng độ thấp, vì da đầu cũng là da.",
      "",
      "## Bốn điều Pomil không làm",
      "1. Không hứa mọc tóc, trị rụng tóc.",
      "2. Không dùng ảnh trước và sau.",
      "3. Không giảm giá thường trực; giá như nhau ở mọi kênh.",
      "4. Không giấu nguồn gốc nguyên liệu.",
      "",
      "## Minh bạch từng lô",
      "Mỗi chai có một số lô in dưới đáy và một mã QR. Quét mã, bạn xem được vỏ bưởi lấy từ đâu, thu hoạch khi nào, đóng chai ngày nào, và kết quả kiểm nghiệm vi sinh, kim loại nặng của chính lô đó. Bọn mình chỉ điền số thật khi có, không điền trước.",
      "",
      "[Tra cứu số lô](/minh-bach)",
    ].join("\n"),
  },
  {
    kind: "page",
    slug: "hoi-dap",
    title: "Hỏi đáp",
    status: "published",
    showInFooter: true,
    excerpt: "Những câu Pomil được hỏi nhiều nhất, trả lời thẳng.",
    body: [
      "## Bưởi có làm mọc tóc không?",
      "Hiện chưa có nghiên cứu đủ mạnh trên người cho thấy tinh dầu bưởi làm tóc mọc. Mỹ phẩm cũng không được quảng cáo công dụng như thuốc. Vì vậy Pomil không hứa điều đó. Điều bọn mình hướng tới: da đầu thoáng, dịu và thơm sạch giữa hai lần gội.",
      "",
      "## Dùng thế nào cho đúng?",
      "Rẽ ngôi, xịt sát da đầu 6–8 lần, mát xa nhẹ bằng đầu ngón tay, không cần xả lại. Dùng sau khi sấy tóc, sau khi tháo mũ bảo hiểm, hoặc buổi tối của ngày không gội.",
      "",
      "## Da đầu nhạy cảm có dùng được không?",
      "Tinh dầu vỏ bưởi được dùng ở nồng độ thấp, nhưng da mỗi người mỗi khác. Hãy thử một ít ở vùng sau tai trước 24 giờ. Nếu da đầu đỏ, rát thì ngưng dùng và báo cho Pomil ở trang [Phản ánh](/phan-anh).",
      "",
      "## Một chai dùng được bao lâu?",
      "Bọn mình đang đo con số thật trong đợt dùng thử 30 người, 4 tuần. Có số đo thì sẽ ghi ở đây, không ước đoán trước.",
      "",
      "## Vì sao giá cao hơn các loại xịt bưởi phổ biến?",
      "Vì Pomil trả tiền cho những thứ bạn kiểm tra được: kiểm nghiệm từng lô, tinh dầu chưng cất có phiếu phân tích, và một công thức một pha không dầu. Giá như nhau ở mọi kênh, không có giảm giá thường trực.",
      "",
      "## Số lô ở đâu trên chai?",
      "In phun dưới đáy chai, dạng PST-YYMMDD-NN, cùng một mã QR. Nhập số lô ở trang [Minh bạch](/minh-bach) để xem thông tin lô.",
    ].join("\n"),
  },
  {
    kind: "page",
    slug: "chinh-sach-giao-hang",
    title: "Chính sách giao hàng",
    status: "published",
    showInFooter: true,
    body: [
      "- Giao toàn quốc qua đơn vị vận chuyển, thường 2–5 ngày làm việc.",
      "- Phí giao hiển thị ở bước thanh toán trước khi bạn đặt. Đơn đạt mức miễn phí giao sẽ tự trừ phí.",
      "- Pomil gọi hoặc nhắn Zalo xác nhận đơn trước khi gửi hàng.",
      "- Bạn được kiểm tra ngoại quan gói hàng trước khi nhận.",
    ].join("\n"),
  },
  {
    kind: "page",
    slug: "chinh-sach-doi-tra",
    title: "Đổi trả và hoàn tiền",
    status: "published",
    showInFooter: true,
    body: [
      "## Lỗi do vận chuyển hoặc sản phẩm",
      "Chai vỡ, rò, sai sản phẩm: báo trong 7 ngày kể từ khi nhận, kèm ảnh. Pomil gửi chai mới hoặc hoàn tiền, bạn không mất phí.",
      "",
      "## Da đầu không hợp",
      "Ngưng dùng ngay và báo qua trang [Phản ánh](/phan-anh). Pomil liên hệ trong 24 giờ, ghi nhận theo số lô và hoàn tiền nếu bạn bị kích ứng.",
      "",
      "*Bản nháp, cần chủ cửa hàng duyệt trước khi mở bán.*",
    ].join("\n"),
  },
  {
    kind: "page",
    slug: "chinh-sach-bao-mat",
    title: "Chính sách dữ liệu cá nhân",
    status: "published",
    showInFooter: true,
    body: [
      "Pomil chỉ thu những thông tin cần để giao hàng và chăm sóc bạn: tên, số điện thoại, địa chỉ, email nếu bạn nhập.",
      "",
      "- Dùng để xử lý đơn, giao hàng, hỗ trợ và ghi nhận phản ánh theo số lô.",
      "- Chỉ gửi tin giới thiệu khi bạn tự tích ô đồng ý. Ô này không bao giờ tích sẵn.",
      "- Bạn có thể dừng nhận tin, xem lại hoặc yêu cầu xóa dữ liệu bất cứ lúc nào qua hotline hoặc email của cửa hàng.",
      "- Pomil không bán dữ liệu của bạn cho bên khác.",
      "",
      "*Bản nháp theo Nghị định 13/2023/NĐ-CP, cần rà soát pháp lý trước khi mở bán.*",
    ].join("\n"),
  },
  {
    kind: "post",
    slug: "noi-that-so-01-buoi-co-lam-moc-toc-khong",
    title: "Nói thật số 01: bưởi có làm mọc tóc không?",
    status: "published",
    excerpt: "Câu hỏi bọn mình nghe nhiều nhất, và câu trả lời ngắn: không. Đây là điều nó làm được.",
    body: [
      "Câu hỏi bọn mình nghe nhiều nhất: bưởi có làm mọc tóc không?",
      "",
      "Trả lời thật: hiện chưa có nghiên cứu đủ mạnh trên người cho thấy tinh dầu bưởi làm tóc mọc. Mỹ phẩm cũng không được quảng cáo công dụng như thuốc. Vì vậy Pomil không hứa điều đó.",
      "",
      "Điều bọn mình hướng tới: da đầu thoáng, dịu và thơm sạch giữa hai lần gội.",
      "",
      "Bạn từng mua sản phẩm vì một lời hứa như vậy chưa? Kể bọn mình nghe qua Zalo nhé.",
    ].join("\n"),
  },
  {
    kind: "post",
    slug: "da-dau-sau-mot-ngay-doi-mu-bao-hiem",
    title: "Da đầu sau một ngày đội mũ bảo hiểm",
    status: "published",
    excerpt: "Tháo mũ ra là thấy ngay: nóng, hơi ngứa, tóc bết dù sáng mới gội.",
    body: [
      "Đi làm, đi học, kẹt xe giữa trưa. Tháo mũ bảo hiểm ra là thấy ngay: da đầu nóng, hơi ngứa, tóc bết dù sáng mới gội.",
      "",
      "Đó là lúc Pomil muốn có mặt: một chai xịt sát da đầu, khô nhanh, không để lại lớp dầu.",
      "",
      "## Ba thói quen nhỏ cho da đầu đội mũ mỗi ngày",
      "- Lót một lớp khăn mỏng hoặc mũ vải bên trong, giặt thường xuyên.",
      "- Tháo mũ ngay khi dừng xe lâu, để da đầu thoáng.",
      "- Đừng gãi mạnh khi ngứa; làm mát da đầu trước.",
    ].join("\n"),
  },
  {
    kind: "post",
    slug: "vi-sao-moi-chai-co-so-lo",
    title: "Vì sao mỗi chai Pomil có một số lô",
    status: "published",
    excerpt: "Quét mã trên chai để xem vỏ bưởi từ đâu, đóng chai ngày nào, kiểm nghiệm ra sao.",
    body: [
      "Mỗi chai Pomil có một số lô in dưới đáy và một mã QR.",
      "",
      "Quét mã, bạn xem được: vỏ bưởi lấy từ đâu, thu hoạch khi nào, đóng chai ngày nào, và kết quả kiểm nghiệm vi sinh, kim loại nặng của chính lô đó.",
      "",
      "Nếu một lô có từ 3 phản ánh trong 7 ngày, hệ thống tự giữ lô đó lại để kiểm tra trước khi bán tiếp.",
      "",
      "[Tra cứu số lô](/minh-bach)",
    ].join("\n"),
  },
];
