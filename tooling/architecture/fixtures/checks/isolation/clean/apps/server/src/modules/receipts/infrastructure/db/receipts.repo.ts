import { sql } from "drizzle-orm";

export async function stats(s: ScopedDb, direction: "asc" | "desc") {
  const order = sql.raw(direction === "asc" ? "asc" : "desc");
  return s.db.execute(sql`select count(*) from receipts where ${s.own(receipts)} order by 1 ${order}`);
}
