// Подключение к Postgres: адрес (DATABASE_URL, без пароля) и файл пароля (secrets/db_password) — из конфигурации
// (platform/config, loadDbConfig/loadConfig), пароль читается из файла здесь (NFR-16, ADR-0015). Проверки адреса
// повторяются: DbConfig может собрать и не загрузчик конфигурации, а пароль в адресе утекает в логи.
import { readFileSync } from "node:fs";
import pg from "pg";
import type { DbConfig } from "../config/config.ts";

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
    password: readPasswordFile(config.passwordFile),
  };
}

/** Пароль БД из файла (без перевода строки); нет файла или он пуст — подсказка make init. */
export function readPasswordFile(file: string): string {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      `Не прочитать пароль БД из ${file}: выполните make init (создаёт secrets/db_password и secrets/db_app_password).`,
      { cause: error },
    );
  }
  const password = text.trim();
  if (password === "")
    throw new Error(`Файл пароля БД ${file} пуст: удалите его и выполните make init.`);
  return password;
}

/**
 * Пул соединений; закрывает его тот, кто создал (pool.end()). applicationName — имя в pg_stat_activity
 * (`kosht-api`, `kosht-worker`, `kosht-bot`): по нему видно, чьи соединения открыты и закрылись ли они при остановке.
 */
export function createPool(
  config: DbConfig,
  options: { database?: string; max?: number; applicationName?: string } = {},
): pg.Pool {
  return new pg.Pool({
    ...connectionOptions(config, options.database),
    max: options.max ?? 10,
    ...(options.applicationName === undefined ? {} : { application_name: options.applicationName }),
  });
}

/** БД отвечает (/readyz): select 1; закрытый пул или недоступная база — исключение. */
export async function pingDb(pool: pg.Pool): Promise<void> {
  await pool.query("select 1");
}
