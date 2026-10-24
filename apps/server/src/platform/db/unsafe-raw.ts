// unsafeRaw (ARCHITECTURE §6.5): Drizzle без аудитора — только миграции (platform/db) и тесты, сеющие данные
// нескольких домохозяйств и проверяющие, что чужие строки не изменились. В боевую платформу (T-005) не входит;
// импорт вне platform/db и тестов запрещает правило no-unsafe-db, упоминание — isolation.mjs.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DbClient } from "./audited.ts";

export function createUnsafeRaw(client: DbClient): NodePgDatabase {
  return drizzle({ client });
}
