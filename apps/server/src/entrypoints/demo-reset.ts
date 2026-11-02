// Точка входа `make demo-reset` (DEMO-03): конфигурация → лог в консоль → compose(api) → recreate → остановка. Данные — только
// демо-пользователя; реальные пользователи не затрагиваются. Вся логика — в main/demo-reset.ts.
import { compose } from "../main/compose.ts";
import { recreateDemoData } from "../main/demo-reset.ts";
import { loadConfig } from "../platform/config/config.ts";
import { createLogger } from "../platform/logging/logger.ts";

const config = loadConfig(process.env);
const log = createLogger({ role: "cli", level: config.logLevel, destination: process.stderr });
const app = await compose(config, "api", { log });
try {
  await app.startJobs();
  const report = await recreateDemoData(app);
  process.stdout.write(
    `Демо-данные пересозданы: операций ${String(report.operations)}, чеков ${String(report.receipts)}, лимитов ${String(report.limits)}, целей ${String(report.goals)}, недель итогов ${String(report.weeks)}.\n`,
  );
} finally {
  await app.close();
}
