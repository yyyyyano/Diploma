// Опрос Telegram (TG-10, ARCHITECTURE §3): только в процессе `bot`, под консультативным замком Postgres (второй экземпляр
// ждёт и не опрашивает — иначе 409). Токен читается при каждом круге: смена в админке перезапускает только экземпляр `Bot`
// внутри процесса. Сообщения, пришедшие, пока система была выключена, Telegram отдаёт при старте (около суток, TG-10).
// Обработчик обновления не держит опрос: он ставит работу в очередь чата и возвращается.
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot } from "grammy";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { Logger } from "../../../../platform/logging/logger.ts";
import type { Secrets } from "../../../../platform/secrets/secrets.ts";
import type { Settings } from "../../../../platform/settings/settings.ts";
import type { UpdateHandler } from "../../application/ports.ts";
import { POLL_LOCK_RETRY_SEC, TELEGRAM_TOKEN } from "../../settings.ts";
import { acquirePollLock } from "../db/poll-lock.ts";
import { clearBotName, saveBotName } from "../db/telegram.repo.ts";
import { createBotApi, type GrammyApiOptions } from "./grammy-api.ts";
import { toIncoming } from "./normalize.ts";

export interface BotRuntimeDeps {
  readonly system: SystemDb;
  readonly secrets: Pick<Secrets, "reveal">;
  readonly settings: Pick<Settings, "get">;
  readonly log: Logger;
  readonly handler: UpdateHandler;
  readonly now: () => Date;
  /** Сборка бота для токена: в тестах — бот с готовой `botInfo` и записывающим трансформером (сети нет). */
  readonly makeBot?: (token: string) => Bot;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    // Сигнал уже подан — слушатель «abort» не сработает: ждать нечего (иначе остановка стоит весь срок паузы).
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

/** Бот для токена: auto-retry (429 → пауза и повтор) и обработчик, который только ставит работу в очередь чата. */
export function createBot(
  token: string,
  d: Pick<BotRuntimeDeps, "handler" | "log"> & {
    /** Скачивание файла Telegram (порт; в тестах — подмена без сети). */
    readonly fetchBytes?: GrammyApiOptions["fetchBytes"];
  },
  botInfo?: ConstructorParameters<typeof Bot>[1],
) {
  const bot = new Bot(token, botInfo);
  bot.api.config.use(autoRetry());
  const api = createBotApi({
    api: bot.api,
    token,
    log: d.log,
    ...(d.fetchBytes === undefined ? {} : { fetchBytes: d.fetchBytes }),
  });
  bot.use((ctx) => {
    const incoming = toIncoming(ctx.update);
    if (incoming !== undefined) void d.handler.handle(incoming, api);
    return Promise.resolve();
  });
  bot.catch((error) => {
    d.log.error({ err: error.error }, "telegram.update-failed");
  });
  return { bot, api };
}

export function createBotRuntime(d: BotRuntimeDeps) {
  const stopping = new AbortController();
  let loop: Promise<void> | undefined;

  /** Один сеанс: замок → getMe → опрос, пока не потерян замок, не сменили токен и не попросили остановиться. */
  async function session(token: string, retryMs: number): Promise<void> {
    const lock = await acquirePollLock(d.system, (error) =>
      d.log.warn({ err: error }, "telegram.lock-lost"),
    );
    if (lock === undefined) {
      d.log.info({ reason: "lock-busy" }, "telegram.waiting");
      return;
    }
    const bot = d.makeBot?.(token) ?? createBot(token, d).bot;
    const tokenChanged = (async () => {
      while (!stopping.signal.aborted) {
        await wait(retryMs, stopping.signal);
        if (stopping.signal.aborted) return;
        if ((await d.secrets.reveal(TELEGRAM_TOKEN)) !== token) return;
      }
    })();
    try {
      await bot.init();
      await saveBotName(d.system, bot.botInfo.username, d.now());
      d.log.info({ bot: bot.botInfo.username }, "telegram.started");
      const polling = bot.start({ allowed_updates: ["message", "callback_query"] });
      await Promise.race([polling, lock.lost, tokenChanged, onAbort(stopping.signal)]);
      await bot.stop();
      await polling;
      d.log.info({ reason: stopping.signal.aborted ? "stop" : "restart" }, "telegram.stopped");
    } catch (error) {
      // 401 (токен не тот) и 409 (кто-то ещё опрашивает) — не падение процесса: имя бота снимаем, повторим позже.
      d.log.warn({ err: error }, "telegram.poll-failed");
      await clearBotName(d.system);
    } finally {
      await lock.release();
    }
  }

  async function run(): Promise<void> {
    while (!stopping.signal.aborted) {
      const retryMs = (await d.settings.get(POLL_LOCK_RETRY_SEC)) * 1000;
      const token = await d.secrets.reveal(TELEGRAM_TOKEN);
      if (token === undefined) {
        await clearBotName(d.system);
        d.log.info({ reason: "no-token" }, "telegram.idle");
      } else await session(token, retryMs);
      await wait(retryMs, stopping.signal);
    }
  }

  return {
    /** Запустить опрос в фоне (процесс `bot`); повторный вызов — тот же цикл. */
    start(): void {
      loop ??= run().catch((error: unknown) => {
        d.log.error({ err: error }, "telegram.runtime-failed");
      });
    },
    /** Остановить опрос и дождаться, пока цикл завершится (замок отпущен). */
    async stop(): Promise<void> {
      stopping.abort();
      await loop;
    },
  };
}

function onAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export type BotRuntime = ReturnType<typeof createBotRuntime>;
