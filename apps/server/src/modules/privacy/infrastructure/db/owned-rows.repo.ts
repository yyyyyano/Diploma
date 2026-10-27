// Строки домохозяйства в таблицах владельцев данных (PRIV-06): privacy удаляет их по реестру, не зная
// схем модулей-владельцев. Только через ScopedDb: s.own(таблица) в каждом запросе — чужое домохозяйство недостижимо.
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { OwnedTable } from "../../../../platform/db/tables.ts";

/** Удалить все строки домохозяйства s в таблице; возвращает, сколько удалено. */
export async function deleteOwnedRows(s: ScopedDb, table: OwnedTable): Promise<number> {
  const rows = await s.delete(table, s.own(table)).returning({ id: table.id });
  return rows.length;
}
