import { sql } from "drizzle-orm";
import { unsafeRaw } from "./unsafe-raw.ts";

export async function migrate(db: Database) {
  await db.$client.query("select pg_advisory_lock(1)");
  await db.execute(sql`select 1`);
  return unsafeRaw;
}
