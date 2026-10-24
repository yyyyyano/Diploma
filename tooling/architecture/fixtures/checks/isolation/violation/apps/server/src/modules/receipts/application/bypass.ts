import { unsafeRaw } from "../../../platform/db/unsafe-raw.ts";

export async function bypass(s: ScopedDb) {
  await s.db.$client.query("delete from receipts");
  return unsafeRaw;
}
