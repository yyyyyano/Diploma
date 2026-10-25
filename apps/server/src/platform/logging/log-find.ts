// make log-find id=… (OBS-01, OBS-06): все строки логов всех ролей с этим requestId, по времени — путь запроса
// от HTTP или бота через задачи до вызова модели. Читает файлы <роль>.<гггг-ММ-дд>.<n>.log построчно (файл — до
// нескольких десятков МБ, целиком в память не грузится); строка не JSON — пропускается.
import { createReadStream, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Файлы логов pino-roll (logger.ts): роль, дата, номер. */
export const LOG_FILE = /^[a-z]+\.\d{4}-\d{2}-\d{2}\.\d+\.log$/;

/** Формат requestId, который принимает сервер (T-059: x-request-id клиента — по этому же шаблону). */
export const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Строки лога с requestId по возрастанию времени; неверный id — RangeError. */
export async function findByRequestId(logDir: string, requestId: string): Promise<string[]> {
  if (!REQUEST_ID.test(requestId)) {
    throw new RangeError(
      "id запроса: 8–64 символа из латиницы, цифр и дефиса (make log-find id=…).",
    );
  }
  const found: { time: string; line: string }[] = [];
  const files = readdirSync(logDir).filter((file) => LOG_FILE.test(file));
  for (const file of files.toSorted()) {
    const lines = createInterface({ input: createReadStream(join(logDir, file), "utf8") });
    for await (const line of lines) {
      // Быстрый отсев до разбора JSON: id без спецсимволов, в JSON он стоит как есть.
      if (!line.includes(requestId)) continue;
      const entry = parse(line);
      if (entry?.["requestId"] === requestId) {
        found.push({ time: typeof entry["time"] === "string" ? entry["time"] : "", line });
      }
    }
  }
  return found.toSorted((a, b) => a.time.localeCompare(b.time)).map((item) => item.line);
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    // Обрезанная последняя строка (процесс упал при записи) — не JSON: пропускаем, это не ошибка поиска.
    return undefined;
  }
}
