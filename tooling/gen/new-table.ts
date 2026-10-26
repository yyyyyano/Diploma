// make new-table module=<id> name=<таблица> [kind=user|system|public]: заготовка таблицы модуля (ARCHITECTURE §6.1,
// .claude/rules/database.md). Вид таблицы — только из tables модуля в modules.ts: иначе отказ (модулю без system
// нельзя завести системную таблицу, admin — пользовательскую). Для пользовательской таблицы — ещё строка в
// defineUserData (user-data.ts: экспорт и удаление, PRIV-05/06) и подключение userData в module.ts: так схема
// загружается при старте статически, а аудитор знает таблицу. Миграцию генерирует make db-generate отдельно.
//   node tooling/gen/new-table.ts <модуль> <таблица> [вид]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULES, type ModuleDef, type TableKind } from "../architecture/modules.ts";
import { camel } from "./module-files.ts";
import { MODULES_DIR, type GenResult } from "./new-module.ts";

const HELPER: Record<TableKind, string> = {
  user: "userOwnedTable",
  system: "systemTable",
  public: "publicTable",
};
const TABLE_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const TABLES_IMPORT = /import \{([^}]*)\} from "\.\.\/\.\.\/\.\.\/\.\.\/platform\/db\/tables\.ts";/;
const SCHEMA_IMPORT = /import \{([^}]*)\} from "\.\/infrastructure\/db\/schema\.ts";/;

function isKind(kind: string): kind is TableKind {
  return kind === "user" || kind === "system" || kind === "public";
}

function withName(list: string, name: string): string {
  const names = list
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return ` ${[...new Set([...names, name])].toSorted().join(", ")} `;
}

/** schema.ts модуля с новой таблицей: файл создаётся, импорт вида таблицы дополняется. */
export function addTable(
  source: string | undefined,
  id: string,
  name: string,
  kind: TableKind,
): string {
  const helper = HELPER[kind];
  const header =
    source ??
    [
      `// Таблицы модуля ${id} (ARCHITECTURE §6.1): вид — из modules.ts и паспорта; миграция — make db-generate.`,
      `import {} from "../../../../platform/db/tables.ts";`,
      "",
    ].join("\n");
  const imported = header.replace(
    TABLES_IMPORT,
    (_line, list: string) =>
      `import {${withName(list, helper)}} from "../../../../platform/db/tables.ts";`,
  );
  const columns =
    kind === "user"
      ? "// id, household_id, user_id, created_at, updated_at ставит userOwnedTable; ссылки — ownedFk."
      : "// Колонки — по SPEC модуля: деньги — bigint копеек, дни — date, моменты — timestamptz.";
  return [
    imported.trimEnd(),
    "",
    `export const ${camel(name.replaceAll("_", "-"))} = ${helper}("${name}", {`,
    `  ${columns}`,
    "});",
    "",
  ].join("\n");
}

/** user-data.ts с новой таблицей первой в списке (порядок удаления — дети раньше родителей). */
export function addUserData(
  source: string | undefined,
  id: string,
  table: string,
): string | undefined {
  if (source === undefined) {
    return [
      `// Владелец данных модуля ${id} (PRIV-05/06): таблицы для «Мои данные» и удаления аккаунта — дети раньше`,
      "// родителей.",
      'import { defineUserData } from "../../platform/db/user-data.ts";',
      `import { ${table} } from "./infrastructure/db/schema.ts";`,
      "",
      `export const ${camel(id)}UserData = defineUserData({ tables: [${table}] });`,
      "",
    ].join("\n");
  }
  if (!SCHEMA_IMPORT.test(source) || !source.includes("tables: [")) return undefined;
  return source
    .replace(
      SCHEMA_IMPORT,
      (_line, list: string) =>
        `import {${withName(list, table)}} from "./infrastructure/db/schema.ts";`,
    )
    .replace("tables: [", `tables: [${table}, `);
}

