// e2e сайта (ARCHITECTURE §12, CONSTRAINTS «Доступность»): Playwright в Chromium по сборке Vite --mode e2e — в ней
// есть витрина /dev/gallery, а боевой нет. Сервер приложения в T-008 не нужен: витрина не ходит в /api (сервер
// на своей базе e2e поднимает T-009). Свой порт — 8150, чтобы не мешать make dev (5173) и vite preview (4173).
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
    cwd: "../apps/web",
    command:
      `node_modules/.bin/vite build --mode e2e && ` +
      `node_modules/.bin/vite preview --port ${E2E_PORT} --strictPort`,
    url: `http://127.0.0.1:${E2E_PORT}/dev/gallery`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
