// Тесты Vitest (ADR-0001, docs/ARCHITECTURE.md §12). Проекты int и web добавят T-004/T-008/T-011.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          // Быстрые тесты без БД: `x.test.ts` рядом с кодом; `x.int.test.ts` — проект int (настоящий Postgres).
          name: "unit",
          include: ["*.test.ts", "{apps,packages,tooling}/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/*.int.test.ts"],
        },
      },
    ],
  },
});
