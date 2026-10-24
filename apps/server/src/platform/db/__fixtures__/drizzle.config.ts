// drizzle-kit для тестовой схемы механизма изоляции; боевая — apps/server/drizzle.config.ts.
// Генерация: make db-generate DRIZZLE_CONFIG=apps/server/src/platform/db/__fixtures__/drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./apps/server/src/platform/db/__fixtures__/schema.ts",
  out: "./apps/server/src/platform/db/__fixtures__/drizzle",
  schemaFilter: ["public"],
});
