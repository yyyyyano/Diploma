// Тесты Vitest (ADR-0001, docs/ARCHITECTURE.md §12). Проекты int и web добавят T-004/T-008/T-011.
import { defineConfig } from "vitest/config";
import { FIXTURES_DIR } from "./tooling/architecture/rules.ts";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          // Быстрые тесты без БД: `x.test.ts` рядом с кодом; `x.int.test.ts` — проект int (настоящий Postgres).
          name: "unit",
          include: ["*.test.ts", "{apps,packages,tooling}/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/*.int.test.ts", `${FIXTURES_DIR}/**`],
        },
      },
    ],
    // Покрытие (CONSTRAINTS.md «Пороги с проверкой»): считается в `make test` (`vitest run --coverage`), не в
    // `check-quick`. Пороги — по glob, каждый на свой пакет; пороги других слоёв добавляют их задачи.
    coverage: {
      provider: "v8",
      include: ["packages/{calc,kernel}/src/**"],
      reporter: ["text-summary"],
      thresholds: {
        "packages/calc/src/**": { lines: 95, branches: 90 },
        "packages/kernel/src/**": { lines: 90, branches: 85 },
      },
    },
  },
});
