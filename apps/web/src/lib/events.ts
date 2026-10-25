// Живые обновления (NFR-21, ARCHITECTURE §10.1): поток events.stream своего домохозяйства → TanStack Query.
// changed — данные изменились: запросы перезапрашиваются (в событии нет данных — только сигнал); progress — ход
// фоновой работы кладётся в кэш под progressQueryKey, экран читает его useQuery. Конец потока (event: done — сервер
// закрыл его сам: перезапуск, переполнение, другая вкладка) или ошибка → переподключение с паузой и, как поток
// снова открыт, перезапрос всех запросов: события за время разрыва потеряны. UNAUTHORIZED — сессии нет: поток
// не переподключается, его запустит заново каркас после входа.
import type { SiteEvent } from "@kosht/contract";
import { ORPCError } from "@orpc/client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { client as defaultClient, type ApiClient } from "./api.ts";

/** Ключ кэша хода фоновой работы: useQuery({ queryKey: progressQueryKey("receipt", id), … }). */
export function progressQueryKey(entity: string, id: string) {
  return ["events", "progress", entity, id] as const;
}

export interface Progress {
  /** Доля 0…100; нет — доля неизвестна. */
  readonly percent?: number;
}

/** Пауза перед попыткой N подряд: 1 с, 2 с, 4 с… не больше 30 с. */
export function retryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30_000);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface EventStreamOptions {
  readonly client: Pick<ApiClient, "events">;
  readonly queryClient: QueryClient;
  /** Остановка потока (уход со страницы, выход). */
  readonly signal: AbortSignal;
  /** Пауза перед переподключением (тесты подменяют, чтобы не ждать). */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function apply(event: SiteEvent, queryClient: QueryClient): void {
  if (event.type === "changed") {
    void queryClient.invalidateQueries();
    return;
  }
  const progress: Progress = event.percent === undefined ? {} : { percent: event.percent };
  queryClient.setQueryData(progressQueryKey(event.entity, event.id), progress);
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "UNAUTHORIZED";
}

/** Держит поток открытым, пока не остановят signal или сервер не скажет «нет сессии». */
export async function runEventStream(options: EventStreamOptions): Promise<void> {
  const { client, queryClient, signal, sleep = wait } = options;
  let attempt = 0;
  while (!signal.aborted) {
    try {
      const stream = await client.events.stream(undefined, { signal });
      if (attempt > 0) void queryClient.invalidateQueries();
      for await (const event of stream) {
        attempt = 0;
        apply(event, queryClient);
      }
    } catch (error) {
      if (signal.aborted || isUnauthorized(error)) return;
    }
    attempt += 1;
    await sleep(retryDelayMs(attempt), signal);
  }
}

/** Поток событий раздела пользователя: открыт, пока смонтирован каркас. */
export function useEventStream(client: Pick<ApiClient, "events"> = defaultClient): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const controller = new AbortController();
    void runEventStream({ client, queryClient, signal: controller.signal });
    return () => controller.abort();
  }, [client, queryClient]);
}
