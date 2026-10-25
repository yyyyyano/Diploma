// Два слушателя процесса api (NFR-24, R40, ADR-0016): local (127.0.0.1:8140) открыт всегда, lan (0.0.0.0:8141)
// открывается и закрывается настройкой network.allow-lan без перезапуска. Каждому слушателю — своё приложение
// (createApp({ listener })): «это локальный вход» — свойство соединения, а не заголовков.
// Сверка с настройкой — раз в секунду: смена в админке этим же процессом (set сбрасывает кэш) видна за ≤ 1 с,
// записанная другим процессом — когда истечёт кэш настроек (5 с, SETTINGS_CACHE_MS): загрузки идут только на сверках,
// поэтому кэш, загруженный на сверке, истекает ровно на сверке через 5 с.
// Остановка (SIGTERM): перестать принимать соединения, закрыть простаивающие, дождаться запросов в полёте не дольше
// graceMs, затем оборвать оставшиеся.
import { getRequestListener } from "@hono/node-server";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Listen } from "../config/config.ts";
import type { Logger } from "../logging/logger.ts";
import type { ListenerName } from "./guard.ts";

/** Как часто сверяться с настройкой network.allow-lan. */
export const LAN_CHECK_MS = 1_000;

/** Как часто при остановке закрывать соединения, которые освободились после ответа (keep-alive). */
const IDLE_SWEEP_MS = 100;

type Fetch = (request: Request) => Response | Promise<Response>;

export interface ListenersOptions {
  readonly local: Listen;
  readonly lan: Listen;
  /** Обработчик запросов слушателя: app.fetch приложения createApp({ listener }). */
  readonly fetch: (listener: ListenerName) => Fetch;
  /** Открыт ли сетевой вход сейчас: settings.get(ALLOW_LAN). */
  readonly allowLan: () => Promise<boolean>;
  readonly log: Logger;
  readonly checkEveryMs?: number;
}

export interface Listeners {
  /** Открыть local (занят — ListenError), сверить lan и начать сверку раз в секунду. */
  start(): Promise<void>;
  /** Одна сверка lan с настройкой (по очереди: две сверки не перекрываются). */
  reconcile(): Promise<void>;
  /** Адрес открытого слушателя (порт 0 в тестах — настоящий порт отсюда). */
  address(listener: ListenerName): AddressInfo | undefined;
  /** Остановка: новые соединения не принимаются, запросы в полёте доводятся не дольше graceMs. */
  stop(graceMs: number): Promise<void>;
}

/** Слушатель не открылся: в тексте — переменная порта и адрес, чтобы было ясно, что поменять. */
export class ListenError extends Error {
  override readonly name = "ListenError";
}

const PORT_VARIABLE: Record<ListenerName, string> = {
  local: "LISTEN_LOCAL_PORT",
  lan: "LISTEN_LAN_PORT",
};

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "UNKNOWN";
}

export function createListeners(options: ListenersOptions): Listeners {
  const { log } = options;
  const servers = new Map<ListenerName, Server>();
  let queue: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  let stopping = false;

  async function open(listener: ListenerName): Promise<Server> {
    const { host, port } = options[listener];
    // Глобальные Request/Response не подменяются: процесс видит обычные веб-классы Node.
    const handle = getRequestListener(options.fetch(listener), { overrideGlobalObjects: false });
    const server = createServer((request, response) => {
      handle(request, response).catch((error: unknown) => {
        log.error({ err: error, listener }, "http.server-error");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    server.on("error", (error) => log.error({ err: error, listener }, "http.server-error"));
    servers.set(listener, server);
    log.info({ listener, port: (server.address() as AddressInfo).port }, "http.listening");
    return server;
  }

  async function check(): Promise<void> {
    if (stopping) return;
    let wanted: boolean;
    try {
      wanted = await options.allowLan();
    } catch (error) {
      log.warn({ err: error, setting: "network.allow-lan" }, "http.lan-check-failed");
      return;
    }
    const lan = servers.get("lan");
    if (wanted && lan === undefined) {
      try {
        await open("lan");
      } catch (error) {
        // Порт занят — процесс не падает: следующая сверка попробует снова.
        log.warn(
          { listener: "lan", port: options.lan.port, code: errorCode(error) },
          "http.lan-failed",
        );
      }
    } else if (!wanted && lan !== undefined) {
      // Сетевой вход выключили — обрываем и текущие соединения: доступ из сети прекращается сразу.
      servers.delete("lan");
      await closeServer(lan, 0);
      log.info({ listener: "lan" }, "http.closed");
    }
  }

  return {
    async start() {
      try {
        await open("local");
      } catch (error) {
        const { host, port } = options.local;
        const code = errorCode(error);
        const reason =
          code === "EADDRINUSE" ? "порт занят другой программой" : `не открыть (${code})`;
        throw new ListenError(
          `Локальный вход ${host}:${port}: ${reason} — освободите порт или задайте другой в ` +
            `${PORT_VARIABLE.local} (.env).`,
          { cause: error },
        );
      }
      await this.reconcile();
      timer = setInterval(() => {
        this.reconcile().catch((error: unknown) =>
          log.error({ err: error }, "http.lan-check-failed"),
        );
      }, options.checkEveryMs ?? LAN_CHECK_MS);
    },
    reconcile() {
      queue = queue.then(check);
      return queue;
    },
    address(listener) {
      const address = servers.get(listener)?.address();
      return address !== null && typeof address === "object" ? address : undefined;
    },
    async stop(graceMs) {
      stopping = true;
      clearInterval(timer);
      await queue;
      const open = [...servers.values()];
      servers.clear();
      await Promise.all(open.map(async (server) => closeServer(server, graceMs)));
    },
  };
}

/** Закрыть сервер: не принимать новых, закрывать освободившиеся соединения, через graceMs оборвать остальные. */
async function closeServer(server: Server, graceMs: number): Promise<void> {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  const sweep = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_MS);
  const deadline = setTimeout(() => server.closeAllConnections(), graceMs);
  try {
    await closed;
  } finally {
    clearInterval(sweep);
    clearTimeout(deadline);
  }
}
