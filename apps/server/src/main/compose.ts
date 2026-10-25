// Корень композиции (ARCHITECTURE §3): все три процесса — api, worker, bot — собираются одной функцией. Порядок:
// пул владельца (одно соединение kosht-<роль>-migrate) → миграции, схема очереди pgboss и выдача прав роли приложения
// под pg_advisory_lock (до слушателей: /readyz = «БД отвечает») → пул владельца закрыт → пул роли приложения
// (kosht-<роль>, ADR-0020) и проверка, что у неё нет лишних прав → платформа (часы, настройки, реестр сессий) →
// дерево процедур. Модули добавит T-007 — в порядке топологической сортировки tooling/architecture/modules.ts.
// Логики сверх «соединить» здесь нет.
import type { Clock } from "@kosht/kernel";
import { createClock } from "../platform/clock/clock.ts";
import type { AppConfig } from "../platform/config/config.ts";
import { createPool, pingDb } from "../platform/db/connection.ts";
import { appRoleOptions, assertAppRole } from "../platform/db/roles.ts";
import { createSystemDb } from "../platform/db/system-db.ts";
import { ALLOW_LAN } from "../platform/http/allow-lan.ts";
import {
  createSessionRegistry,
  openSession,
  type Session,
  type SessionRegistry,
} from "../platform/http/session.ts";
import type { Logger, LogRole } from "../platform/logging/logger.ts";
import { createSettings, type Settings } from "../platform/settings/settings.ts";
import { TIME_ZONE } from "../platform/settings/time-zone.ts";
import { migrateDatabase } from "./migrate-database.ts";
import { router } from "./router.ts";

/** Роль процесса (ARCHITECTURE §3). */
export type ProcessRole = Exclude<LogRole, "cli">;

export interface Composition {
  readonly role: ProcessRole;
  readonly config: AppConfig;
  readonly log: Logger;
  readonly clock: Clock;
  readonly settings: Settings;
  /** Источник сессий подключает модуль входа (T-009). */
  readonly sessions: SessionRegistry;
  /** Дерево процедур oRPC (main/router.ts). */
  readonly router: typeof router;
  /** Сессия запроса сайта по заголовкам. */
  session(headers: Headers): Promise<Session | undefined>;
  /** БД отвечает (/readyz). */
  ready(): Promise<void>;
  /** Открыт ли сетевой вход (настройка network.allow-lan). */
  allowLan(): Promise<boolean>;
  /** Закрыть пул: после него в pg_stat_activity соединений процесса нет. */
  close(): Promise<void>;
}

export interface ComposeDeps {
  /** Лог процесса: его открывает и закрывает точка входа (последняя строка — process.stopped). */
  readonly log: Logger;
}

export async function compose(
  config: AppConfig,
  role: ProcessRole,
  deps: ComposeDeps,
): Promise<Composition> {
  const { log } = deps;
  // Владелец нужен только на старте: после выдачи прав его соединения в процессе не остаётся.
  const owner = createPool(config.db.migration, {
    max: 1,
    applicationName: `kosht-${role}-migrate`,
  });
  try {
    await migrateDatabase(owner, appRoleOptions(config.db.app));
  } finally {
    await owner.end();
  }
  log.info({ role }, "db.migrated");
  const pool = createPool(config.db.app, { applicationName: `kosht-${role}` });
  try {
    await assertAppRole(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  // Часам нужен пояс из настроек, настройкам — «сейчас» без пояса (кэш ≤ 5 с): иначе был бы цикл.
  const settings = createSettings({
    db: createSystemDb(pool),
    clock: createClock(),
    env: config.env,
    log,
  });
  const clock = createClock(() => settings.peek(TIME_ZONE));
  const sessions = createSessionRegistry();
  return {
    role,
    config,
    log,
    clock,
    settings,
    sessions,
    router,
    session: (headers) => openSession(sessions, pool, headers),
    ready: () => pingDb(pool),
    allowLan: () => settings.get(ALLOW_LAN),
    close: async () => {
      await pool.end();
      log.info({ role }, "db.closed");
    },
  };
}
