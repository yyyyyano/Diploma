// Логи приложения (OBS-01, OBS-02, OBS-04, OBS-06, ADR-0010): pino, JSON-строка на событие. Сообщение —
// стабильный английский ключ события (`receipt.recognized`), данные — поля из белого списка (fields.ts); requestId,
// uid и source подмешиваются из контекста (context.ts). Данных в строке сообщения быть не может: ключ проверяется
// и типом, и при записи — не ключ заменяется на log.bad-key, сам текст не пишется.
// Файл на роль процесса — data/logs/<роль>.<гггг-ММ-дд>.<n>.log, ротация ежедневно, 14 файлов (pino-roll как поток
// в процессе: pino.transport() не переживает сборку в один .mjs, T-011). Лишние файлы роли удаляются и при открытии:
// pino-roll чистит только при ротации, а процесс, который перезапускают чаще раза в сутки, до неё не доживает.
import { once } from "node:events";
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { pino, type DestinationStream } from "pino";
import pinoRoll, { type RollStream } from "pino-roll";
import type { LogLevel } from "../config/config.ts";
import { currentLogContext } from "./context.ts";
import { pickFields, type LogFields } from "./fields.ts";

/** Роль процесса — имя файла лога. */
export type LogRole = "api" | "worker" | "bot" | "cli";

/** Ключ события: `^[a-z]+(\.[a-z0-9-]+)+$`. */
export const EVENT_KEY = /^[a-z]+(\.[a-z0-9-]+)+$/;

/** Ключ, которым заменяется неверный: сам неверный текст в лог не идёт (в нём могли быть данные). */
export const BAD_KEY = "log.bad-key";

type Split<S extends string> = S extends `${infer C}${infer Rest}` ? C | Split<Rest> : never;
type LowerChar = Split<"abcdefghijklmnopqrstuvwxyz">;
type KeyChar = LowerChar | Split<"0123456789-">;
/** Все символы S — из Allowed (true/false: never не годится — он «подходит» под любую проверку). */
type OnlyChars<S extends string, Allowed extends string> = S extends `${infer C}${infer Rest}`
  ? C extends Allowed
    ? OnlyChars<Rest, Allowed>
    : false
  : true;

/**
 * Литерал, похожий на ключ события: «слово.часть[.часть…]» из строчной латиницы, цифр и дефиса. Строку,
 * собранную в рантайме (`"вход " + email`), тип не пропускает: у неё тип string, а не литерал.
 */
export type EventKey<K extends string> = string extends K
  ? never
  : K extends `${infer Head}.${infer Tail}`
    ? Head extends ""
      ? never
      : OnlyChars<Head, LowerChar> extends true
        ? OnlyChars<Tail, KeyChar | "."> extends true
          ? K
          : never
        : never
    : never;

type LogMethod = <K extends string>(fields: LogFields, key: EventKey<K>) => void;

export interface Logger {
  readonly fatal: LogMethod;
  readonly error: LogMethod;
  readonly warn: LogMethod;
  readonly info: LogMethod;
  readonly debug: LogMethod;
  readonly trace: LogMethod;
}

export interface LoggerOptions {
  readonly role: LogRole;
  readonly level: LogLevel;
  readonly destination: DestinationStream;
}

/** Логгер поверх потока: файл (openLogFile) или память в тестах. */
export function createLogger(options: LoggerOptions): Logger {
  const base = pino(
    {
      level: options.level,
      base: { role: options.role },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      // Ошибку сериализует fields.ts; стандартный сериализатор pino записал бы message и stack как есть.
      serializers: { err: (value: unknown) => value },
      mixin: () => ({ ...currentLogContext() }),
    },
    options.destination,
  );
  const method =
    (level: LogLevel): LogMethod =>
    (fields, key) => {
      const text: string = key;
      if (EVENT_KEY.test(text)) {
        base[level](pickFields(fields), text);
      } else {
        base[level]({ ...pickFields(fields), badKeyLength: text.length }, BAD_KEY);
      }
    };
  return {
    fatal: method("fatal"),
    error: method("error"),
    warn: method("warn"),
    info: method("info"),
    debug: method("debug"),
    trace: method("trace"),
  };
}

/** Файлов лога на роль (OBS-06, ADR-0010): текущий и 13 прошлых. */
export const LOG_FILES_PER_ROLE = 14;

/**
 * Параметры pino-roll (OBS-06): ежедневно, права 0600. removeOtherLogFiles — счёт по всем файлам роли в папке, а не
 * только по созданным этим процессом (без него файлы прошлых запусков не удаляются никогда). pino-roll 4.0.0
 * (lib/utils.js, removeOldFiles) оставляет count файлов, считая новый, если он уже создан, — 13 или 14 вместе с ним.
 */
export function rollOptions(logDir: string, role: LogRole) {
  return {
    file: join(logDir, role),
    frequency: "daily",
    dateFormat: "yyyy-MM-dd",
    extension: ".log",
    limit: { count: LOG_FILES_PER_ROLE - 1, removeOtherLogFiles: true },
    mode: 0o600,
  } as const;
}

/** Файл лога роли в data/logs (папка 0700); закрывать — end() и ожидание «close» (досылает буфер). */
export async function openLogFile(logDir: string, role: LogRole): Promise<RollStream> {
  await mkdir(logDir, { recursive: true, mode: 0o700 });
  const stream = await pinoRoll(rollOptions(logDir, role));
  // Файл SonicBoom открывает асинхронно: имя текущего известно после «ready» (ошибка открытия — исключение здесь).
  if (stream.file === null) await once(stream, "ready");
  await pruneLogFiles(logDir, role, basename(stream.file ?? ""));
  return stream;
}

/** Удалить старые файлы роли сверх 14 (с текущим); файлы других ролей и чужие имена не трогаются; сбой — не ошибка. */
async function pruneLogFiles(logDir: string, role: LogRole, current: string): Promise<void> {
  const pattern = new RegExp(`^${role}\\.(\\d{4}-\\d{2}-\\d{2})\\.(\\d+)\\.log$`);
  const older = (await readdir(logDir))
    .filter((name) => name !== current)
    .flatMap((name) => {
      const match = pattern.exec(name);
      return match === null ? [] : [{ name, date: match[1] ?? "", number: Number(match[2]) }];
    })
    // Новые — вперёд: дата (строка гггг-ММ-дд сравнивается как дата), затем номер файла за день.
    .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  const extra = older.slice(LOG_FILES_PER_ROLE - 1);
  // Чистка не роняет запуск (как removeOldFiles у pino-roll): не удалённый файл (EACCES, каталог с тем же именем)
  // остаётся до следующего открытия или ротации. Логгера ещё нет — сбой не пишется.
  await Promise.allSettled(extra.map(async (file) => rm(join(logDir, file.name), { force: true })));
}

/** Закрыть файл лога, дослав буфер (завершение процесса, тесты). */
export async function closeLogFile(stream: RollStream): Promise<void> {
  await new Promise<void>((done) => {
    stream.once("close", () => done());
    stream.end();
  });
}

export type { RollStream };
