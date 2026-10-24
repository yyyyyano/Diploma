// Тесты Vitest (ADR-0001, docs/ARCHITECTURE.md §12): unit — без БД, int — на настоящем Postgres (шаблонная
// база на тестовый файл). Проект web добавит T-008.
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
      {
        test: {
          // `x.int.test.ts`: своя база на файл — клон шаблона из боевых миграций (make test-int поднимает db).
          name: "int",
          include: ["{apps,packages,tooling}/**/*.int.test.ts"],
          exclude: ["**/node_modules/**", `${FIXTURES_DIR}/**`],
          globalSetup: ["apps/server/src/platform/db/__fixtures__/int-global-setup.ts"],
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
