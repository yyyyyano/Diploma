// Подключение очереди pg-boss к базе (ADR-0008): своего пула у pg-boss нет — он работает на пуле приложения
// (роль kosht_app, ADR-0020) или, при постановке в транзакции, на соединении этой транзакции. Сам pg-boss
// импортирует только platform/jobs (правило pg-boss-only-in-platform-jobs), поэтому здесь — только форма, которую
// он принимает: IDatabase (`executeSql`) и пара «транзакция Drizzle + тег sql» для его адаптера fromDrizzle.
// Файл — возможность PLATFORM_DB (tooling/architecture/rules.ts): импортируют его только platform/jobs и тесты.
//
// Аудитор SQL. Постановка в транзакции (bossTransaction) идёт через tx.db ScopedDb — каждый запрос pg-boss
// проходит аудитор в режиме scoped. Служебные запросы самой очереди (выборка, завершение, обслуживание, расписания)
// идут через bossDb мимо аудитора: pg-boss шлёт их многокомандными транзакциями с SET LOCAL и
// pg_advisory_xact_lock, а аудитор такие тексты отклоняет (MULTIPLE_STATEMENTS, STATEMENT_NOT_ALLOWED) — и должен.
// Пользовательских таблиц эти запросы не называют (только схему pgboss), а права роли приложения (только DML)
// держат их и без аудитора (замок 6, ADR-0020).
import { sql } from "drizzle-orm";
import type { DbClient, QueryDb } from "./audited.ts";
import type { ScopedDb } from "./scoped-db.ts";

/**
 * То, что pg-boss называет IDatabase: выполнить текст с параметрами `$n`. Строки ответа pg-boss читает сам (форма
 * у каждого его запроса своя); совпадение с IDatabase проверяет присваивание в platform/jobs.
 */
export interface BossDb {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** pg-boss на пуле приложения или на соединении под блокировкой миграций (установка схемы владельцем). */
export function bossDb(client: DbClient): BossDb {
  // Ответ — как у собственного пула pg-boss (client.query как есть): многокомандный текст (BEGIN; …; COMMIT) pg
  // возвращает массивом результатов, и pg-boss разбирает его сам.
  return { executeSql: (text, values) => client.query(text, values) };
}

/** Транзакция для fromDrizzle(tx, sql) pg-boss: запросы очереди уходят соединением транзакции и проходят аудитор. */
export interface BossTransaction {
  readonly tx: Pick<QueryDb, "execute">;
  readonly sql: typeof sql;
}

/** Постановка задачи в той же транзакции, что и запись данных: откат — ни записи, ни задачи (ADR-0008). */
export function bossTransaction(tx: ScopedDb): BossTransaction {
  return { tx: tx.db, sql };
}
