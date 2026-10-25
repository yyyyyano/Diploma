// Хаб потоков events.stream в api (NFR-21, ROLE-01, SEC-04): карта householdId → открытые потоки. Ключ потока —
// только scope его сессии (context.s.scope), а не сообщение канала и не вход запроса; сообщение канала лишь
// выбирает, в какую ячейку карты положить сигнал. Поэтому поток домохозяйства A не может получить сигнал B: в
// ячейке B его нет. У каждого потока своя очередь (ConnectionQueue): переполнение закрывает поток. Потоков одного
// пользователя — не больше STREAMS_PER_USER: девятый закрывает самый старый поток этого же пользователя (вкладки
// живут дольше, чем нужны). Поток заканчивается возвратом причины — oRPC шлёт её событием done, и клиент выходит
// из for await без ошибки, чтобы переподключиться и перезапросить данные.
import type { SiteEvent } from "@kosht/contract";
import type { Scope } from "@kosht/kernel";
import type { Logger } from "../logging/logger.ts";
import { ConnectionQueue, QUEUE_LIMIT } from "./connection-queue.ts";
import type { RealtimeMessage } from "./message.ts";

/** Потоков одного пользователя одновременно. */
export const STREAMS_PER_USER = 8;

/**
 * Почему поток закончился: closed — запрос закрыт или процесс останавливается; reconnect — LISTEN
 * переподключился (сигналы за время разрыва потеряны); overflow — очередь переполнена; replaced — пользователь
 * открыл больше STREAMS_PER_USER потоков; stopped — хаб остановлен.
 */
export type StreamEnd = "closed" | "reconnect" | "overflow" | "replaced" | "stopped";

/** Что нужно процедуре events.stream: поток событий домохозяйства scope до сигнала signal. */
export interface EventStreams {
  open(scope: Scope, signal: AbortSignal): AsyncGenerator<SiteEvent, StreamEnd>;
}

export interface RealtimeHub extends EventStreams {
  /** Сигнал канала — потокам домохозяйства из сообщения. */
  deliver(message: RealtimeMessage): void;
  /** Закрыть все открытые потоки. */
  closeAll(reason: StreamEnd): void;
  /** Открытых потоков (для тестов и диагностики). */
  readonly size: number;
}

export interface RealtimeHubDeps {
  readonly log: Logger;
  readonly queueLimit?: number;
  readonly streamsPerUser?: number;
}

interface Stream {
  readonly userId: string;
  readonly householdId: string;
  readonly queue: ConnectionQueue;
  end: StreamEnd | undefined;
  wake: (() => void) | undefined;
}

export function createRealtimeHub(deps: RealtimeHubDeps): RealtimeHub {
  const { log } = deps;
  const queueLimit = deps.queueLimit ?? QUEUE_LIMIT;
  const streamsPerUser = deps.streamsPerUser ?? STREAMS_PER_USER;
  const byHousehold = new Map<string, Set<Stream>>();
  /** Все потоки в порядке открытия: первый у пользователя — самый старый. */
  const all = new Set<Stream>();

  function remove(stream: Stream): void {
    all.delete(stream);
    const household = byHousehold.get(stream.householdId);
    household?.delete(stream);
    if (household?.size === 0) byHousehold.delete(stream.householdId);
  }

  function close(stream: Stream, reason: StreamEnd): void {
    if (stream.end !== undefined) return;
    stream.end = reason;
    remove(stream);
    stream.wake?.();
  }

  function register(scope: Scope): Stream {
    const own = [...all].filter((stream) => stream.userId === scope.userId);
    const oldest = own[0];
    if (oldest !== undefined && own.length >= streamsPerUser) {
      close(oldest, "replaced");
      log.info({ userId: scope.userId, limit: streamsPerUser }, "realtime.stream-replaced");
    }
    const stream: Stream = {
      userId: scope.userId,
      householdId: scope.householdId,
      queue: new ConnectionQueue(queueLimit),
      end: undefined,
      wake: undefined,
    };
    all.add(stream);
    const household = byHousehold.get(stream.householdId) ?? new Set<Stream>();
    household.add(stream);
    byHousehold.set(stream.householdId, household);
    return stream;
  }

  function events(message: RealtimeMessage): SiteEvent[] {
    const { type, entity, percent } = message;
    return message.ids.map((id) =>
      type === "progress"
        ? { type, entity, id, ...(percent === undefined ? {} : { percent }) }
        : { type, entity, id },
    );
  }

  return {
    async *open(scope, signal) {
      const stream = register(scope);
      const onAbort = () => close(stream, "closed");
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      try {
        for (;;) {
          if (stream.end !== undefined) return stream.end;
          const event = stream.queue.take();
          if (event !== undefined) {
            yield event;
            continue;
          }
          await new Promise<void>((resolve) => {
            stream.wake = resolve;
          });
          stream.wake = undefined;
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        remove(stream);
      }
    },

    deliver(message) {
      const streams = byHousehold.get(message.householdId);
      if (streams === undefined) return;
      const batch = events(message);
      // close() удаляет из множества текущий поток: обход Set это допускает (удалённые не посещаются).
      for (const stream of streams) {
        if (batch.every((event) => stream.queue.push(event))) {
          stream.wake?.();
        } else {
          close(stream, "overflow");
          log.warn({ userId: stream.userId, limit: queueLimit }, "realtime.stream-overflow");
        }
      }
    },

    closeAll(reason) {
      for (const stream of all) close(stream, reason);
    },

    get size() {
      return all.size;
    },
  };
}
