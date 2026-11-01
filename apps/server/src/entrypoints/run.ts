// Жизнь процесса (ARCHITECTURE §3, ADR-0015): конфигурация → лог → compose() → старт роли → ожидание SIGTERM/SIGINT
// → корректная остановка. Точки входа api.ts, worker.ts, bot.ts — тонкие обёртки над runProcess.
// Остановка: process.stopping → api перестаёт принимать соединения, закрывает простаивающие и доводит запросы в
// полёте (не дольше 80 % срока), долгие потоки сайта завершаются сигналом остановки → LISTEN закрыт без
// переподключения (realtime.stopped, только api) → очередь задач остановлена
// (обработчики worker доводятся не дольше 8 с) → пул закрыт → process.stopped →
// лог дописан на диск → код 0. Не уложились в срок (10 с) — process.stop-timeout и код 1: Docker и make не ждут
// зависший процесс вечно. Сигнал во время старта (миграции под блокировкой) не убивает процесс посреди работы: старт
// доводится, роль не запускается, остановка — та же (process.stopped, код 0). Необработанное исключение или отказ
// промиса — process.crashed со стеком, лог дописан, код 1 (OBS-05: причина падения видна в make logs).
import { join } from "node:path";
import { compose, type Composition, type ProcessRole } from "../main/compose.ts";
import { ConfigError, loadConfig, type AppConfig } from "../platform/config/config.ts";
import { AppRoleError } from "../platform/db/roles.ts";
import { createApiHandler } from "../platform/http/api.ts";
import { createApp, type HttpApp } from "../platform/http/app.ts";
import { BODY_LIMIT, UPLOAD_BODY_LIMIT } from "../platform/http/body-limit.ts";
import { createListeners, ListenError } from "../platform/http/listeners.ts";
import { RealtimeStartError } from "../platform/realtime/listener.ts";
import { withLogContext } from "../platform/logging/context.ts";
import {
  closeLogFile,
  createLogger,
  openLogFile,
  type Logger,
  type RollStream,
} from "../platform/logging/logger.ts";

/** Срок корректной остановки (ADR-0015): дольше — код 1. */
export const STOP_TIMEOUT_MS = 10_000;

/** Доля срока, которую api ждёт запросы в полёте, прежде чем оборвать их (остаток — пулу и логу). */
const GRACE_SHARE = 0.8;

