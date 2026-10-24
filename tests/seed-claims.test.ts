import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { seedDemoData } from "@/db/seed";
import { checkClaims } from "@/modules/content/rules";

// Chạy migration thật trên PGlite trong bộ nhớ, nạp dữ liệu mẫu và rà câu chữ hiển thị cho khách.
describe("seed data", () => {
  it("migrates, seeds once, and passes the claim filter", async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await seedDemoData(db as any)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await seedDemoData(db as any)).toBe(false);

    const products = await db.select().from(schema.products);
    const pages = await db.select().from(schema.contentPages);
    expect(products.length).toBe(5);

    const texts = [
      ...products.flatMap((p) => [p.name, p.subtitle, p.description, p.howToUse, ...p.highlights, ...p.notDo, ...p.ingredients.map((i) => i.purpose)]),
      ...pages.flatMap((p) => [p.title, p.excerpt, p.body]),
    ];
    const violations = texts.flatMap((t) => checkClaims(t));
    expect(violations).toEqual([]);
    await client.close();
  }, 60_000);
});
