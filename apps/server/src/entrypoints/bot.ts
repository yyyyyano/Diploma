// Точка входа bot (ARCHITECTURE §3): Telegram-бот, long polling (задача модуля telegram). Пока только живёт: старт,
// миграции, лог и остановка. Вся жизнь процесса — в run.ts.
import { runProcess } from "./run.ts";

await runProcess("bot");