/** module.ts только что сгенерированного модуля: userData подключается сам; правленный — подсказкой. */
export function wireUserData(source: string, id: string): string | undefined {
  const fresh = `defineModule({ id: "${id}" })`;
  if (!source.includes(fresh)) return undefined;
  const userData = `${camel(id)}UserData`;
  const lines = source
    .replace(fresh, `defineModule({ id: "${id}", userData: ${userData} })`)
    .split("\n");
  // Конец последнего импорта, а не его первая строка: форматер переносит длинный импорт по строкам (находка T-012).
  const lastImport = lines.findLastIndex((line) => line.startsWith("import "));
  const end = lines.findIndex((line, index) => index >= lastImport && line.trimEnd().endsWith(";"));
  lines.splice(end + 1, 0, `import { ${userData} } from "./user-data.ts";`);
  return lines.join("\n");
}

export function runNewTable(options: {
  readonly root: string;
  readonly module: string;
  readonly name: string;
  readonly kind?: string;
  readonly modules?: readonly ModuleDef[];
}): GenResult {
  const { root, module: id, name } = options;
  const kind = options.kind ?? "user";
  const fail = (message: string): GenResult => ({ code: 1, files: [], messages: [message] });
  const m = (options.modules ?? MODULES).find((candidate) => candidate.id === id);
  const dir = join(MODULES_DIR, id);
  if (m === undefined || !existsSync(join(root, dir, "module.ts"))) {
    return fail(`Модуля «${id}» нет в modules.ts или его папки: сначала make new-module id=${id}.`);
  }
  if (!isKind(kind) || !m.tables.includes(kind)) {
    return fail(
      `У модуля ${id} в modules.ts нет таблиц вида «${kind}» (есть: ${m.tables.join(", ") || "—"}): ` +
        "вид таблицы меняется правкой карты с обоснованием в итоге задачи.",
    );
  }
  if (!TABLE_NAME.test(name)) {
    return fail(`Имя таблицы «${name}»: snake_case во множественном числе (receipt_items).`);
  }
  const schemaPath = join(dir, "infrastructure", "db", "schema.ts");
  const schema = existsSync(join(root, schemaPath))
    ? readFileSync(join(root, schemaPath), "utf8")
    : undefined;
  if (schema?.includes(`("${name}"`) === true)
    return fail(`Таблица ${name} уже есть в ${schemaPath}.`);

  const writes: [string, string][] = [[schemaPath, addTable(schema, id, name, kind)]];
  const messages = [
    `Таблица ${name} (${HELPER[kind]}) добавлена в ${schemaPath}: опишите колонки.`,
  ];
  if (kind === "user") {
    const table = camel(name.replaceAll("_", "-"));
    const userDataPath = join(dir, "user-data.ts");
    const current = existsSync(join(root, userDataPath))
      ? readFileSync(join(root, userDataPath), "utf8")
      : undefined;
    const userData = addUserData(current, id, table);
    if (userData === undefined) {
      messages.push(
        `Добавьте ${table} в defineUserData (${userDataPath}) — дети раньше родителей.`,
      );
    } else {
      writes.push([userDataPath, userData]);
      messages.push(`${userDataPath}: ${table} первой в списке — проверьте порядок удаления.`);
    }
    const modulePath = join(dir, "module.ts");
    const wired = wireUserData(readFileSync(join(root, modulePath), "utf8"), id);
    if (wired !== undefined) writes.push([modulePath, wired]);
    else if (!readFileSync(join(root, modulePath), "utf8").includes("./user-data.ts")) {
      messages.push(`Подключите userData: ${camel(id)}UserData в defineModule (${modulePath}).`);
    }
    messages.push(
      "Тест изоляции по реестру потребует фикстуру бренда id этой таблицы — добавьте её по подсказке теста.",
    );
  } else {
    messages.push(
      `Схема загружается при старте через module.ts → репозиторий (infrastructure/db/*.repo.ts): без этого ` +
        "compose.int.test.ts покажет незагруженную таблицу.",
    );
  }
  messages.push(`Миграция: make db-generate name=${id}-${name} — и прочитать SQL глазами.`);
  for (const [path, text] of writes) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { code: 0, files: writes.map(([path]) => path), messages };
}

function main(): number {
  const [module = "", name = "", kind] = process.argv.slice(2);
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const result = runNewTable({ root, module, name, ...(kind === undefined ? {} : { kind }) });
  for (const message of result.messages) {
    if (result.code === 0) console.log(message);
    else console.error(message);
  }
  return result.code;
}

if (import.meta.main) process.exitCode = main();
