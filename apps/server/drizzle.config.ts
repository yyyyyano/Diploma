// drizzle-kit для боевой схемы (make db-generate): схемы модулей и платформы (settings, secrets, rate_limits) →
// SQL-миграции в apps/server/drizzle/.
// SQL читается глазами и правится руками там, где drizzle-kit не умеет (расширения, HNSW, CONCURRENTLY,
// ON DELETE SET NULL (колонка)), — .claude/rules/database.md, ADR-0007. Применяет миграции приложение
// при старте под pg_advisory_lock (make migrate), а не drizzle-kit.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./apps/server/src/modules/*/infrastructure/db/schema{.ts,/*.ts}",
    "./apps/server/src/platform/*/schema.ts",
  ],
  out: "./apps/server/drizzle",
  // Таблицы pg-boss (схема pgboss) и журнал миграций (схема drizzle) Drizzle не трогает.
  schemaFilter: ["public"],
});
