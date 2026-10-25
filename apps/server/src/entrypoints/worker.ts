// Точка входа worker (ARCHITECTURE §3): фоновые задачи pg-boss (T-006). Пока только живёт: старт, миграции, лог и
// остановка. Вся жизнь процесса — в run.ts.
import { runProcess } from "./run.ts";

await runProcess("worker");
