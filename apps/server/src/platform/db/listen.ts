// Канал живых сигналов kosht_realtime (ADR-0008, ARCHITECTURE §5): единственное место, где сервер зовёт pg_notify и
// держит отдельное соединение pg.Client под LISTEN. Сигнал уходит запросом через переданный Drizzle — у ScopedDb
// внутри транзакции это её соединение: Postgres доставляет NOTIFY при COMMIT, а при откате (и ROLLBACK TO
// SAVEPOINT) — нет, поэтому «изменилось» не прилетает раньше данных и без них. Слушает канал только api: одно
// соединение на процесс (`kosht-api-listen`), его переподключает platform/realtime. Имя канала в SQL не
// склеивается из данных: в LISTEN — константа через escapeIdentifier, в pg_notify — параметр.
import { sql } from "drizzle-orm";
import pg from "pg";
import type { DbConfig } from "../config/config.ts";
import type { QueryDb } from "./audited.ts";
import { connectionOptions } from "./connection.ts";

/** Канал NOTIFY живых сигналов; сообщения — platform/realtime/message.ts. */
export const REALTIME_CHANNEL = "kosht_realtime";

/**
 * Пауза до первой TCP keepalive-пробы молчащего соединения LISTEN: без неё ОС ждёт часы, и полуоткрытое соединение
 * (база перезапущена, сеть Docker пересоздана) долго не замечается.
 */
const KEEPALIVE_DELAY_MS = 10_000;

/** Чем отправить сигнал: s.db (ScopedDb, в транзакции — tx.db) или SystemDb; запрос проходит аудитор SQL. */
export type NotifyDb = Pick<QueryDb, "execute">;

/** Отправить готовые сообщения канала по порядку, каждое — своим pg_notify. */
export async function notify(db: NotifyDb, payloads: readonly string[]): Promise<void> {
  for (const payload of payloads) {
    await db.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${payload})`);
  }
}

export interface ListenHandlers {
  /** Сообщение канала — сырой текст: проверяет схему получатель. */
  onNotification(payload: string): void;
  /** Соединение потеряно после успешного LISTEN (не при close()); вызывается один раз. */
  onLost(error: unknown): void;
}

export interface ListenConnection {
  /** Закрыть соединение; onLost после этого не вызывается. */
  close(): Promise<void>;
}

/** Открыть соединение и подписаться на канал; неудача — исключение, соединения не остаётся. */
export type ListenConnect = (handlers: ListenHandlers) => Promise<ListenConnection>;

/** Подключение LISTEN к базе config под именем applicationName (видно в pg_stat_activity). */
export function listenConnector(config: DbConfig, applicationName: string): ListenConnect {
  return async (handlers) => {
    const client = new pg.Client({
      ...connectionOptions(config),
      application_name: applicationName,
      keepAlive: true,
      keepAliveInitialDelayMillis: KEEPALIVE_DELAY_MS,
    });
    let listening = false;
    let closing = false;
    let lastError: unknown;
    // Ошибка сокета или сообщение сервера вне запроса (57P01 при pg_terminate_backend): соединение мертво —
    // закрываем его, а о потере сообщает событие end (оно приходит один раз).
    client.on("error", (error) => {
      lastError = error;
      void client.end();
    });
    client.on("end", () => {
      if (listening && !closing) handlers.onLost(lastError);
    });
    client.on("notification", (message) => {
      if (message.channel === REALTIME_CHANNEL && message.payload !== undefined) {
        handlers.onNotification(message.payload);
      }
    });
    try {
      await client.connect();
      await client.query(`listen ${client.escapeIdentifier(REALTIME_CHANNEL)}`);
    } catch (error) {
      closing = true;
      await client.end();
      throw error;
    }
    listening = true;
    return {
      async close() {
        closing = true;
        await client.end();
      },
    };
  };
}
