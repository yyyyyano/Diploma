// ScopedDb — данные домохозяйства (ROLE-01, SEC-04, ARCHITECTURE §6.3, ADR-0006). Код, трогающий данные
// пользователя, получает s: ScopedDb первым аргументом; «чьи данные» — только s.scope, никогда из входа.
// s.db — обычный Drizzle, но каждый его запрос проходит аудитор SQL до отправки; s.insert/update/delete ставят
// household_id и фильтр сами. Выключателя аудита нет: в тестах без аудита — unsafe-raw.ts.
import type { Scope } from "@kosht/kernel";
import { and, eq, type InferInsertModel, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { auditedDrizzle, closeClient, type DbClient, type QueryDb } from "./audited.ts";
import type { OwnedTable, OwnerKey } from "./tables.ts";

declare const queryDb: QueryDb;

/** Значения вставки: без household_id и user_id — их ставит ScopedDb (тип не даст передать). */
export type InsertValue<T extends OwnedTable> = Omit<InferInsertModel<T>, OwnerKey>;

/** Правка строки: без владельца, id и created_at. */
export type Patch<T extends OwnedTable> = Partial<
  Omit<InferInsertModel<T>, OwnerKey | "id" | "createdAt">
>;

type InsertQuery<T extends OwnedTable> = ReturnType<ReturnType<typeof queryDb.insert<T>>["values"]>;
type UpdateQuery<T extends OwnedTable> = ReturnType<
  ReturnType<ReturnType<typeof queryDb.update<T>>["set"]>["where"]
>;
type DeleteQuery<T extends OwnedTable> = ReturnType<ReturnType<typeof queryDb.delete<T>>["where"]>;

export interface ScopedDb {
  /** Пользователь и домохозяйство — для llm, событий, realtime, jobKey. */
  readonly scope: Scope;
  /** Обычный Drizzle (select, join, with, sql); каждый запрос проходит аудитор; $client недоступен. */
  readonly db: QueryDb;
  /** «Строка моего домохозяйства» — нужна КАЖДОЙ пользовательской таблице запроса (where или on). */
  own(table: OwnedTable): SQL;
  /** Вставка: household_id и user_id из scope. */
  insert<T extends OwnedTable>(
    table: T,
  ): {
    values(value: InsertValue<T> | InsertValue<T>[]): InsertQuery<T>;
  };
  /** Обновление строк своего домохозяйства: фильтр добавляется сам; владельца, id и created_at не меняет. */
  update<T extends OwnedTable>(table: T, where: SQL): { set(patch: Patch<T>): UpdateQuery<T> };
  /** Удаление строк своего домохозяйства: фильтр добавляется сам. */
  delete<T extends OwnedTable>(table: T, where: SQL): DeleteQuery<T>;
  /** Явная транзакция; вложенная — SAVEPOINT. tx — тоже ScopedDb с тем же аудитом. */
  transaction<R>(fn: (tx: ScopedDb) => Promise<R>): Promise<R>;
}

/** Ключи, которые s.update не трогает, даже если их передали в обход типов. */
const FIXED_ON_UPDATE = new Set(["householdId", "userId", "id", "createdAt"]);

type Transactional = Pick<NodePgDatabase, "transaction">;

/** ScopedDb для scope поверх пула; создание дешёвое (≈1 мкс в замере отчёта 14) — на каждый запрос. */
export function createScopedDb(client: DbClient, scope: Scope): ScopedDb {
  return wrap(auditedDrizzle(client, { kind: "scoped", householdId: scope.householdId }), scope);
}

function wrap(db: QueryDb & Transactional, scope: Scope): ScopedDb {
  const own = (table: OwnedTable): SQL => eq(table.householdId, scope.householdId);
  return {
    scope,
    db,
    own,
    insert: (table) => ({
      values: (value) =>
        db.insert(table).values(
          // Владелец — из scope поверх переданного: лишнее поле в обход типов значения не меняет.
          (Array.isArray(value) ? value : [value]).map((row) => ({
            ...row,
            householdId: scope.householdId,
            userId: scope.userId,
          })) as never,
        ),
    }),
    update: (table, where) => ({
      set: (patch) =>
        db
          .update(table)
          .set(
            Object.fromEntries(
              Object.entries(patch).filter(([key]) => !FIXED_ON_UPDATE.has(key)),
            ) as never,
          )
          .where(and(own(table), where)),
    }),
    delete: (table, where) => db.delete(table).where(and(own(table), where)),
    transaction: (fn) =>
      db.transaction((tx) =>
        fn(wrap(closeClient(tx) as unknown as QueryDb & Transactional, scope)),
      ),
  };
}
