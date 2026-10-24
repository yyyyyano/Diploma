import { unsafeRaw } from "../db/unsafe-raw.ts";

export async function raw(s: ScopedDb) {
  await s.db.$client.query("select 1");
  await s.db.execute(sql`select 1`);
  return unsafeRaw;
}
