// Корень композиции (ARCHITECTURE §3): все три процесса — api, worker, bot — собираются одной функцией. Порядок:
// пул владельца (одно соединение kosht-<роль>-migrate) → миграции, схема очереди pgboss и выдача прав роли приложения
// под pg_advisory_lock (до слушателей: /readyz = «БД отвечает») → пул владельца закрыт → пул роли приложения
// (kosht-<роль>, ADR-0020) и проверка, что у неё нет лишних прав → платформа (часы, настройки, реестр сессий,
// очередь задач на том же пуле и события, ADR-0008; живые сигналы — отправка у всех ролей, а в api ещё и одно
// соединение LISTEN kosht-api-listen с хабом потоков; секреты, лимиты частоты, файлы, ScopedDb и SystemDb) → 36
// модулей в порядке топологической сортировки tooling/architecture/modules.ts (create-modules.ts) → реестры
// (registries.ts; повторное имя — ошибка старта) → подписки событий, очереди всех задач и дерево процедур с ветками
// модулей. Логики сверх «соединить» здесь нет.
import type { Clock } from "@kosht/kernel";
import { join } from "node:path";
import { createLocalFsBlobStore } from "../platform/blob-store/blob-store.ts";
import { createClock } from "../platform/clock/clock.ts";
import type { AppConfig } from "../platform/config/config.ts";
import { createPool, pingDb } from "../platform/db/connection.ts";
import { appRoleOptions, assertAppRole } from "../platform/db/roles.ts";
import { listenConnector } from "../platform/db/listen.ts";
import { createScopedDb } from "../platform/db/scoped-db.ts";
import { createSystemDb } from "../platform/db/system-db.ts";
import { ALLOW_LAN } from "../platform/http/allow-lan.ts";
import {
  createSessionRegistry,
  openSession,
  type Session,
  type SessionRegistry,
} from "../platform/http/session.ts";
import { createEvents, type Events } from "../platform/events/events.ts";
import { createJobs, type Jobs } from "../platform/jobs/jobs.ts";
import {
  createScopeVerifierRegistry,
  type ScopeVerifierRegistry,
} from "../platform/jobs/scope-verifier.ts";
import type { Logger, LogRole } from "../platform/logging/logger.ts";
import type {
  ModuleDescriptor,
  Platform,
  SystemPlatform,
} from "../platform/module/define-module.ts";
import { createRateLimiter } from "../platform/rate-limit/rate-limit.ts";
import { createConsentRegistry } from "../platform/module/consent-source.ts";
import { createRealtimeHub } from "../platform/realtime/hub.ts";
import {
  createRealtime,
  createRealtimeStreams,
  type Realtime,
} from "../platform/realtime/realtime.ts";
import { createSecrets } from "../platform/secrets/secrets.ts";
import { createSettings, type Settings } from "../platform/settings/settings.ts";
import { TIME_ZONE } from "../platform/settings/time-zone.ts";
import { createTelemetry, loadLangfuseTarget } from "../platform/telemetry/telemetry.ts";
import { createModules, type ModulePorts } from "./create-modules.ts";
import { migrateDatabase } from "./migrate-database.ts";
import { buildRegistries, type Registries } from "./registries.ts";
import { createRouter, type Router } from "./router.ts";

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
  /** Перепроверка владельца задачи подключает модуль входа (T-009). */
  readonly scopes: ScopeVerifierRegistry;
  /** Очередь задач процесса (порт Jobs) и события поверх неё с подписками модулей. */
  readonly jobs: Jobs;
  readonly events: Events;
  /** Живые сигналы в браузеры домохозяйства: changed(s, …) и progress(scope, …). */
  readonly realtime: Realtime;
  /** Порты платформы, которые получили модули (SystemDb — только модулям с таблицами system/public). */
  readonly platform: Platform;
  /** Модули в порядке создания (топологическая сортировка modules.ts). */
  readonly modules: readonly ModuleDescriptor[];
  /** Реестры частей модулей. */
  readonly registries: Registries;
  /**
   * Запустить очередь со всеми задачами, подписками, расписаниями и обходами модулей — во всех ролях: ставят
   * задачи и api, и bot (незарегистрированную Jobs не поставит), а worker ещё обрабатывает их и ведёт расписания.
   */
  startJobs(): Promise<void>;
  /** Дерево процедур oRPC (main/router.ts). */
  readonly router: Router;
  /** Сессия запроса сайта по заголовкам. */
  session(headers: Headers): Promise<Session | undefined>;
  /** БД отвечает (/readyz). */
  ready(): Promise<void>;
  /** Открыт ли сетевой вход (настройка network.allow-lan). */
  allowLan(): Promise<boolean>;
  /**
   * Остановка: потоки events.stream и LISTEN без переподключения (realtime.stopped, только api) → очередь
   * (обработчики в полёте — ≤ 8 с) → пул: соединений процесса в pg_stat_activity нет.
   */
  close(): Promise<void>;
}

