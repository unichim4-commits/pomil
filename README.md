# Pomil OS

Website bán hàng và trang quản trị của Pomil, cùng phần "xương sống" đã có: khách hàng và đồng ý, danh sách chờ, lô hàng, trang lô công khai, phản ánh kích ứng.

Thiết kế gốc: trang Notion "Thiết kế kỹ thuật Pomil OS". Giao diện theo bộ nhận diện v2 (thư mục `../nhan-dien-thuong-hieu`).

## Chạy thử trên máy (không cần cài gì thêm)

```bash
npm install
npm run dev        # http://localhost:3000
```

Không có `DATABASE_URL` thì app tự dùng **PGlite** (PostgreSQL chạy nhúng) lưu ở `.data/pglite`, tự tạo bảng và nạp dữ liệu mẫu lấy từ kế hoạch dự án (5 sản phẩm, câu chuyện, hỏi đáp, 3 chính sách nháp, 3 bài nhật ký, 1 lô mẫu đang cách ly). Dữ liệu mẫu **bật nhận đơn** và để Tonic "đang bán" 265 chai để thử mua; trang tổng quan quản trị có dòng "Đang dùng dữ liệu mẫu". Muốn thử với đúng dữ liệu bản chạy thật (tắt bán, tồn kho 0): đặt `PGLITE_SEED=production` rồi xóa `.data/` và chạy lại.

1. Mở `/dang-nhap`: lần đầu sẽ hiện form **tạo tài khoản chủ cửa hàng** (chạy thử trên máy không cần mã khởi tạo).
2. Vào `/admin/cai-dat`: điền hotline, Zalo, tài khoản ngân hàng (để hiện mã VietQR), thông tin pháp lý.
3. Vào `/admin/tai-khoan`: bật xác thực 2 lớp.

Muốn làm lại từ đầu: dừng server rồi xóa thư mục `.data/`.

## Chạy thật (Supabase hoặc PostgreSQL bất kỳ)

```bash
cp .env.example .env.local   # điền DATABASE_URL, NEXT_PUBLIC_SITE_URL, SETUP_TOKEN
npm run db:migrate           # tạo bảng
npm run db:seed              # nạp dữ liệu ban đầu (chỉ khi còn trống)
npm run build && npm start
```

Bản chạy thật bắt buộc có `DATABASE_URL`; thiếu thì app báo lỗi thay vì lặng lẽ dùng PGlite.

- **Tạo chủ cửa hàng lần đầu**: làm theo mục "Lần deploy đầu" ngay dưới. Thiếu `SETUP_TOKEN` thì `/dang-nhap` hiện 3 bước hướng dẫn và không ai tạo được chủ. Hai người gửi cùng lúc cũng chỉ tạo được một chủ.
- **Mặc định tắt bán**: `npm run db:seed` nạp mọi sản phẩm ở "sắp ra mắt" (hoặc "nháp"), tồn kho 0, **tắt nhận đơn**, không có lô mẫu. Khách chỉ để lại số giữ chỗ được. Khi có hàng: nhập tồn kho (Điều chỉnh tồn kho → Nhập thêm), chuyển sản phẩm sang "đang bán", rồi bật "Đang nhận đơn" ở `/admin/cai-dat`. Ô "Dự kiến mở bán" ở cùng trang hiện cạnh form giữ chỗ và ở đầu `/san-pham` khi đang tắt bán (ví dụ "Dự kiến mở bán tháng 11/2027"); bật nhận đơn thì tự ẩn.

## Lần deploy đầu

Tạo tài khoản chủ cửa hàng trên bản chạy thật (Vercel). Không cần cài Node hay chạy lệnh: mở `/dang-nhap` trên web thật, trang tự hiện hướng dẫn này kèm nút tạo chuỗi.

1. **Đặt mã khởi tạo.** Ở `/dang-nhap`, bấm **Tạo chuỗi ngẫu nhiên** rồi **Chép** (chuỗi 32 ký tự, tạo ngay trên trình duyệt, không gửi lên máy chủ). Mở Vercel → chọn dự án → **Settings** → **Environment Variables**: ô Key gõ `SETUP_TOKEN`, ô Value dán chuỗi, ô Environments chỉ chọn **Production**, bấm Save.
2. **Redeploy.** Mở thẻ **Deployments**, bấm nút ⋯ ở dòng trên cùng → **Redeploy**. Chờ khoảng 1–2 phút tới khi dòng đó báo Ready.
3. **Tạo chủ.** Quay lại `/dang-nhap`, tải lại trang, dán chuỗi vào ô **Mã khởi tạo**, điền tên, email, mật khẩu.

Xong thì **xóa `SETUP_TOKEN`** ở Environment Variables rồi Redeploy lần nữa. Từ đó trang chỉ còn form đăng nhập. Không gửi chuỗi này qua Zalo hay email. (Người lập trình có thể tạo chuỗi bằng `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`; tối thiểu 24 ký tự.)

