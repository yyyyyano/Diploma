// Процесс api с медленным маршрутом /slow — для теста корректной остановки по SIGTERM (processes.int.test.ts):
// боевой entrypoints/api.ts тестовыми маршрутами не нагружается. Когда запрос дошёл до обработчика, в stdout
// пишется строка «slow-started» — тест шлёт SIGTERM ровно в полёте запроса.
import { setTimeout as delay } from "node:timers/promises";
import { runProcess } from "../run.ts";

/** Сколько обработчик держит запрос: заметно меньше срока остановки (10 с), но больше, чем нужно тесту. */
const SLOW_MS = 1_500;

await runProcess("api", {
  routes: (app) => {
    app.get("/slow", async (c) => {
      process.stdout.write("slow-started\n");
      await delay(SLOW_MS);
      return c.json({ done: true });
    });
  },
});
