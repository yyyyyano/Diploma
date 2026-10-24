// drizzle-kit для тестовой схемы механизма изоляции (make db-generate-fixtures); боевая — apps/server/drizzle.config.ts.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./apps/server/src/platform/db/__fixtures__/schema.ts",
  out: "./apps/server/src/platform/db/__fixtures__/drizzle",
  schemaFilter: ["public"],
});
