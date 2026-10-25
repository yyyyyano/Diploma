// Конфигурация окружения (ARCHITECTURE §9, ADR-0015): переменные проверяются Zod-схемой при старте, неверная —
// падение с именем переменной и ожиданием. process.env читают только этот файл и точки входа (тест
// env-readers.test.ts). Значения переменных в текст ошибки не попадают: в DATABASE_URL или ключе API может быть
// секрет (NFR-16). Пустая строка считается «не задано» — так ведёт себя Compose с `${VAR:-}`.
// Настройки, которые меняет админ (часовой пояс, SMTP, ключи), — не здесь, а в platform/settings и platform/secrets:
// им конфигурация передаёт только чтение переменной по имени (EnvLookup) для приоритета «админка > env > умолчание».
import { resolve } from "node:path";
import { z } from "zod";
import { MasterKey } from "./master-key.ts";

/** Подключение к Postgres: адрес без пароля и файл с паролем (NFR-16). */
export interface DbConfig {
  /** Адрес вида postgres://пользователь@хост:порт/база — без пароля. */
  readonly url: string;
  /** Файл с паролем: в режиме «код на хосте» — secrets/db_password, в контейнере — /run/secrets/db_password. */
  readonly passwordFile: string;
}

export interface Listen {
  readonly host: string;
  readonly port: number;
}

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Имя переменной окружения: только заглавные латинские буквы, цифры и «_». */
export type EnvName = string;

/** Значение переменной по имени — для defineSetting/defineSecret (приоритет «админка > env > умолчание»). */
export type EnvLookup = (name: EnvName) => string | undefined;

export interface AppConfig {
  readonly db: DbConfig;
  /** Два слушателя (NFR-24, R40): local — этот компьютер, lan — сеть (открывается настройкой, T-059). */
  readonly listeners: { readonly local: Listen; readonly lan: Listen };
  /** Origin, которым доверяют изменяющие запросы сверх своего Host (T-059). */
  readonly trustedOrigins: readonly string[];
  /** Корень данных запуска: data/logs, data/files… — абсолютный путь. */
  readonly dataDir: string;
  readonly logLevel: LogLevel;
  readonly masterKey: MasterKey;
  readonly env: EnvLookup;
}

/** Ошибка конфигурации: в тексте — имя переменной и ожидание, без значения. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** Пустая строка — как отсутствие переменной. */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

const port = (fallback: number) =>
  optional(
    z
      .string()
      .regex(/^\d{1,5}$/, { error: "ожидается целое число 0…65535" })
      .transform(Number)
      .pipe(z.number().max(65_535, { error: "ожидается целое число 0…65535" }))
      .default(fallback),
  );

const ip = (fallback: string) =>
  optional(
    z
      .union([z.ipv4(), z.ipv6()], { error: "ожидается IP-адрес (например 127.0.0.1 или ::1)" })
      .default(fallback),
  );

const path = (fallback: string, what: string) =>
  optional(z.string({ error: `ожидается путь к ${what}` }).default(fallback));

const POSTGRES_URL =
  "ожидается адрес postgres://пользователь@хост:порт/база без пароля (пароль — в файле DB_PASSWORD_FILE)";

const DbEnv = z.object({
  DATABASE_URL: optional(
    z
      .url({ protocol: /^postgres(ql)?$/, error: POSTGRES_URL })
      .refine((url) => !URL.canParse(url) || new URL(url).password === "", {
        error: POSTGRES_URL,
      })
      .default("postgres://kosht@127.0.0.1:5440/kosht"),
  ),
  DB_PASSWORD_FILE: path("secrets/db_password", "файлу пароля БД"),
});

const ORIGIN = "ожидаются origin через запятую: http(s)://хост[:порт] без пути";

const AppEnv = DbEnv.extend({
  LISTEN_LOCAL_HOST: ip("127.0.0.1"),
  LISTEN_LOCAL_PORT: port(8140),
  LISTEN_LAN_HOST: ip("0.0.0.0"),
  LISTEN_LAN_PORT: port(8141),
  TRUSTED_ORIGINS: optional(
    z
      .string()
      .transform((text) =>
        text
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item !== ""),
      )
      .pipe(z.array(z.string().refine(isOrigin, { error: ORIGIN })))
      .default([]),
  ),
  DATA_DIR: path("data", "папке данных"),
  MASTER_KEY_FILE: path("secrets/master.key", "файлу мастер-ключа"),
  LOG_LEVEL: optional(
    z.enum(LOG_LEVELS, { error: `ожидается одно из: ${LOG_LEVELS.join(", ")}` }).default("info"),
  ),
});

/** Все переменные схемы — сверяются с .env.example (там каждая с умолчанием и комментарием). */
export const CONFIG_VARIABLES: readonly string[] = Object.keys(AppEnv.shape);

function isOrigin(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const url = new URL(text);
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin === text;
}

type Env = Readonly<Record<string, string | undefined>>;

function parse<T extends z.ZodType>(schema: T, env: Env): z.output<T> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  // Имя — первый элемент пути: у списка (TRUSTED_ORIGINS.0) важна переменная, а не номер элемента.
  const lines = result.error.issues.map((issue) => `  ${String(issue.path[0])}: ${issue.message}`);
  throw new ConfigError(
    `Переменные окружения не прошли проверку (.env, образец — .env.example):\n${[...new Set(lines)].join("\n")}`,
  );
}

/**
 * Только подключение к БД — для make migrate и globalSetup тестов: мастер-ключ им не нужен, и без secrets/master.key
 * миграции и тесты работают.
 */
export function loadDbConfig(env: Env = process.env): DbConfig {
  const parsed = parse(DbEnv, env);
  return { url: parsed.DATABASE_URL, passwordFile: parsed.DB_PASSWORD_FILE };
}

/** Вся конфигурация процесса; нет или не 32 байта мастер-ключа — ConfigError с подсказкой make init. */
export function loadConfig(env: Env = process.env): AppConfig {
  const parsed = parse(AppEnv, env);
  const snapshot = new Map(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return {
    db: { url: parsed.DATABASE_URL, passwordFile: parsed.DB_PASSWORD_FILE },
    listeners: {
      local: { host: parsed.LISTEN_LOCAL_HOST, port: parsed.LISTEN_LOCAL_PORT },
      lan: { host: parsed.LISTEN_LAN_HOST, port: parsed.LISTEN_LAN_PORT },
    },
    trustedOrigins: parsed.TRUSTED_ORIGINS,
    dataDir: resolve(parsed.DATA_DIR),
    logLevel: parsed.LOG_LEVEL,
    masterKey: readMasterKey(parsed.MASTER_KEY_FILE),
    env: (name) => {
      if (!ENV_NAME.test(name)) {
        throw new RangeError(`Имя переменной окружения «${name}»: только A–Z, 0–9 и _.`);
      }
      const value = snapshot.get(name);
      return value === "" ? undefined : value;
    },
  };
}

function readMasterKey(file: string): MasterKey {
  try {
    return MasterKey.fromFile(file);
  } catch (error) {
    const reason =
      error instanceof RangeError
        ? `${error.message} — удалите файл и выполните make init`
        : "файл не прочитан — выполните make init (создаёт 32 случайных байта)";
    throw new ConfigError(`MASTER_KEY_FILE (${file}): ${reason}.`, { cause: error });
  }
}
