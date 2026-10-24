// Проверка схемы — часть замка 4 изоляции (ARCHITECTURE §6.2, ADR-0006): то, чего не видит аудитор SQL. Запрос
// к VIEW, SQL-функции или срабатывание триггера не называет пользовательскую таблицу в тексте, а таблица мимо
// реестра аудитором не проверяется вовсе. Сверяет реестр таблиц (tables.ts) со схемой public настоящей базы.
// Реестр полон, только когда загружены все схемы: тест боевой схемы и старт приложения (T-007) импортируют их.
import type pg from "pg";
import type { TableKind } from "./tables.ts";

export type SchemaProblemKind =
  | "view"
  | "function"
  | "trigger"
  | "unregistered-table"
  | "missing-table"
  | "nullable-household"
  | "owned-table-shape"
  | "public-table-owner";

export interface SchemaProblem {
  readonly kind: SchemaProblemKind;
  /** Имя объекта базы (таблица, представление, функция, триггер). */
  readonly object: string;
  readonly message: string;
}

/** Найти нарушения в схеме public базы; пустой список — схема чиста. */
export async function checkSchema(
  pool: pg.Pool,
  registry: ReadonlyMap<string, TableKind>,
): Promise<SchemaProblem[]> {
  const problems: SchemaProblem[] = [];
  const add = (kind: SchemaProblemKind, object: string, message: string) =>
    problems.push({ kind, object, message });

  const views = await names(
    pool,
    `select table_name as name from information_schema.views where table_schema = 'public'
     union all select matviewname from pg_matviews where schemaname = 'public'`,
  );
  for (const view of views) {
    add(
      "view",
      view,
      `VIEW ${view} в public запрещён: аудитор SQL не видит таблиц за представлением`,
    );
  }

  // Функции расширений (vector, pg_trgm) — не наши: у них зависимость deptype = 'e' от расширения.
  const functions = await names(
    pool,
    `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
  );
  for (const fn of functions) {
    add(
      "function",
      fn,
      `функция ${fn}() в public запрещена: запрос через неё аудитор SQL не проверит`,
    );
  }

  const triggers = await names(
    pool,
    `select t.tgname || ' ON ' || c.relname as name from pg_trigger t
     join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal`,
  );
  for (const trigger of triggers) {
    add("trigger", trigger, `триггер ${trigger} запрещён: его запросы идут мимо аудитора SQL`);
  }

  const columns = await pool.query<{ table: string; column: string; nullable: boolean }>(
    `select c.table_name as table, c.column_name as column, c.is_nullable = 'YES' as nullable
     from information_schema.columns c join information_schema.tables t
       on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`,
  );
  const tables = new Map<string, Map<string, boolean>>();
  for (const { table, column, nullable } of columns.rows) {
    const byColumn = tables.get(table) ?? new Map<string, boolean>();
    byColumn.set(column, nullable);
    tables.set(table, byColumn);
  }
  const primaryKeys = await primaryKeyColumns(pool);

  for (const [table, byColumn] of tables) {
    const kind = registry.get(table);
    if (kind === undefined) {
      add(
        "unregistered-table",
        table,
        `таблица ${table} вне реестров: объявите её userOwnedTable, systemTable или publicTable`,
      );
    }
    if (byColumn.get("household_id") === true) {
      add(
        "nullable-household",
        table,
        `${table}.household_id допускает NULL: «смешанные» таблицы запрещены (ARCHITECTURE §6.1)`,
      );
    }
    if (kind === "user" && (primaryKeys.get(table) ?? "") !== "household_id,id") {
      add(
        "owned-table-shape",
        table,
        `${table}: первичный ключ пользовательской таблицы — (household_id, id)`,
      );
    }
    if (kind === "public" && (byColumn.has("household_id") || byColumn.has("user_id"))) {
      add("public-table-owner", table, `${table}: у общей таблицы нет household_id и user_id`);
    }
  }
  for (const table of registry.keys()) {
    if (!tables.has(table)) {
      add(
        "missing-table",
        table,
        `таблица ${table} есть в схеме Drizzle, но не в базе: нет миграции`,
      );
    }
  }
  return problems;
}

async function names(pool: pg.Pool, query: string): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(query);
  return rows.map((row) => row.name).toSorted();
}

/** Колонки первичного ключа таблиц public по порядку: «household_id,id». */
async function primaryKeyColumns(pool: pg.Pool): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ table: string; columns: string }>(
    `select k.table_name as table, string_agg(k.column_name, ',' order by k.ordinal_position) as columns
     from information_schema.table_constraints c
     join information_schema.key_column_usage k
       on k.constraint_name = c.constraint_name and k.table_schema = c.table_schema
     where c.table_schema = 'public' and c.constraint_type = 'PRIMARY KEY'
     group by k.table_name`,
  );
  return new Map(rows.map((row) => [row.table, row.columns]));
}
