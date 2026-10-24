// Nạp dữ liệu ban đầu vào PostgreSQL thật (Supabase). Chỉ chạy khi bảng settings còn trống.
// Dùng: npm run db:seed (đọc DATABASE_URL từ .env.local). Mặc định nạp dữ liệu cho bản chạy thật:
// sản phẩm "sắp ra mắt", tồn kho 0, tắt nhận đơn. Thêm "-- --demo" để nạp dữ liệu thử (chỉ cho DB staging).
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { seedInitialData } from "../src/db/seed";
import { formatSafeError } from "../src/lib/log";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Thiếu DATABASE_URL");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  const mode = process.argv.includes("--demo") ? "demo" : "production";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seeded = await seedInitialData(db as any, mode);
  const label = mode === "demo" ? "dữ liệu thử, đang BẬT nhận đơn" : "bản chạy thật, đang TẮT nhận đơn";
  console.log(seeded ? `Đã nạp dữ liệu ban đầu (${label}).` : "Đã có dữ liệu, bỏ qua.");
  await client.end();
}

main().catch((error) => {
  // Không in nguyên lỗi: lỗi truy vấn có cả giá trị tham số
  console.error(formatSafeError("seed", error));
  process.exit(1);
});
