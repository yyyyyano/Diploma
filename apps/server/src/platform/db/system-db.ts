// SystemDb (ARCHITECTURE §6.5, PRIV-07): системные и общие таблицы — пользователи, сессии, настройки, журналы,
// законы. Аудитор запрещает ему любое упоминание пользовательской таблицы. Импортировать этот файл могут только
// модули с таблицами system или public в modules.ts (правило system-db-only-for-flagged-modules).
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { auditedDrizzle, type DbClient } from "./audited.ts";

/** Drizzle для системных и общих таблиц; транзакции — обычные, с тем же аудитом. */
export type SystemDb = Omit<PgAsyncDatabase<NodePgQueryResultHKT>, "query" | "$cache">;

export function createSystemDb(client: DbClient): SystemDb {
  return auditedDrizzle(client, { kind: "system" });
}