export interface RunOptions {
  /** Маршруты процесса api сверх платформы (до статики сайта). */
  readonly routes?: (app: HttpApp) => void;
  /** Подготовить собранный процесс до старта роли (тестовые фикстуры: источник сессий и т. п.). */
  readonly setup?: (composition: Composition) => void;
  readonly stopTimeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

/** Запущенная роль: как её остановить. */
interface Running {
  stop(): Promise<void>;
}

export interface ShutdownSteps {
  readonly log: Logger;
  /** Остановить роль и закрыть пул. */
  stop(): Promise<void>;
  /** Дописать лог на диск. */
  closeLog(): Promise<void>;
  exit(code: number): void;
}

/** Остановка в срок: process.stopped и код 0; ошибка или дольше timeoutMs — код 1. */
export async function shutdown(steps: ShutdownSteps, timeoutMs: number): Promise<void> {
  const { log } = steps;
  log.info({ ms: timeoutMs }, "process.stopping");
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  let code = 0;
  try {
    const result = await Promise.race([steps.stop().then(() => "stopped" as const), timeout]);
    if (result === "timeout") {
      code = 1;
      log.error({ ms: timeoutMs }, "process.stop-timeout");
    } else {
      log.info({}, "process.stopped");
    }
  } catch (error) {
    code = 1;
    log.error({ err: error }, "process.stop-failed");
  } finally {
    clearTimeout(timer);
  }
  try {
    await steps.closeLog();
  } finally {
    steps.exit(code);
  }
}

export type CrashSource = "uncaughtException" | "unhandledRejection";

/** Падение процесса: process.crashed со стеком, лог дописан на диск, код 1. */
export async function crash(
  steps: Omit<ShutdownSteps, "stop">,
  error: unknown,
  source: CrashSource,
): Promise<void> {
  try {
    steps.log.fatal({ err: error, reason: source }, "process.crashed");
    await steps.closeLog();
  } finally {
    steps.exit(1);
  }
}

/** Вызвать fn один раз: лог закрывают и остановка, и падение, а поток после end второй раз не закрывается. */
function once(fn: () => Promise<void>): () => Promise<void> {
  let result: Promise<void> | undefined;
  return () => (result ??= fn());
}

async function startRole(
  app: Composition,
  options: RunOptions,
  timeoutMs: number,
): Promise<Running> {
  // Очередь — до слушателей: процедуры api ставят задачи сразу; worker обрабатывает их и ведёт расписания.
  await app.startJobs();
  await app.startModules();
  if (app.role !== "api") {
    // Опрос Telegram у bot — модуль telegram (`start.bot`, T-052), задачи worker — из реестров модулей (T-007): процесс
    // держит явный таймер, а не таймеры очереди или пул (простаивающие соединения закрываются).
    const keepAlive = setInterval(() => {}, 60_000);
    return {
      async stop() {
        clearInterval(keepAlive);
        await app.close();
      },
    };
  }
  const shutdownSignal = new AbortController();
  const handler = createApiHandler(app.router, app.log);
  const { config, log } = app;
  const listeners = createListeners({
    local: config.listeners.local,
    lan: config.listeners.lan,
    allowLan: () => app.allowLan(),
    log,
    fetch: (listener) =>
      createApp({
        listener,
        trustedOrigins: config.trustedOrigins,
        log,
        ready: () => app.ready(),
        api: {
          handler,
          session: (headers) => app.session(headers),
          shutdownSignal: shutdownSignal.signal,
          bodyLimit: () => app.settings.get(BODY_LIMIT),
          uploadBodyLimit: () => app.settings.get(UPLOAD_BODY_LIMIT),
        },
        webDistDir: config.webDistDir,
        ...(options.routes === undefined ? {} : { routes: options.routes }),
      }).fetch,
  });
  await listeners.start();
  return {
    async stop() {
      shutdownSignal.abort();
      await listeners.stop(Math.floor(timeoutMs * GRACE_SHARE));
      await app.close();
    },
  };
}

/** Сообщение для человека в консоль: только о понятных сбоях запуска (тексты без значений переменных). */
function startupMessage(error: unknown): string | undefined {
  return error instanceof ConfigError ||
    error instanceof ListenError ||
    error instanceof AppRoleError ||
    error instanceof RealtimeStartError
    ? error.message
    : undefined;
}

export async function runProcess(role: ProcessRole, options: RunOptions = {}): Promise<void> {
  const timeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  let config: AppConfig;
  try {
    config = loadConfig(options.env ?? process.env);
  } catch (error) {
    process.stderr.write(`${startupMessage(error) ?? "Не удалось прочитать конфигурацию."}\n`);
    process.exit(1);
  }
  const stream: RollStream = await openLogFile(join(config.dataDir, "logs"), role);
  const log = createLogger({ role, level: config.logLevel, destination: stream });
  const closeLog = once(() => closeLogFile(stream));
  const exit = (code: number) => process.exit(code);

  let crashed = false;
  const onCrash = (source: CrashSource) => (error: unknown) => {
    if (crashed) return;
    crashed = true;
    void crash({ log, closeLog, exit }, error, source);
  };
  process.on("uncaughtException", onCrash("uncaughtException"));
  process.on("unhandledRejection", onCrash("unhandledRejection"));

  // Сигнал до конца старта только запоминается: остановка начнётся, когда старт доведён (или не удался).
  let stopping = false;
  let running: Running | undefined;
  const stop = (current: Running) =>
    shutdown({ log, stop: () => current.stop(), closeLog, exit }, timeoutMs);
  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    if (running === undefined) log.info({ role }, "process.stop-requested");
    else void stop(running);
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  let composition: Composition | undefined;
  try {
    running = await withLogContext({ source: "startup" }, async () => {
      const app = await compose(config, role, { log });
      composition = app;
      // Остановку попросили во время миграций — роль не запускаем: закрыть есть что только у compose().
      if (stopping) return { stop: () => app.close() };
      options.setup?.(app);
      return startRole(app, options, timeoutMs);
    });
  } catch (error) {
    log.fatal({ err: error }, "process.start-failed");
    process.stderr.write(
      `${startupMessage(error) ?? `Процесс ${role} не запустился — подробности: make logs.`}\n`,
    );
    await composition?.close().catch((closeError: unknown) => {
      log.error({ err: closeError }, "db.close-failed");
    });
    await closeLog();
    process.exit(1);
  }
  if (stopping) {
    await stop(running);
    return;
  }
  log.info({ role }, "process.started");
}
