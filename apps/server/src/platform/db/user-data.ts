// Владелец данных (PRIV-05, PRIV-06, ARCHITECTURE §6.6): модуль с пользовательскими таблицами описывает в
// user-data.ts, что выгружается в «Мои данные» и удаляется вместе с аккаунтом. Корень композиции собирает реестр
// владельцев; экспорт и удаление (privacy, T-016) идут по нему, а тест полноты (T-009) сверяет реестр с
// userOwnedTable. Порядок таблиц — порядок удаления: дети раньше родителей (составные FK).
import { getTableName } from "drizzle-orm";
import { registeredTables, type OwnedTable } from "./tables.ts";

export interface UserDataDef {
  readonly tables: readonly OwnedTable[];
  /** Имена таблиц в том же порядке — для реестра и сообщений. */
  readonly tableNames: readonly string[];
}

export function defineUserData(definition: {
  readonly tables: readonly OwnedTable[];
}): UserDataDef {
  const tableNames = definition.tables.map((table) => getTableName(table));
  if (tableNames.length === 0) {
    throw new RangeError("defineUserData: нужна хотя бы одна пользовательская таблица.");
  }
  const seen = new Set<string>();
  for (const name of tableNames) {
    if (seen.has(name)) throw new RangeError(`defineUserData: таблица ${name} указана дважды.`);
    seen.add(name);
    // Тип уже требует userOwnedTable; проверка — для списков, собранных в обход типов.
    if (registeredTables().get(name) !== "user") {
      throw new RangeError(`defineUserData: ${name} — не userOwnedTable (ARCHITECTURE §6.1).`);
    }
  }
  return { tables: [...definition.tables], tableNames };
}