## Có gì

**Cửa hàng** (`src/app/(public)`)

| Trang | Việc |
|---|---|
| `/` | Trang chủ, thử A/B 2 định vị (cookie `pomil_variant`), đăng ký nhận tin |
| `/san-pham`, `/san-pham/[slug]` | Danh sách, chi tiết: thành phần và để làm gì, cách dùng, "điều sản phẩm không làm"; sản phẩm sắp ra mắt nhận giữ chỗ |
| `/gio-hang`, `/thanh-toan` | Giỏ trong cookie, thanh toán COD hoặc chuyển khoản, địa chỉ theo 34 tỉnh thành mới |
| `/don-hang/[code]?t=…` | Khách xem đơn, mã VietQR chuyển khoản đúng số tiền và nội dung là mã đơn |
| `/tra-cuu-don` | Tra đơn bằng mã đơn và số điện thoại |
| `/minh-bach`, `/l/[lotNo]` | Tra số lô, trang lô công khai |
| `/phan-anh` | Báo kích ứng (3 phản ánh/lô/7 ngày thì lô tự giữ lại) |
| `/nhat-ky`, `/[slug]` | Bài viết và trang nội dung soạn trong quản trị |

**Quản trị** (`src/app/admin`, cần đăng nhập)

| Trang | Việc |
|---|---|
| Tổng quan | Doanh thu hôm nay, 30 ngày, biểu đồ 14 ngày, đơn cần xử lý, khách mua lại, tồn kho thấp |
| Đơn hàng | Lọc, tìm, chuyển trạng thái, thanh toán, mã vận đơn, ghi chú nội bộ, gán số lô cho từng dòng hàng |
| Khách hàng | Gộp theo số điện thoại, giai đoạn (chờ → mua lần đầu → mua lại), lịch sử đồng ý, rút đồng ý |
| Sản phẩm | Giá, ảnh, thành phần, nội dung, SEO; **điều chỉnh tồn kho** bằng "Nhập thêm"/"Bớt đi" kèm lý do (trên điện thoại: danh sách dạng thẻ, bấm "Điều chỉnh") |
| Nội dung | Trang và bài nhật ký (markdown rút gọn), ảnh bìa |
| Lô và kiểm nghiệm | Tạo lô, phiếu kiểm nghiệm, phiếu công bố, duyệt xuất kho, giữ lô, thông tin trang lô, QR cho nhãn |
| Phản ánh | Hàng chờ, cảnh báo quá 24 giờ, nguyên nhân và cách xử lý |
| Cài đặt | Thông tin cửa hàng, phí giao, miễn phí giao từ, tắt/bật nhận đơn (mặc định tắt), dòng "dự kiến mở bán", ngân hàng |
| Thông báo | Báo chủ cửa hàng khi có đơn mới và phản ánh qua email (Resend) và Zalo OA; gửi thử, lịch sử gửi, gửi lại, tìm user_id Zalo |
| Nhân viên | Chủ cửa hàng / Cộng tác viên / Chỉ xem (che số điện thoại) |
| Nhật ký thao tác | Ai làm gì, lúc nào, trước và sau |

## Quy tắc đã cài trong code

