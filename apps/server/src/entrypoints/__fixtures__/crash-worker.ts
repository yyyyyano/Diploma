// Процесс worker, который падает после старта, — для теста process.crashed (processes.int.test.ts): аргумент
// «exception» бросает исключение из таймера, «rejection» оставляет отказ промиса без обработчика.
import { runProcess } from "../run.ts";

const mode = process.argv[2];

// runProcess возвращается после process.started: падение — уже в работающем процессе.
await runProcess("worker");
setTimeout(() => {
  if (mode === "rejection") void Promise.reject(new Error("отказ без обработчика"));
  else throw new Error("исключение без обработчика");
}, 0);
