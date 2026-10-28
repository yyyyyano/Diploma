// Строки домохозяйства в таблицах владельцев данных (PRIV-05/06): privacy выгружает и удаляет их по реестру, не зная
// схем модулей-владельцев. Только через ScopedDb: s.own(таблица) в каждом запросе — чужое домохозяйство недостижимо.
import { and, asc, gt } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { OwnedTable } from "../../../../platform/db/tables.ts";

/**
 * Страница строк домохозяйства s в таблице по id (uuidv7 — по времени создания), после id after: архив читает таблицу
 * кусками, а не целиком в память (PRIV-05).
 */
export async function ownedRowsPage(
  s: ScopedDb,
  table: OwnedTable,
  after: string | undefined,
  limit: number,
): Promise<Record<string, unknown>[]> {
  return s.db
    .select()
    .from(table)
    .where(after === undefined ? s.own(table) : and(s.own(table), gt(table.id, after)))
    .orderBy(asc(table.id))
    .limit(limit);
}

/** Удалить все строки домохозяйства s в таблице; возвращает, сколько удалено. */
export async function deleteOwnedRows(s: ScopedDb, table: OwnedTable): Promise<number> {
  const rows = await s.delete(table, s.own(table)).returning({ id: table.id });
  return rows.length;
}