export interface ComposeDeps {
  /** Лог процесса: его открывает и закрывает точка входа (последняя строка — process.stopped). */
  readonly log: Logger;
  /** Сборка модулей; по умолчанию — все 36 (create-modules.ts), тесты подставляют свои. */
  readonly createModules?: (ports: ModulePorts) => readonly ModuleDescriptor[];
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
    await migrateDatabase(owner, appRoleOptions(config.db.app), config.db.migrationsDir);
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
  const system = createSystemDb(pool);
  // Часам нужен пояс из настроек, настройкам — «сейчас» без пояса (кэш ≤ 5 с): иначе был бы цикл.
  const settings = createSettings({
    db: system,
    clock: createClock(),
    env: config.env,
    log,
  });
  const clock = createClock(() => settings.peek(TIME_ZONE));
  const sessions = createSessionRegistry();
  const scopes = createScopeVerifierRegistry();
  const consent = createConsentRegistry();
  // pg-boss — на том же пуле роли приложения (своего пула нет); пояс расписаний — настройка system.time-zone.
  const jobs = createJobs({
    pool,
    role,
    log,
    clock,
    scopes,
    timeZone: () => settings.get(TIME_ZONE),
  });
  const realtime = createRealtime({ pool });
  // Подписки известны только после сборки модулей, а модулям events нужен сразу: публикация до конца сборки
  // (в фабрике модуля) — ошибка программы.
  let events: Events | undefined;
  // Инструменты агента — из реестра модулей, а он собирается после фабрик: до конца сборки — ошибка программы.
  let registered: Registries | undefined;
  const platform: Platform = {
    clock,
    log,
    settings,
    secrets: createSecrets({
      db: system,
      masterKey: config.masterKey,
      env: config.env,
      clock,
      log,
    }),
    rateLimiter: createRateLimiter({ db: system, clock, masterKey: config.masterKey, log }),
    blobs: createLocalFsBlobStore(join(config.dataDir, "files")),
    jobs,
    events: {
      publish: async (tx, event, payload) => {
        if (events === undefined) {
          throw new Error(`Событие ${event.name} опубликовано до конца сборки модулей.`);
        }
        await events.publish(tx, event, payload);
      },
    },
    realtime,
    // Трассы ИИ (ADR-0010): Langfuse, если включён конфигурацией и make init создал ключи.
    telemetry: createTelemetry(await loadLangfuseTarget(config.langfuse, log)),
    consent,
    tools: () => {
      if (registered === undefined) {
        throw new Error("Инструменты агента запрошены до конца сборки модулей.");
      }
      return [...registered.tools.values()];
    },
    scoped: (scope) => createScopedDb(pool, scope),
  };
  const systemPlatform: SystemPlatform = {
    ...platform,
    system,
    deriveKey: (purpose) => config.masterKey.derive(purpose),
    localOrigin: `http://${config.listeners.local.host}:${String(config.listeners.local.port)}`,
  };
  // Слушает канал только api (ADR-0008): одно соединение на процесс. Без него сайт не узнаёт об изменениях —
  // неудача первого подключения есть ошибка старта (RealtimeStartError).
  const live =
    role === "api"
      ? createRealtimeStreams({
          connect: listenConnector(config.db.app, "kosht-api-listen"),
          log,
        })
      : undefined;
  let registries: Registries;
  let router: Router;
  try {
    // Повторное имя в реестре или процедура платформы в ветке модуля — ошибка старта.
    registries = buildRegistries(
      (deps.createModules ?? createModules)({ platform, systemPlatform }),
    );
    // Вход в систему (сессии сайта и владельцы задач) даёт модуль identity; без него не входит никто.
    if (registries.sessionSource !== undefined) sessions.register(registries.sessionSource);
    if (registries.scopeVerifier !== undefined) scopes.register(registries.scopeVerifier);
    if (registries.consentSource !== undefined) consent.register(registries.consentSource);
    registered = registries;
    events = createEvents({ jobs, subscriptions: registries.subscriptions });
    // worker и bot потоков сайта не отдают: их хаб пуст и ничего не слушает.
    router = createRouter({
      streams: live?.streams ?? createRealtimeHub({ log }),
      modules: registries.routers,
    });
    await live?.start();
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    role,
    config,
    log,
    clock,
    settings,
    sessions,
    scopes,
    jobs,
    events: platform.events,
    realtime,
    platform,
    modules: registries.modules,
    registries,
    startJobs: () =>
      jobs.start({
        jobs: registries.jobs,
        schedules: registries.schedules,
        sweeps: registries.sweeps,
      }),
    router,
    session: (headers) => openSession(sessions, pool, headers),
    ready: () => pingDb(pool),
    allowLan: () => settings.get(ALLOW_LAN),
    close: async () => {
      // Сначала работа модулей в памяти (запуски агента) — пока очередь и пул ещё открыты.
      for (const stop of registries.stops) await stop();
      await live?.stop();
      await jobs.stop();
      await pool.end();
      log.info({ role }, "db.closed");
    },
  };
}
