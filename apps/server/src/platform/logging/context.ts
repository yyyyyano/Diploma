// Контекст лога (OBS-01, NFR-15): requestId, uid и source подмешиваются в каждую строку сами — из
// AsyncLocalStorage, а не из полей вызова. Так путь «сообщение в боте → задача → вызов модели» находится одним
// make log-find id=…, а подменить requestId полем записи нельзя (fields.ts его не пускает).
import { AsyncLocalStorage } from "node:async_hooks";

/** Откуда пришла работа: HTTP-запрос, задача, бот, запуск из командной строки. */
export type LogSource = "http" | "job" | "bot" | "cli" | "startup";

export interface LogContext {
  readonly requestId?: string;
  /** Внутренний id пользователя (OBS-04: не email). */
  readonly uid?: string;
  readonly source?: LogSource;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Выполнить fn в контексте; вложенный вызов дополняет внешний (uid появляется после входа). */
export function withLogContext<R>(context: LogContext, fn: () => R): R {
  const merged = { ...storage.getStore() };
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return storage.run(merged, fn);
}

/** Текущий контекст ({} вне запроса и задачи). */
export function currentLogContext(): LogContext {
  return storage.getStore() ?? {};
}