- Giá luôn tính lại ở máy chủ; tồn kho trừ có điều kiện nên không bán quá số chai thật; hủy hoặc hoàn trả thì cộng lại kho.
- **Tồn kho không bao giờ bị ghi đè bằng số trên form.** Lưu form sản phẩm không đụng tới tồn kho (chỉ hiện để xem). Nhập hàng, hỏng, kiểm kho lệch: dùng "Điều chỉnh tồn kho" (ở danh sách sản phẩm hoặc trang sửa sản phẩm), chọn "Nhập thêm" hoặc "Bớt đi", gõ số chai và lý do; hệ thống cộng/trừ trong một câu lệnh, không cho âm, ghi nhật ký trước/sau và lý do. Sản phẩm mới tạo thì nhập tồn ban đầu.
- Chuyển trạng thái đơn và thanh toán chỉ ăn khi đơn vẫn ở trạng thái nhân viên vừa thấy; hai người bấm cùng lúc thì người sau nhận "Đơn vừa được người khác cập nhật, tải lại trang" và kho không bị cộng hai lần.
- Lỗi ghi log qua `logError` (`src/lib/log.ts`): chỉ tên lỗi, mã Postgres và câu lỗi đã che số, email; không bao giờ ghi câu SQL hay giá trị tham số. Trang quản trị chỉ hiện nguyên câu cho lỗi nghiệp vụ (`UserError`), lỗi khác hiện câu chung.
- Mã đơn `WEB-YYMM-NNNN` theo giờ Việt Nam.
- Đơn chỉ đi tới: chờ xác nhận → xác nhận → đóng gói → đang giao → đã giao; hủy được trước khi giao, phải ghi lý do.
- **Bộ lọc công dụng**: lưu sản phẩm, nội dung, cài đặt sẽ bị chặn nếu có "mọc tóc", "trị", "chữa", "giảm rụng"…; câu phủ định ("Không làm mọc tóc") và câu hỏi vẫn dùng được.
- Ô đồng ý nhận tin không bao giờ tích sẵn; mỗi lần đặt đơn ghi bản ghi đồng ý mới kèm phiên bản chính sách.
- Chỉ gán được lô đã duyệt xuất kho của đúng sản phẩm. Duyệt cần vi sinh và kim loại nặng đạt, phiếu công bố còn hạn.
- Trang lô `/l/[số lô]` phân biệt: sai dạng số lô, không có lô, lô chưa có trang công khai (đang cách ly hoặc chưa bật công khai); cả ba hiện trang tiếng Việt có ô tra lại điền sẵn số vừa gõ. Gán vào đơn một lô đã duyệt nhưng chưa bật công khai vẫn được, kèm cảnh báo ở trang đơn và trang lô. Đường dẫn không có hiện trang "Mình chưa tìm thấy trang này".
- Đăng nhập quản trị: mật khẩu scrypt, phiên lưu trong DB (cookie chỉ giữ mã ngẫu nhiên), khóa 15 phút sau 5 lần sai, TOTP tùy chọn.
- Mọi thay đổi quan trọng ghi `audit_log`.
- Thông báo gửi sau khi đã trả trang cho khách (`after()`), lỗi gửi không làm hỏng đơn; mỗi lần gửi ghi `notification_log` để xem và gửi lại. Tắt báo phản ánh vẫn gửi tin khẩn (mức nặng hoặc lô tự giữ lại).

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy thử |
| `npm test` | Test quy tắc nghiệp vụ và luồng đặt đơn trên DB thật (PGlite) |
| `npm run typecheck` | Kiểm tra kiểu |
| `npm run build` | Build bản chạy thật |
| `npm run db:generate` | Sinh migration sau khi sửa `src/db/schema` |
| `npm run db:migrate` | Áp migration lên `DATABASE_URL` |
| `npm run db:seed` | Nạp dữ liệu ban đầu cho bản chạy thật vào `DATABASE_URL` (tắt bán, tồn kho 0). `npm run db:seed -- --demo` nạp dữ liệu thử, chỉ dùng cho DB staging |

## Cấu trúc

```
src/
  app/(public)/        cửa hàng
  app/admin/           quản trị (_components, _lib dùng chung)
  app/dang-nhap/       đăng nhập, tạo chủ cửa hàng lần đầu, bước mã 2 lớp
  app/api/files/[id]   ảnh tải lên (lưu trong DB)
  app/api/lots/[lotNo]/qr   QR SVG cho nhãn
  components/          logo, chai SVG, thẻ sản phẩm, giỏ
  db/schema/           catalog, customers, orders, quality, platform
  db/seed.ts           dữ liệu ban đầu
  modules/*/rules.ts   quy tắc nghiệp vụ dạng hàm thuần (có test)
  modules/*/service.ts đọc ghi cơ sở dữ liệu
drizzle/               migration SQL
tests/                 Vitest
```

## Cần làm trước khi mở bán thật

- Thay giá, thành phần trong dữ liệu ban đầu bằng số thật khi có báo giá và phiếu công bố; nhập tồn kho bằng "Điều chỉnh tồn kho" khi hàng về.
- Đặt `SETUP_TOKEN` trước lần mở `/dang-nhap` đầu tiên, tạo chủ cửa hàng xong thì xóa biến này (mục "Lần deploy đầu").
- Duyệt 3 trang chính sách (đang ghi "bản nháp") với người tư vấn pháp lý; tăng `CONSENT_POLICY_VERSION` khi đổi câu chữ đồng ý.
- Chụp ảnh sản phẩm thật (chưa có ảnh thì web vẽ chai theo màu bộ nhận diện).
- Bật thông báo: đặt `RESEND_API_KEY` (và `NOTIFY_EMAIL_FROM` khi có tên miền), hoặc `ZALO_OA_APP_ID`, `ZALO_OA_SECRET_KEY`, `ZALO_OA_REFRESH_TOKEN`; điền người nhận ở `/admin/cai-dat`, bấm "Gửi tin thử" ở `/admin/thong-bao`. Hướng dẫn từng bước nằm ngay trên trang đó.
- Nhắc phản ánh quá 24 giờ chưa phản hồi cần một tác vụ chạy định kỳ (chưa làm).
- Dữ liệu cá nhân lưu ở Supabase vùng Singapore: kiểm tra quy định chuyển dữ liệu ra nước ngoài.
- Khi nhiều ảnh, chuyển ảnh từ DB sang kho tệp (Supabase Storage).
- `npm audit` còn cảnh báo mức trung bình trong `drizzle-kit` (chỉ dùng khi phát triển).
