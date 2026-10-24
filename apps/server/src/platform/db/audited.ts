// Drizzle с аудитором SQL в Logger (ADR-0006): общий для ScopedDb, SystemDb и crossTenant. Logger — единственная
// точка Drizzle, через которую проходят все запросы, и вызывается он до отправки (drizzle-orm 1.0.0-rc.5,
// pg-core/async/session.js). Версия Drizzle закреплена точно; канарейки audit.test.ts и *.int.test.ts —
// проверка, что после обновления это всё ещё так (запасной путь — наследник pg.Pool, ARCHITECTURE §15).
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import type pg from "pg";
import { auditQuery, type AuditMode } from "./audit.ts";
import { ownedTableNames } from "./tables.ts";

/** Построитель запросов без $client (обход аудитора), реляционного API db.query.* и кэша Drizzle. */
export type QueryDb = Omit<
  PgAsyncDatabase<NodePgQueryResultHKT>,
  "query" | "$cache" | "transaction"
>;

/** Пул или выделенное соединение: транзакции Drizzle берут соединение из пула сами. */
export type DbClient = pg.Pool | pg.PoolClient;

/** Drizzle, каждый запрос которого проходит аудитор в режиме mode; $client закрыт. */
export function auditedDrizzle(client: DbClient, mode: AuditMode): NodePgDatabase {
  const db = drizzle({
    client,
    logger: { logQuery: (query, params) => auditQuery(query, params, mode, ownedTableNames()) },
  });
  return closeClient(db);
}

/** $client — сырой pg мимо аудитора: доступ к нему — громкая ошибка, а не тихий обход (ARCHITECTURE §6.2). */
export function closeClient<T extends object>(db: T): T {
  Object.defineProperty(db, "$client", {
    get() {
      throw new Error(
        "$client недоступен: запросы идут через s.db (ScopedDb) и проходят аудитор SQL (ADR-0006).",
      );
    },
  });
  return db;
}
