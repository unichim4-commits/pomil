# Pomil OS: ghi chú cho Claude Code

- Next.js 16 App Router: dùng `src/proxy.ts` (không phải middleware.ts); `params`, `searchParams`, `cookies()` đều là Promise.
- Tài liệu Next.js đúng phiên bản nằm trong `node_modules/next/dist/docs`, đọc ở đó trước khi đoán API.
- Cơ sở dữ liệu: Drizzle qua `await getDb()` (`src/db/client.ts`). Có `DATABASE_URL` thì dùng postgres-js; không có thì PGlite ở `.data/pglite`, tự migrate và nạp `src/db/seed.ts`. Sửa schema xong chạy `npm run db:generate`, không sửa tay migration đã sinh. Bảng mới nhớ bật RLS bằng một migration custom.
- Quy tắc nghiệp vụ viết thành hàm thuần trong `src/modules/*/rules.ts` và phải có test trong `tests/`. Service gọi các hàm đó, không lặp logic. Test service chạy trên PGlite (xem `tests/orders-flow.test.ts`).
- File có `"use server"` chỉ export hàm async; hằng số đặt ở module khác.
- Server Action quản trị: bọc bằng `guard()`, gọi `requirePermission(...)` trước khi ghi, trả `ActionResult` (`src/app/admin/_lib/result.ts`). Form dùng `ActionForm` hoặc `useFormAction` (giữ chữ khi lỗi, khóa nút tới khi trang chạy JS, `method="post"`).
- Mọi thay đổi trạng thái quan trọng (đơn, lô, khách, đồng ý, sản phẩm, cài đặt, nhân viên) ghi `writeAudit`.
- Câu chữ hiển thị cho khách bằng tiếng Việt và phải qua `checkClaims` (`src/modules/content/rules.ts`): không dùng trị, mọc tóc, hết rụng… trừ câu phủ định hoặc câu hỏi.
- Giao diện theo bộ nhận diện v2: màu `graphite bone pith rind blush` trong `globals.css`, chữ Be Vietnam Pro + Cormorant Garamond nghiêng, không chữ đậm 700.
- Không đưa dữ liệu cá nhân lên URL (tra cứu đơn dùng POST).
- Trước khi xong việc: `npm run typecheck`, `npm test`, `npm run build`.
