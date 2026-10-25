// e2e сайта (ARCHITECTURE §12, CONSTRAINTS «Доступность»): Playwright в Chromium против настоящего стенда — api и
// worker на своей свежей базе (клон шаблона тестов) и своём порту 8150, сайт — сборка Vite --mode e2e (в ней есть
// витрина /dev/gallery, а в боевой нет), которую отдаёт сам api. Рабочие 8140, make dev (5173), vite preview (4173)
// и дев-база kosht не трогаются. Стенд — apps/server/src/entrypoints/__fixtures__/e2e-stack.ts: по SIGTERM он
// останавливает процессы и удаляет свою базу.
import { defineConfig, devices } from "@playwright/test";

export const E2E_PORT = 8150;

export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "retain-on-failure",
    locale: "ru-RU",
    timezoneId: "Europe/Minsk",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    cwd: "..",
    command:
      `cd apps/web && node_modules/.bin/vite build --mode e2e --outDir dist-e2e --emptyOutDir && ` +
      `cd ../.. && exec node apps/server/src/entrypoints/__fixtures__/e2e-stack.ts ${E2E_PORT} apps/web/dist-e2e`,
    url: `http://127.0.0.1:${E2E_PORT}/readyz`,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
  },
});
