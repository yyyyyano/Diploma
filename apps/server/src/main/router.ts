// Дерево процедур сервера (ADR-0005, ARCHITECTURE §9): ветки модулей приходят из реестра корня композиции
// (`<модуль>Router(useCases)` из api/router.ts модуля, ключ — id в camelCase), платформенное (проба health, поток
// живых сигналов) подаёт сам корень. Пустая ветка или её отсутствие допустимы: модуль без процедур. Что дерево
// реализует контракт @kosht/contract целиком — ни больше, ни меньше, — проверяют тесты (router.contract.test.ts на
// дереве платформы, compose.int.test.ts на дереве всех модулей): ветки собираются из реестра, и типом это не
// выразить.
import { authed, publicProc, type ModuleRouter } from "../platform/http/procedures.ts";
import type { EventStreams } from "../platform/realtime/hub.ts";

export interface RouterDeps {
  /** Потоки events.stream: хаб platform/realtime (в api его кормит LISTEN). */
  readonly streams: EventStreams;
  /** Ветки модулей из реестра (main/registries.ts); нет — только платформенное. */
  readonly modules?: Readonly<Record<string, ModuleRouter>>;
}

export function createRouter(deps: RouterDeps) {
  const modules = deps.modules ?? {};

  /** Ветка контракта, общая с модулем (contract.system — и health платформы, и процедуры модуля system). */
  function shared<B extends ModuleRouter>(key: string, platform: B): B & ModuleRouter {
    const own = modules[key] ?? {};
    const clash = Object.keys(platform).find((name) => name in own);
    if (clash !== undefined) {
      throw new Error(`Процедура ${key}.${clash} объявлена и платформой, и модулем.`);
    }
    return { ...own, ...platform };
  }

  return {
    ...modules,
    system: shared("system", {
      // Проба «жив ли сервер» для сайта; доступна гостю (без сессии и БД).
      health: publicProc.system.health.handler(() => ({ status: "ok" as const })),
    }),
    events: shared("events", {
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
    }),
  };
}

export type Router = ReturnType<typeof createRouter>;
