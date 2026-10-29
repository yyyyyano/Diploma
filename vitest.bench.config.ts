// Замеры времени (CONSTRAINTS.md «Бюджеты времени», `make bench`): файлы `*.bench.ts` рядом с кодом на настоящем
// Postgres (шаблонная база, как у int). Отдельный конфиг, а не проект общего: `make test` и `make check` замеров не
// гоняют — под нагрузкой параллельных тестов p95 врал бы, а бюджет проверяется на спокойной машине.
import { defineConfig } from "vitest/config";
import { FIXTURES_DIR } from "./tooling/architecture/rules.ts";

export default defineConfig({
  test: {
    name: "bench",
    include: ["{apps,packages}/**/*.bench.ts"],
    exclude: ["**/node_modules/**", `${FIXTURES_DIR}/**`],
    globalSetup: ["apps/server/src/platform/db/__fixtures__/int-global-setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // Замеры — по одному файлу за раз: параллельные файлы мешали бы друг другу.
    fileParallelism: false,
  },
});
