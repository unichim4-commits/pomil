import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Giữ kết nối trên globalThis để chế độ dev nạp lại module không mở thêm kết nối.
const globalForDb = globalThis as unknown as { __pomilDb?: Promise<Db> };

// Có DATABASE_URL: dùng PostgreSQL (Supabase), migration chạy bằng `npm run db:migrate`.
// Không có: dùng PGlite (PostgreSQL nhúng) trong thư mục .data/, tự migrate và nạp dữ liệu mẫu.
// PGlite chỉ để chạy thử trên máy, không dùng cho bản chạy thật.
export function getDb(): Promise<Db> {
  globalForDb.__pomilDb ??= connect().catch((error: unknown) => {
    globalForDb.__pomilDb = undefined;
    throw error;
  });
  return globalForDb.__pomilDb;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const [{ drizzle }, { default: postgres }] = await Promise.all([import("drizzle-orm/postgres-js"), import("postgres")]);
    // prepare: false vì Supabase pooler chạy chế độ transaction
    const client = postgres(url, { prepare: false, max: 5 });
    return drizzle(client, { schema }) as unknown as Db;
  }

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PGLITE !== "1") {
    throw new Error("Thiếu DATABASE_URL. Bản chạy thật cần PostgreSQL, xem .env.example.");
  }

  const [{ PGlite }, { drizzle }, { migrate }, { seedInitialData }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("./seed"),
  ]);
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  // PGLITE_SEED=production: chạy thử với đúng dữ liệu của bản chạy thật (tắt bán, chưa có hàng)
  await seedInitialData(db as unknown as Db, process.env.PGLITE_SEED === "production" ? "production" : "demo");
  return db as unknown as Db;
}
