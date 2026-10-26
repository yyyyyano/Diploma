// Тесты Vitest (ADR-0001, docs/ARCHITECTURE.md §12): unit — без БД, int — на настоящем Postgres (шаблонная
// база на тестовый файл), web — сайт в jsdom (Testing Library + MSW) с конфигом Vite сайта.
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
          exclude: ["**/node_modules/**", "**/*.int.test.ts", "apps/web/**", `${FIXTURES_DIR}/**`],
        },
      },
      {
        test: {
          // `x.int.test.ts`: своя база на файл — клон шаблона из боевых миграций (make test-int поднимает db).
          name: "int",
          include: ["{apps,packages,tooling}/**/*.int.test.ts"],
          exclude: ["**/node_modules/**", `${FIXTURES_DIR}/**`],
          globalSetup: ["apps/server/src/platform/db/__fixtures__/int-global-setup.ts"],
          // Стабильность make check (T-011): int идёт вместе с unit и web, и под этой нагрузкой клон базы в beforeAll и
          // запросы к Postgres ждут дольше умолчаний Vitest (5 с на тест, 10 с на хук). Сроки — с запасом: скорость
          // здесь не проверяется, бюджеты — у своих тестов со своими сроками.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // Сайт: тот же Vite-конфиг (React, генератор маршрутов), DOM — jsdom, сеть — только MSW (ADR-0013).
        extends: "./apps/web/vite.config.ts",
        root: "./apps/web",
        test: {
          name: "web",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}", "*.test.ts"],
          setupFiles: ["src/test/setup.ts"],
          // CSS-модули компонентов — с читаемыми именами классов: тест видит тон («warn») и вид («tabular»).
          css: { include: [/\.module\.css$/], modules: { classNameStrategy: "non-scoped" } },
        },
      },
    ],
    // Покрытие (CONSTRAINTS.md «Пороги с проверкой»): считается в `make test` (`vitest run --coverage`), не в
    // `check-quick`. Пороги — по glob, каждый на свой пакет; пороги других слоёв добавляют их задачи.
    coverage: {
      provider: "v8",
      include: ["packages/{calc,kernel}/src/**", "apps/server/src/**/*.repo.ts"],
      // json-summary — для базы покрытия (tooling/checks/coverage-baseline.mjs, coverage/coverage-summary.json).
      reporter: ["text-summary", "json-summary"],
      thresholds: {
        "packages/calc/src/**": { lines: 95, branches: 90 },
        "packages/kernel/src/**": { lines: 90, branches: 85 },
        // Аудитор SQL срабатывает только на выполненных запросах: невыполненный запрос репозитория не проверен.
        "apps/server/src/**/*.repo.ts": { lines: 90 },
      },
    },
  },
});
