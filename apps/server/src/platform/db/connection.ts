// Подключение к Postgres: адрес — из окружения (DATABASE_URL, без пароля), пароль — из файла secrets/db_password
// (NFR-16, ADR-0015). Окружение читается здесь, пока нет platform/config: T-005 перенесёт чтение в схему
// конфигурации, а эта функция будет получать уже проверенные значения.
import { readFileSync } from "node:fs";
import pg from "pg";

export interface DbConfig {
  /** Адрес вида postgres://пользователь@хост:порт/база — без пароля. */
  readonly url: string;
  /** Файл с паролем: в режиме «код на хосте» — secrets/db_password, в контейнере — /run/secrets/db_password. */
  readonly passwordFile: string;
}

const DEFAULT_URL = "postgres://kosht@127.0.0.1:5440/kosht";
const DEFAULT_PASSWORD_FILE = "secrets/db_password";

/** Настройки подключения из окружения; без переменных — значения make dev (compose.yaml, .env.example). */
export function dbConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DbConfig {
  return {
    url: env["DATABASE_URL"] || DEFAULT_URL,
    passwordFile: env["DB_PASSWORD_FILE"] || DEFAULT_PASSWORD_FILE,
  };
}

/**
 * Параметры pg без строки подключения: пароль не склеивается с адресом (строка с паролем легко утекает в лог
 * или текст ошибки), а пароль в самой DATABASE_URL отвергается — его место в файле.
 */
export function connectionOptions(config: DbConfig, database?: string): pg.PoolConfig {
  const url = new URL(config.url);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `DATABASE_URL: ожидается адрес postgres://…, получен протокол «${url.protocol}».`,
    );
  }
  if (url.password !== "") {
    throw new Error(
      "DATABASE_URL не должен содержать пароль (NFR-16): пароль читается из файла DB_PASSWORD_FILE " +
        "(по умолчанию secrets/db_password, его создаёт make init).",
    );
  }
  return {
    host: url.hostname,
    port: url.port === "" ? 5432 : Number(url.port),
    user: decodeURIComponent(url.username),
    database: database ?? decodeURIComponent(url.pathname.slice(1)),
    password: readPassword(config.passwordFile),
  };
}

function readPassword(file: string): string {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      `Не прочитать пароль БД из ${file}: выполните make init (создаёт secrets/db_password).`,
      { cause: error },
    );
  }
  const password = text.trim();
  if (password === "")
    throw new Error(`Файл пароля БД ${file} пуст: удалите его и выполните make init.`);
  return password;
}

/** Пул соединений; закрывает его тот, кто создал (pool.end()). */
export function createPool(
  config: DbConfig,
  options: { database?: string; max?: number } = {},
): pg.Pool {
  return new pg.Pool({ ...connectionOptions(config, options.database), max: options.max ?? 10 });
}
