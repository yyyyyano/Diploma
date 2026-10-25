// make log-find id=…: node log-find-cli.ts <папка логов> <requestId> — строки JSON в stdout (Makefile передаёт их
// pino-pretty). Нет строк — код 1 и подсказка в stderr.
import { existsSync } from "node:fs";
import { findByRequestId, REQUEST_ID } from "./log-find.ts";

const [logDir, requestId] = process.argv.slice(2);
if (logDir === undefined || requestId === undefined) {
  console.error("Использование: make log-find id=<requestId> [LOG_DIR=data/logs]");
  process.exitCode = 2;
} else if (!REQUEST_ID.test(requestId)) {
  console.error("id запроса: 8–64 символа из латиницы, цифр и дефиса (make log-find id=…).");
  process.exitCode = 2;
} else if (!existsSync(logDir)) {
  console.error(`Папки логов ${logDir} нет: сервер ещё не запускался (или укажите LOG_DIR=…).`);
  process.exitCode = 1;
} else {
  const lines = await findByRequestId(logDir, requestId);
  if (lines.length === 0) {
    console.error(`В ${logDir} нет строк с requestId ${requestId}.`);
    process.exitCode = 1;
  }
  for (const line of lines) process.stdout.write(`${line}\n`);
}
