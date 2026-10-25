// Слушатель канала kosht_realtime в api (ADR-0008, NFR-21): одно соединение LISTEN на процесс. Первое подключение —
// часть старта: без него живых сигналов нет, и процесс не стартует (RealtimeStartError). Потом соединение может
// пропасть (перезапуск базы, pg_terminate_backend) — переподключение с паузой 0,2 с, ×2, не больше 5 с; пока
// соединения нет, сигналы теряются, поэтому после каждого успешного LISTEN зовётся onReady (хаб закрывает потоки,
// клиент переподключается и перезапрашивает данные). Входящее сообщение проверяется схемой; неверное — в лог
// realtime.bad-message без текста (OBS-04). stop() — без переподключения и без открытого соединения.
import type { ListenConnect, ListenConnection } from "../db/listen.ts";
import type { Logger } from "../logging/logger.ts";
import { decodeSignal, type RealtimeMessage } from "./message.ts";

/** Первая пауза переподключения и её потолок. */
export const RECONNECT_FIRST_MS = 200;
export const RECONNECT_MAX_MS = 5_000;

/** Пауза перед попыткой attempt (0 — первая после потери): 0,2 → 0,4 → 0,8 → 1,6 → 3,2 → 5 → 5 … с. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_FIRST_MS * 2 ** attempt, RECONNECT_MAX_MS);
}

/** Первое подключение LISTEN не удалось: текст — для консоли при старте, без значений из конфигурации. */
export class RealtimeStartError extends Error {
  constructor(cause: unknown) {
    super(
      "Живые сигналы не подключились к Postgres (LISTEN kosht_realtime): проверьте, что база доступна " +
        "(make db-up); подробности — make logs.",
      { cause },
    );
    this.name = "RealtimeStartError";
  }
}

export interface RealtimeListenerDeps {
  readonly connect: ListenConnect;
  readonly log: Logger;
  /** Сообщение канала прошло схему. */
  onMessage(message: RealtimeMessage): void;
  /** LISTEN установлен — при старте и после каждого переподключения. */
  onReady(): void;
  /** Соединение потеряно (до переподключения сигналы не доходят). */
  onLost?(): void;
}

export interface RealtimeListener {
  /** Первое подключение; неудача — RealtimeStartError. */
  start(): Promise<void>;
  /** Не переподключаться, закрыть соединение (и то, что открывалось в этот момент); realtime.stopped в лог. */
  stop(): Promise<void>;
}

export function createRealtimeListener(deps: RealtimeListenerDeps): RealtimeListener {
  const { log } = deps;
  let connection: ListenConnection | undefined;
  let connecting: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let attempt = 0;
  let stopped = false;

  const handlers = {
    onNotification(payload: string) {
      const message = decodeSignal(payload);
      if (message === undefined) {
        log.warn({}, "realtime.bad-message");
        return;
      }
      deps.onMessage(message);
    },
    onLost(error: unknown) {
      connection = undefined;
      if (stopped) return;
      log.warn({ err: error }, "realtime.lost");
      deps.onLost?.();
      schedule();
    },
  };

  async function connectOnce(): Promise<void> {
    const opened = await deps.connect(handlers);
    if (stopped) {
      await opened.close();
      return;
    }
    connection = opened;
    log.info({ attempt }, "realtime.listening");
    attempt = 0;
    deps.onReady();
  }

  function schedule(): void {
    const ms = reconnectDelayMs(attempt);
    attempt += 1;
    timer = setTimeout(() => {
      timer = undefined;
      connecting = connectOnce()
        .catch((error: unknown) => {
          log.warn({ err: error, attempt, ms }, "realtime.reconnect-failed");
          if (!stopped) schedule();
        })
        .finally(() => {
          connecting = undefined;
        });
    }, ms);
  }

  return {
    async start() {
      try {
        await connectOnce();
      } catch (error) {
        throw new RealtimeStartError(error);
      }
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await connecting;
      await connection?.close();
      connection = undefined;
      log.info({}, "realtime.stopped");
    },
  };
}
