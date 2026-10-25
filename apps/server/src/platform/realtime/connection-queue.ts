// Очередь событий одного потока events.stream (NFR-21): сигнал — «перезапроси», поэтому два одинаковых сигнала в
// очереди не нужны. Ключ схлопывания — (type, entity, id): повтор заменяет значение на месте (у progress — свежая
// доля), место в очереди не меняется. Предел — QUEUE_LIMIT разных ключей; новый ключ сверх предела — отказ, и
// поток закрывается: клиент переподключится и перезапросит всё сам (это дешевле, чем копить память за медленным
// клиентом). Без таймеров и ввода-вывода.
import type { SiteEvent } from "@kosht/contract";

/** Разных событий в очереди одного потока. */
export const QUEUE_LIMIT = 1000;

export class ConnectionQueue {
  readonly #events = new Map<string, SiteEvent>();
  readonly #limit: number;

  constructor(limit: number = QUEUE_LIMIT) {
    this.#limit = limit;
  }

  /** Положить событие; false — очередь полна (повтор ключа места не требует и проходит всегда). */
  push(event: SiteEvent): boolean {
    const key = `${event.type}\u0000${event.entity}\u0000${event.id}`;
    if (!this.#events.has(key) && this.#events.size >= this.#limit) return false;
    this.#events.set(key, event);
    return true;
  }

  /** Самое старое событие (или undefined, если пусто). */
  take(): SiteEvent | undefined {
    for (const [key, event] of this.#events) {
      this.#events.delete(key);
      return event;
    }
    return undefined;
  }

  get size(): number {
    return this.#events.size;
  }
}
