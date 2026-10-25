// Дерево процедур сервера (ADR-0005, ARCHITECTURE §9): реализация контракта @kosht/contract целиком — router()
// не компилируется, если хоть одна процедура контракта не реализована. Ветки модулей добавляют их задачи
// (`<модуль>Router(useCases)` из api/router.ts модуля, T-007 и далее).
import { once } from "node:events";
import type { SiteEvent } from "@kosht/contract";
import { authed, publicProc } from "../platform/http/procedures.ts";

/** Ждать, пока запрос или процесс не остановят. */
async function untilAborted(signal: AbortSignal): Promise<void> {
  if (!signal.aborted) await once(signal, "abort");
}

export const router = publicProc.router({
  system: {
    // Проба «жив ли сервер» для сайта; доступна гостю (без сессии и БД).
    health: publicProc.system.health.handler(() => ({ status: "ok" as const })),
  },
  events: {
    // Поток событий домохозяйства (NFR-21). Событий пока никто не публикует — публикация, NOTIFY и фильтр по
    // домохозяйству появятся с platform/events и platform/realtime (T-006), которые заменят этот обработчик. До тех
    // пор поток честно пуст: держит соединение, пока его не закрыл клиент или не начал останавливаться процесс
    // (SIGTERM не ждёт открытые потоки сайта 10 с).
    stream: authed.events.stream.handler(async function* ({ context, signal }) {
      const stop =
        signal === undefined
          ? context.shutdownSignal
          : AbortSignal.any([signal, context.shutdownSignal]);
      await untilAborted(stop);
      yield* [] as SiteEvent[];
    }),
  },
});
