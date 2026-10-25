// Дерево процедур сервера (ADR-0005, ARCHITECTURE §9): реализация контракта @kosht/contract целиком — router()
// не компилируется, если хоть одна процедура контракта не реализована. Ветки модулей добавляют их задачи
// (`<модуль>Router(useCases)` из api/router.ts модуля, T-007 и далее). Платформенное (потоки живых сигналов)
// подаёт корень композиции.
import { authed, publicProc } from "../platform/http/procedures.ts";
import type { EventStreams } from "../platform/realtime/hub.ts";

export interface RouterDeps {
  /** Потоки events.stream: хаб platform/realtime (в api его кормит LISTEN). */
  readonly streams: EventStreams;
}

export function createRouter(deps: RouterDeps) {
  return publicProc.router({
    system: {
      // Проба «жив ли сервер» для сайта; доступна гостю (без сессии и БД).
      health: publicProc.system.health.handler(() => ({ status: "ok" as const })),
    },
    events: {
      // Поток сигналов домохозяйства (NFR-21). Домохозяйство — только из сессии (context.s.scope), не из входа.
      // Поток длится, пока клиент не закрыл запрос, процесс не начал останавливаться (SIGTERM не ждёт открытые
      // потоки сайта 10 с) или хаб не закрыл его сам; конец — событие done с причиной: клиент выходит из
      // for await без ошибки, переподключается и перезапрашивает данные.
      stream: authed.events.stream.handler(({ context, signal }) => {
        const stop =
          signal === undefined
            ? context.shutdownSignal
            : AbortSignal.any([signal, context.shutdownSignal]);
        return deps.streams.open(context.s.scope, stop);
      }),
    },
  });
}

export type Router = ReturnType<typeof createRouter>;
