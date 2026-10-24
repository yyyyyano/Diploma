// Три вида таблиц (ROLE-01, SEC-04, ARCHITECTURE §6.1, ADR-0006). Вид таблицы — это и форма схемы
// (у пользовательской — household_id в первичном ключе), и запись в реестре: по реестру аудитор SQL узнаёт
// пользовательские таблицы в тексте запроса, а проверка схемы — таблицы «мимо реестра».
// Таблица попадает в реестр, когда модуль её схемы загружен: старт приложения импортирует все схемы.
import { getColumnTable, getTableName, sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  pgTableCreator,
  primaryKey,
  timestamp,
  uuid,
  type AnyPgColumnBuilder,
  type PgBuildExtraConfigColumns,
  type PgColumn,
  type PgTable,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

export type TableKind = "user" | "system" | "public";

/**
 * Имена колонок — snake_case из имён свойств. В Drizzle 1.0 RC правило имён задаёт таблица, а не drizzle() и
 * не drizzle.config: так и миграции drizzle-kit, и запросы берут имя из одного места (ARCHITECTURE §15).
 */
const table = pgTableCreator((name) => name, "snake_case");

const registry = new Map<string, TableKind>();
let registryVersion = 0;

function register(name: string, kind: TableKind): void {
  const known = registry.get(name);
  if (known !== undefined) {
    throw new Error(
      `Таблица ${name} объявлена дважды (вид ${known} и ${kind}): имена таблиц уникальны.`,
    );
  }
  registry.set(name, kind);
  registryVersion += 1;
}

/** Все загруженные таблицы и их виды (для проверки схемы и тестов). */
export function registeredTables(): ReadonlyMap<string, TableKind> {
  return registry;
}

let ownedCache = { version: -1, names: new Set<string>() as ReadonlySet<string> };

/** Имена пользовательских таблиц — их аудитор ищет в тексте запроса. */
export function ownedTableNames(): ReadonlySet<string> {
  if (ownedCache.version !== registryVersion) {
    const names = [...registry].filter(([, kind]) => kind === "user").map(([name]) => name);
    ownedCache = { version: registryVersion, names: new Set(names) };
  }
  return ownedCache.names;
}

/** Колонки владельца: id — uuidv7() самой базы (PostgreSQL 18), моменты — timestamptz. */
function ownerColumns() {
  return {
    id: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    householdId: uuid().notNull(),
    userId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Момент правки ставит база (now()), а не часы приложения: «сейчас» в коде — только Clock.
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  };
}

type OwnerColumns = ReturnType<typeof ownerColumns>;

/** Колонки, которые ставит ScopedDb, а не вызывающий код. */
export type OwnerKey = "householdId" | "userId";

declare const OWNED_TABLE: unique symbol;

/** Пользовательская таблица: только её принимают s.own / s.insert / s.update / s.delete. */
export type OwnedTable = PgTable & {
  readonly [OWNED_TABLE]: true;
  readonly id: PgColumn;
  readonly householdId: PgColumn;
  readonly userId: PgColumn;
};

type ExtraConfig<C extends Record<string, AnyPgColumnBuilder>> = (
  self: PgBuildExtraConfigColumns<C>,
) => (PgTableExtraConfigValue | PgTableExtraConfigValue[])[];

/**
 * Данные домохозяйства: id, household_id, user_id (NOT NULL), created_at, updated_at; первичный ключ
 * (household_id, id) — по одному id строку не найти и не сослаться на неё; уникальности по одному id нет.
 */
export function userOwnedTable<N extends string, C extends Record<string, AnyPgColumnBuilder>>(
  name: N,
  columns: C & { [K in keyof OwnerColumns]?: never },
  extra?: ExtraConfig<OwnerColumns & C>,
) {
  const created = table(name, { ...ownerColumns(), ...columns } as OwnerColumns & C, (t) => [
    primaryKey({ columns: [t.householdId, t.id] }),
    ...(extra ? extra(t) : []),
  ]);
  register(name, "user");
  return created as typeof created & { readonly [OWNED_TABLE]: true };
}

/** Системные данные (пользователи, сессии, настройки, журналы): доступ — через SystemDb. */
export function systemTable<N extends string, C extends Record<string, AnyPgColumnBuilder>>(
  name: N,
  columns: C,
  extra?: ExtraConfig<C>,
) {
  const created = table(name, columns, extra);
  register(name, "system");
  return created;
}

/** Общие данные для всех (законы, курсы, справочники): без household_id и user_id — «смешанных» таблиц нет. */
export function publicTable<N extends string, C extends Record<string, AnyPgColumnBuilder>>(
  name: N,
  columns: C,
  extra?: ExtraConfig<C>,
) {
  const created = table(name, columns, extra);
  const owner = Object.values(created as unknown as Record<string, unknown>).find(
    (column) =>
      typeof column === "object" &&
      column !== null &&
      "name" in column &&
      (column.name === "household_id" || column.name === "user_id"),
  );
  if (owner !== undefined) {
    throw new Error(
      `Общая таблица ${name} не может иметь household_id/user_id (ARCHITECTURE §6.1): данные домохозяйства — ` +
        "в userOwnedTable, общие — в publicTable.",
    );
  }
  register(name, "public");
  return created;
}

/**
 * Ссылка на строку пользовательской таблицы того же домохозяйства: составной FK (household_id, колонка) →
 * родитель(household_id, id) и индекс под него. Сослаться на чужую строку не даст сама база (замок 2).
 * `onDelete: "set null"` drizzle-kit пишет как SET NULL всех колонок ключа — в миграции его правят руками на
 * `ON DELETE SET NULL (<колонка>)`, иначе удаление родителя упрётся в NOT NULL household_id (ADR-0007).
 */
export function ownedFk(
  self: { householdId: PgColumn },
  column: PgColumn,
  parent: OwnedTable,
  options: { onDelete?: "cascade" | "restrict" | "set null" } = {},
): PgTableExtraConfigValue[] {
  const name = `${getTableName(getColumnTable(column))}_${column.name}_fk`;
  const fk = foreignKey({
    name,
    columns: [self.householdId, column],
    foreignColumns: [parent.householdId, parent.id],
  });
  return [
    options.onDelete === undefined ? fk : fk.onDelete(options.onDelete),
    index(`${name}_idx`).on(self.householdId, column),
  ];
}
