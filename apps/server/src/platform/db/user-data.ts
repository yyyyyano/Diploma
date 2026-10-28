// Владелец данных (PRIV-05, PRIV-06, ARCHITECTURE §6.6): модуль с пользовательскими данными описывает в
// user-data.ts, что выгружается в «Мои данные» и удаляется вместе с аккаунтом. Корень композиции собирает реестр
// владельцев (Platform.userData(), позднее связывание); экспорт и удаление (privacy) идут по нему, а тест полноты
// сверяет реестр с userOwnedTable. Порядок таблиц — порядок удаления: дети раньше родителей (составные FK); модули
// удаляются в порядке, обратном modules.ts. Строки таблиц выгружает и удаляет privacy сам; хуки — для того, что
// лежит вне таблиц домохозяйства: исходные файлы, системные таблицы модуля, трассы Langfuse.
import type { Scope } from "@kosht/kernel";
import { getTableName } from "drizzle-orm";
import type { ScopedDb } from "./scoped-db.ts";
import { registeredTables, type OwnedTable } from "./tables.ts";

/** Куда модуль кладёт своё в архив «Мои данные»: пути — относительно папки модуля в архиве. */
export interface ExportSink {
  /**
   * Файл как есть (фото чека, выписка). Blob читается, когда до него дойдёт запись архива: в памяти — не все файлы
   * сразу, а только текущий кусок.
   */
  file(path: string, content: Blob): Promise<void>;
}

export interface UserDataHooks {
  /** Дополнить архив сверх строк таблиц (исходные файлы, PRIV-05). */
  readonly export?: (s: ScopedDb, sink: ExportSink) => Promise<void>;
  /**
   * После удаления строк домохозяйства (PRIV-06): данные пользователя вне его таблиц — каталог файлов, строки
   * системных таблиц модуля, трассы. Должен быть идемпотентным: удаление аккаунта можно повторить после сбоя.
   */
  readonly afterDelete?: (scope: Scope) => Promise<void>;
}

export interface UserDataDef extends UserDataHooks {
  readonly tables: readonly OwnedTable[];
  /** Имена таблиц в том же порядке — для реестра и сообщений. */
  readonly tableNames: readonly string[];
}

/** Владелец данных в реестре корня композиции: модули — в порядке modules.ts (топологическом). */
export interface UserDataOwner {
  readonly module: string;
  readonly data: UserDataDef;
}

export function defineUserData(
  definition: { readonly tables: readonly OwnedTable[] } & UserDataHooks,
): UserDataDef {
  const tableNames = definition.tables.map((table) => getTableName(table));
  if (
    tableNames.length === 0 &&
    definition.export === undefined &&
    definition.afterDelete === undefined
  ) {
    throw new RangeError(
      "defineUserData: нужна хотя бы одна пользовательская таблица или хук export/afterDelete.",
    );
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
  return {
    tables: [...definition.tables],
    tableNames,
    ...(definition.export === undefined ? {} : { export: definition.export }),
    ...(definition.afterDelete === undefined ? {} : { afterDelete: definition.afterDelete }),
  };
}
