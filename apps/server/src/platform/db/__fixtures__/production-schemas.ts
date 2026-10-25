// Загрузить все боевые схемы (ARCHITECTURE §4.1): схемы модулей и системные таблицы платформы. Таблица попадает в
// реестр tables.ts при импорте её схемы — тесты на базе из боевых миграций загружают их так же, как старт (T-007).
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SERVER_SRC = fileURLToPath(new URL("../../../", import.meta.url));
const SCHEMA_GLOBS = [
  "modules/*/infrastructure/db/schema.ts",
  "modules/*/infrastructure/db/schema/*.ts",
  "platform/*/schema.ts",
];

export async function loadProductionSchemas(): Promise<void> {
  for (const file of globSync(SCHEMA_GLOBS, { cwd: SERVER_SRC })) {
    if (!file.endsWith(".test.ts")) await import(new URL(file, `file://${SERVER_SRC}`).href);
  }
}
