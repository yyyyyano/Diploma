import type { ScopedDb } from "../../../platform/db/scoped-db.ts";

export async function leak(s: ScopedDb, id: string, order: string) {
  await s.db.execute(`select * from receipts where id = '${id}'`);
  const tail = sql.raw(order);
  return s.db.select().from(receipts).orderBy(tail);
}
