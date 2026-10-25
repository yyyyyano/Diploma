// Запуски агента в памяти процесса api (CHAT-02, ARCHITECTURE §8.3, §6.6): запуск не привязан к соединению — поток
// ответа читает сам реестр и копит куски, а подписчики (вкладки) получают их с начала и дальше по мере генерации.
// Закрыли вкладку — уходит подписчик, запуск дописывает ответ (сохраняет его chat). Ключ — `householdId:runId`:
// «Стоп» чужого домохозяйства не найдёт запуск. При остановке процесса запуски доводятся в пределах срока, оставшиеся
// обрываются (ответ сохраняется оборванным).
import type { UIMessageChunk } from "ai";
import type { Logger } from "../../../platform/logging/logger.ts";

interface RunState {
  readonly controller: AbortController;
  readonly chunks: UIMessageChunk[];
  done: boolean;
  readonly finished: Promise<void>;
  readonly waiters: Set<() => void>;
}

export interface RunRegistry {
  /** Начать читать поток запуска; key — `householdId:runId`. */
  start(key: string, stream: ReadableStream<UIMessageChunk>, controller: AbortController): void;
  /** Поток кусков запуска с первого: закрытие потока (клиент ушёл) запуск не останавливает. */
  subscribe(key: string): ReadableStream<UIMessageChunk> | undefined;
  /** Остановить запуск («Стоп»); нет такого (чужой, законченный) — false. */
  stop(key: string): boolean;
  /** Сколько запусков идёт. */
  readonly size: number;
  /** Остановка процесса: дождаться запусков до graceMs, оставшиеся оборвать и дождаться их сохранения. */
  shutdown(graceMs: number): Promise<void>;
}

export function createRunRegistry(log: Logger): RunRegistry {
  /** Запуски по ключу — для «Стоп» и подписки; остановленный убирается сразу. */
  const runs = new Map<string, RunState>();
  /** Все незаконченные запуски (и остановленные, пока сохраняют ответ) — для остановки процесса. */
  const pending = new Set<RunState>();

  const wakeAll = (state: RunState) => {
    for (const wake of state.waiters) wake();
    state.waiters.clear();
  };

  async function consume(key: string, state: RunState, stream: ReadableStream<UIMessageChunk>) {
    try {
      for await (const chunk of stream) {
        state.chunks.push(chunk);
        wakeAll(state);
      }
    } catch (error) {
      // Ошибку запуска видит сайт куском error (без текста), а стек — лог.
      log.error({ err: error, code: "INTERNAL" }, "chat.run-failed");
      state.chunks.push({ type: "error", errorText: "INTERNAL" });
    } finally {
      state.done = true;
      if (runs.get(key) === state) runs.delete(key);
      pending.delete(state);
      wakeAll(state);
    }
  }

  return {
    start(key, stream, controller) {
      let resolve: () => void = () => {};
      const finished = new Promise<void>((done) => {
        resolve = done;
      });
      const state: RunState = { controller, chunks: [], done: false, finished, waiters: new Set() };
      runs.set(key, state);
      pending.add(state);
      void consume(key, state, stream).then(resolve);
    },
    subscribe(key) {
      const state = runs.get(key);
      if (state === undefined) return undefined;
      let index = 0;
      let cancelled = false;
      return new ReadableStream<UIMessageChunk>({
        async pull(controller) {
          while (!cancelled) {
            const chunk = state.chunks[index];
            if (chunk !== undefined) {
              index += 1;
              controller.enqueue(chunk);
              return;
            }
            if (state.done) {
              controller.close();
              return;
            }
            await new Promise<void>((wake) => state.waiters.add(wake));
          }
        },
        cancel() {
          // Клиент ушёл: перестаём ждать, запуск продолжается.
          cancelled = true;
          wakeAll(state);
        },
      });
    },
    stop(key) {
      const state = runs.get(key);
      if (state === undefined) return false;
      // Повторный «Стоп» того же запуска — NOT_FOUND: он уже остановлен, хотя ещё сохраняет ответ.
      runs.delete(key);
      state.controller.abort();
      return true;
    },
    get size() {
      return pending.size;
    },
    async shutdown(graceMs) {
      const all = [...pending];
      if (all.length === 0) return;
      let timer: NodeJS.Timeout | undefined;
      const grace = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), graceMs);
      });
      const outcome = await Promise.race([Promise.all(all.map((r) => r.finished)), grace]);
      clearTimeout(timer);
      if (outcome !== "timeout") return;
      log.warn({ count: pending.size }, "chat.runs-aborted");
      for (const state of pending) state.controller.abort();
      await Promise.all(all.map((r) => r.finished));
    },
  };
}
