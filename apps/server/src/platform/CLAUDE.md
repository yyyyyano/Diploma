# `apps/server/src/platform` — ярус 0 сервера: техника без бизнеса

## Назначение
Общая техника всех модулей (ARCHITECTURE §2, §6, §9): `db` (T-004); `config`, `logging`, `errors`, `clock`,
`blob-store`, `settings`, `secrets`, `rate-limit` (T-005); `http` (T-059; точки входа — `src/entrypoints`);
`jobs` и `events` — T-006; `realtime` и поток `events.stream` — T-061; `module`, `tools`, `db/user-data.ts` — T-007. Используют модули, `main/compose.ts`, точки входа; модули сюда не импортируются.
Общего `index.ts` ни у одной папки нет: возможность = файл.

## Публичный API — T-005 (NFR-15, NFR-16, NFR-23, OBS-01/02/04/06, SEC-02)
- `config/config.ts` — `loadConfig(env?)` → `AppConfig` (`db: { app, migration }`, `listeners.local/lan`, `trustedOrigins`,
  `webDistDir` (`WEB_DIST_DIR`, по умолчанию `apps/web/dist`) и `dataDir` абсолютные, `logLevel`, `langfuse` (`LangfuseConfig |
  undefined`: `LANGFUSE_ENABLED` — по умолчанию `true`, `LANGFUSE_BASE_URL` — `http://127.0.0.1:3001`, файлы ключей), `masterKey`, `env(name)` — чтение переменной для `defineSetting`/`defineSecret`);
  `loadDbConfig(env?)` → `DbConfigs` — только БД, без мастер-ключа (`make migrate`, globalSetup тестов): `app` —
  роль приложения `kosht_app` (`DATABASE_URL`, `DB_PASSWORD_FILE` = `secrets/db_app_password`), `migration` — владелец
  (`MIGRATION_DATABASE_URL` = `kosht`, `MIGRATION_DB_PASSWORD_FILE` = `secrets/db_password`); хост, порт и база
  должны совпадать, роли — различаться, иначе `ConfigError` (ADR-0020); `migrationsDir` — `MIGRATIONS_DIR`
  (по умолчанию `apps/server/drizzle`, абсолютный; не от `import.meta.url` — сервер в образе собран в один `.mjs`); `DbConfig`, `ConfigError` (имя переменной и
  ожидание, **без значения**), `CONFIG_VARIABLES` (сверяется с `.env.example`). `process.env` читают только `config/` и `entrypoints/` (тест `env-readers.test.ts`).
- `config/master-key.ts` — `MasterKey` (32 байта из `secrets/master.key`; `derive("secrets/v1" | "rate-limit/v1" | "auth/v1")` —
  HKDF-SHA-256; в JSON и `inspect` — `[MasterKey]`).
- `logging/logger.ts` — `createLogger({ role, level, destination })` → `Logger` (`fatal…trace(fields, key)`);
  `openLogFile(dir, role)` / `closeLogFile` — pino-roll в процессе: `<dir>/<роль>.<гггг-ММ-дд>.<n>.log`, ежедневно,
  14 файлов на роль (`LOG_FILES_PER_ROLE`; при открытии лишние удаляются сразу, при ротации — `limit.count: 13`,
  `removeOtherLogFiles`), папка 0700, файлы 0600; `rollOptions`, `EVENT_KEY`, `BAD_KEY`. `logging/context.ts` —
  `withLogContext({ requestId, uid, source }, fn)`. `logging/fields.ts` — белый список `LogFields`.
  `logging/scrub.ts` — `scrub(text)`: email, карта (Луна), IBAN BY. `logging/serialize-error.ts` — ошибка → лог.
  `logging/log-find.ts` (+ `log-find-cli.ts`) — `make log-find id=…`; `make logs` — хвост через pino-pretty.
- `errors/app-error.ts` — `AppError(code ∈ ERRORS, params)` (сообщение = код) и чистая `toErrorBody(err, requestId)`
  → `{ code, status, data: { requestId, params } }`; не `AppError`, `ISOLATION_VIOLATION`, параметры не по
  `ErrorParams` → `INTERNAL` без текста.
- `clock/clock.ts` — `createClock(timeZone?: () => TimeZone): Clock` (по умолчанию Минск), `isTimeZone`,
  `TimeZoneSchema`.
- `blob-store/blob-store.ts` — `BlobStore` (`put`, `putStream(…, AsyncIterable)` → размер (обрыв потока — файла нет),
  `get` → `undefined` если нет, `open` → `Blob` для выдачи по HTTP (`openAsBlob`: читается при отправке), `delete`,
  `deleteHousehold`),
  `createLocalFsBlobStore(<DATA_DIR>/files)`: путь `<householdId>/<fileId>` (`FileId` — в `@kosht/kernel`), id
  проверяются схемой (не uuid — `RangeError`), tmp+rename, папки 0700, файлы 0600. В тестах — `MemoryBlobStore`.
- `settings/settings.ts` — `defineSetting({ key, schema, default, env?, fromEnv? })` (реестр; `defineModule({ settings })` кладёт их ещё и в реестр
  корня композиции), `registeredSettings()`, `createSettings({ db, clock, env, log })` → `get` (кэш ≤ 5 с),
  `peek` (синхронно, для часов), `source`, `set` (не по схеме — `VALIDATION`), `reset`. `settings/time-zone.ts` —
  `TIME_ZONE` (`clock.time-zone` — до T-017 `system.time-zone`, перенесён миграцией; env `TIME_ZONE`, по умолчанию
  `Europe/Minsk`); в корне композиции:
  `createClock(() => settings.peek(TIME_ZONE))`.
- `secrets/secrets.ts` — `defineSecret({ name, env? })`, `registeredSecrets()`, `createSecrets({ db, masterKey, env,
  clock, log })` → `status` (`set | unset | unreadable`), `reveal` (только коду), `set`, `clear`.
- `rate-limit/rate-limit.ts` — `defineRateRule({ name, limit, windowMs })`, `createRateLimiter({ db, clock, masterKey,
  log, timeoutMs? })` → `hit` (`{ allowed, remaining, retryAfterMs }`), `enforce` (`RATE_LIMITED` с
  `retryAfterSeconds` и `retryAfterMinutes` ≥ 1 — для текста «через N мин.»); БД недоступна или молчит дольше 2 с — `UNAVAILABLE`. Перед записью удаляется до 100
  (`PURGE_BATCH`) строк того же правила из прошлых окон (индекс `(rule, window_start)`) — отдельной задачи
  очистки нет.

## Публичный API — `http/` (T-059: SEC-01, NFR-24, R40, OBS-01/02, ADR-0005, ADR-0016)
- `app.ts` — `createApp({ listener, trustedOrigins, log, ready, api?, webDistDir?, routes? })` → `HttpApp` (Hono) на один слушатель:
  request-id и контекст лога → Host и CSRF → маршрут → заголовки безопасности и строка `http.request` (`method`,
  `httpStatus`, `ms`, `listener`) на каждом ответе; `/healthz` (без БД), `/readyz` (`ready()` ≤ 2 с, иначе 503
  `UNAVAILABLE` без деталей); неизвестный маршрут — 404 `NOT_FOUND`; исключение — 500 `INTERNAL` + `http.error` со
  стеком; `api` — `{ handler, session, shutdownSignal, bodyLimit }` (процедуры под `/api`; неизвестная — 404
  `NOT_FOUND`; тело больше `bodyLimit()` байт — 400 `VALIDATION` до разбора, `hono/body-limit`); `routes` — маршруты
  процесса до статики. `body-limit.ts` — `BODY_LIMIT` (`http.body-limit-bytes`, 1 КиБ…16 МиБ, по умолчанию 1 МиБ, без
  env): процедуры принимают JSON, файлы идут своим путём (T-016).
- `guard.ts` — `ListenerName` (`local | lan`), `SECURITY_HEADERS` (CSP, `nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy: camera=(self), microphone=(self)`; без HSTS), `isAllowedHost(host, listener)` (local — `localhost`,
  `127.0.0.1`, `[::1]`; lan — они же и IP; имена — нет), `isSameSiteRequest` (кроме GET/HEAD/OPTIONS: `Sec-Fetch-Site`
  `cross-site`/`same-site` — отказ; `Origin` = `http://<Host>` или из `TRUSTED_ORIGINS`; оба пусты — не браузер),
  `requestIdFrom` (`[A-Za-z0-9-]{8,64}`, иначе новый uuid).
- `procedures.ts` — `HttpContext` (`requestId`, `listener` из замыкания `createApp`, `session()` лениво; продлённая
  источником сессия несёт `cookies` — `authed` кладёт их в `Set-Cookie` ответа,
  `shutdownSignal`, `resHeaders?` — заголовки ответа: вход и выход кладут сюда `Set-Cookie`) и четыре вида процедур над контрактом: `publicProc` (гость), `authed` (сессия → `context.s`,
  `context.role`, `uid` в лог; нет — `UNAUTHORIZED`), `localOnly` (только слушатель `local`; на `lan` — `NOT_FOUND`;
  сессии не требует), `admin` (сессия с ролью `admin`, иначе `FORBIDDEN`); middleware `requireSession`,
  `requireLocal`, `requireAdmin` — для своих деревьев (тестовый мини-контракт `http/__fixtures__/mini-router.ts`).
- `session.ts` — `createSessionRegistry()` (`register(resolver)` — один источник на процесс, его даёт модуль входа,
  T-009; пусто — сессии нет ни у кого), `SessionResolver(headers) → { userId, householdId, role } | undefined`,
  `openSession(registry, pool, headers)` — **единственное** место `makeScope` для сайта (ARCHITECTURE §6.4).
- `api.ts` — `createApiHandler(router, log)`: `OpenAPIHandler` под `/api` с `ResponseHeadersPlugin` (`context.resHeaders`); перевод ошибок: вход не по схеме и битое
  тело → `VALIDATION` (без issues), `AppError` → свой код, выход не по схеме и прочее → `INTERNAL` + `http.error`.
- `static-site.ts` — `siteResponse(root, pathname)`: файл сборки (`assets/` — вечный кэш, прочее — `no-cache`) или
  `index.html` для маршрута сайта; отсутствующий файл с расширением, `/api`, dotfiles, «..», `\`, NUL, `%`, `//` и
  ссылки за пределы корня (realpath) — `undefined` (404). В `createApp` — опция `webDistDir`, только GET/HEAD.
- `listeners.ts` — `createListeners({ local, lan, fetch(listener), allowLan, log })` → `start` (local; занят —
  `ListenError` с адресом и `LISTEN_LOCAL_PORT`), `reconcile` (сверка lan с настройкой, по очереди; раз в 1 с —
  `LAN_CHECK_MS`; lan не открылся — `http.lan-failed` с `code`, повтор на следующей сверке; выключили — соединения
  lan обрываются сразу), `address(listener)`, `stop(graceMs)` (не принимать, закрывать простаивающие, через
  `graceMs` оборвать остальные). `http.listening` — `listener`, `port`. `allow-lan.ts` — `ALLOW_LAN`
  (`network.allow-lan`, `z.boolean()`, по умолчанию `false`, без env): смена этим процессом видна на следующей сверке,
  другим — не позднее 5 с (кэш настроек).
- `link-origin.ts` — адрес ссылок в письмах (NFR-24): `linkOrigin({ allowLan, lanAddress, localOrigin })` — при
  `ALLOW_LAN` и заданном `LAN_ADDRESS` (`network.lan-address`, пусто или http(s)-адрес, без env; поле — админка,
  включить доступ без него нельзя) → он; иначе `localOrigin`. Запрос (слушатель, `Host`) не участвует: `Host` задаёт
  клиент, `isAllowedHost` на `lan` пропускает любой IP — подмена увела бы токен ссылки сброса.
  `resolveLinkOrigin(settings, localOrigin)` — то же с настройками процесса.
- `error-response.ts` — `httpErrorBody` / `errorResponse`: `{ defined, code, status, message: <код>, data: { requestId,
  params } }` — форма `ORPCError.toJSON()` oRPC 1.16.1, одна на все ответы об ошибке.

## Точки входа и корень композиции (T-059, ARCHITECTURE §3)
Своих паспортов у `src/entrypoints` и `src/main` нет: обзор процессов и сборки — `apps/server/CLAUDE.md`, детали — здесь.
- `main/compose.ts` — `compose(config, role, { log, createModules?, poolMax? })` → `Composition`: пул владельца (`max: 1`,
  имя `kosht-<роль>-migrate`) → `migrateDatabase` → пул владельца закрыт (`end`) → `db.migrated` → боевой пул
  `kosht-<роль>` роли приложения (`max` 10; int-тесты — `poolMax: TEST_POOL_MAX` = 4 из
  `main/__fixtures__/compose-on-test-db.ts`: стенды api+worker параллельных файлов иначе исчерпывают
  max_connections 100, 53300) → `assertAppRole` (ADR-0020) → `SystemDb`, часы, настройки, реестр сессий, реестр
  проверки scope задач (`scopes`), очередь `jobs` (`createJobs` на том же пуле, пояс расписаний —
  `settings.get(TIME_ZONE)`), `realtime` → `platform: Platform` (+ `secrets`, `rateLimiter`, `blobs` —
  `<DATA_DIR>/files`, `scoped(scope)`; `events` — с поздним связыванием: публикация из фабрики модуля — ошибка) и
  `SystemPlatform` (+ `system`) → модули (`main/create-modules.ts`, сгенерирован `make new-module`: топологический
  порядок `modules.ts`, фасады — ровно `dependsOn`) → `buildRegistries` (`main/registries.ts`; повтор имени —
  `RegistryError`; ключ настройки или секрета модуля — с префиксом его id, платформенный — с префиксом, которого нет
  среди модулей: `clock.`, `network.`, `http.`; иначе тоже `RegistryError`) → `sessions.register` / `scopes.register` частями модуля входа → `createEvents` с подписками модулей → `createRouter({ streams, modules: registries.routers })`
  (у `worker`/`bot` — пустой хаб) → в `api` — `createRealtimeStreams` с LISTEN `kosht-api-listen` (неудача —
  `RealtimeStartError`); любая ошибка этой части закрывает пул. `startJobs()` — `jobs.start` с задачами, подписками,
  расписаниями и обходами модулей **во всех ролях** (ставят задачи и `api`, и `bot`); `platform`, `modules`,
  `registries`, `session(headers)`, `ready()` (`pingDb`), `allowLan()`, `close()` (потоки и LISTEN —
  `realtime.stopped`, затем `jobs.stop`, пул, `db.closed`).
- `main/router.ts` — `createRouter({ streams, modules? })`: ветки модулей под ключом `moduleKey(id)` (camelCase),
  пустая ветка допустима; общая с модулем ветка контракта (`system`) дополняется, повтор платформенной процедуры —
  ошибка. Полноту против контракта проверяют `router.contract.test.ts` и `compose.int.test.ts` (`routerPaths` /
  `contractPaths` — `main/__fixtures__/router-paths.ts`).
- `main/migrate-database.ts` — `migrateDatabase(ownerPool, appRole, migrationsDir)`: миграции Drizzle → схема очереди pgboss
  (`installJobsSchema` под `withMigrationLock`) → `ensureAppRole` последним (`GRANT … ON ALL TABLES` видит только
  созданные таблицы). Одна последовательность для `compose`, `make migrate` (`main/migrate-cli.ts`) и шаблона тестов.
- `entrypoints/run.ts` — `runProcess(role, { routes?, setup?, stopTimeoutMs?, env? })`: конфигурация (ошибка — текст
  `ConfigError` в stderr, код 1; так же — тексты `AppRoleError` и `RealtimeStartError` на старте) → лог
  `<DATA_DIR>/logs` → `compose` → `setup(composition)` (тестовые фикстуры) →
  `startJobs()` (до слушателей) → роль (`api` — слушатели и приложения на
  каждый; занятый порт — текст `ListenError` в stderr, код 1; `worker`/`bot` держит `setInterval`, пул процесс не
  держит) → `process.started`. `shutdown(steps, timeoutMs)`: `process.stopping` → сигнал остановки потокам,
  слушатели (`stop(80 % срока)`) → потоки и LISTEN (`realtime.stopped`) → очередь (≤ 8 с) → пул → `db.closed` →
  `process.stopped` → лог на диск → код 0; дольше
  `STOP_TIMEOUT_MS` (10 с) — `process.stop-timeout`, код 1. Сигнал до конца старта (миграции под блокировкой) —
  `process.stop-requested`: старт доводится, роль не запускается, остановка та же (код 0). `uncaughtException` и
  `unhandledRejection` — `crash()`: `process.crashed` (`reason`, `err` со стеком), лог на диск, код 1 (OBS-05).
  `api.ts`, `worker.ts`, `bot.ts` — тонкие обёртки.
- `entrypoints/__fixtures__/slow-api.ts` — api с медленным `/slow` для SIGTERM-теста (`processes.int.test.ts`);
  `crash-worker.ts` — worker, падающий после старта (`exception` | `rejection`).
- `entrypoints/__fixtures__/e2e-stack.ts` — стенд `make e2e`: шаблон тестов (`db/__fixtures__/test-template.ts`, общий с
  globalSetup проекта int) → своя база → api и worker со своим окружением и портом; SIGTERM — остановка и удаление базы.
- `db/connection.ts`: `createPool(config, { applicationName })` — имя в `pg_stat_activity`; `pingDb(pool)`. Пулов
  два: владельца — только на старте (`kosht-<роль>-migrate`), роли приложения — на всю жизнь процесса (`kosht-<роль>`).

## Публичный API — `jobs/` (T-006: NFR-21, NFR-22, OBS-01, OBS-07, SEC-04, ADR-0008)
- `install.ts` — `installJobsSchema(bossDb(client))`: схему `pgboss` ставит или мигрирует владелец (pg-boss с
  `migrate: true` без обработчиков и таймеров); `JOBS_SCHEMA`, `PG_BOSS_VERSION` (входит в отпечаток шаблона тестов).
- `boss.ts` — `createBoss(bossDb(pool), role)`: единственное место настроек pg-boss; своего пула нет, `migrate: false`;
  `api`/`bot` — `supervise: false`, `schedule: false` (только ставят задачи); `worker` — обслуживание и расписания,
  `SUPERVISE_INTERVAL_SECONDS` и `MONITOR_INTERVAL_SECONDS` = 60, `INSTANCE_HEARTBEAT_SECONDS` = 30, `reindex: false`;
  `stopBoss` — `stop({ graceful: true, timeout: BOSS_STOP_TIMEOUT_MS = 8000, close: false })`.
- `define-job.ts` — `defineJob({ name: "<модуль>.<глагол>", payload: z.object(...), options, handle(ctx, p) })` →
  `JobDef` (реестр — `defineModule({ jobs })` → `main/registries.ts`); `options`: `priority`, `retryLimit` (2), `retryDelaySeconds`,
  `startAfterSeconds`, `expireInSeconds`, `singletonKey(p, scope)` — только `jobKey`; с ключом очередь `short`
  (одна ожидающая на ключ), без — `standard` (`queuePolicy`). `ctx`: `s` (ScopedDb владельца), `requestId`, `log`,
  `signal`, `progress(0…100)`. `JobEnvelope` — `{ scope: { userId, householdId }, requestId, payload }`.
- `job-key.ts` — `jobKey(scope, ...parts)` → `<householdId>:<части>`; ключ без домохозяйства `enqueue` отвергает.
- `scope-verifier.ts` — порт `ScopeVerifier(candidate) → boolean` и `createScopeVerifierRegistry()` (`register` — один
  источник на процесс, его даёт identity, T-009; пусто — не проходит никто).
- `jobs.ts` — порт `Jobs` (`enqueue(tx, job, payload)`, `discardHousehold(householdId)` — удалить ещё не начатые
  задачи домохозяйства во всех очередях через `findJobs` + `deleteJob` pg-boss, PRIV-06; у `InlineJobs` — всегда 0;
  `overview()` — экран «Система» (ADM-60, OBS-07): выполняются, последние `failed`/`dropped` и расписания и обходы
  процесса с последним запуском — до `OVERVIEW_LIMIT` (20) строк, только журнал; у `InlineJobs` — пусто) и `createJobs({ pool, role, log, clock, scopes,
  pollingIntervalSeconds? })` → `JobsRuntime`: `start({ jobs })` — очереди (`createQueue`, все роли) и в `worker` —
  `work` (`perJobResults`; частота опроса — общая `pollingIntervalSeconds` процесса, а у срочной для человека задачи — своя `JobOptions.pollingIntervalSeconds` ≥ 0,5: уведомление о пороге лимита ≤ 3 с, BUD-03); `enqueue` — `send` через `fromDrizzle` на соединении tx (аудитор), `requestId` — из
  контекста лога; `stop()`. Выполнение: конверт → `scopes.verify` → `makeScope` (единственное место для задач) →
  `ctx.s` → обработчик → `background_job_run`. Не прошёл конверт, владелец или нагрузка — `dropped` (`VALIDATION`,
  `FORBIDDEN`), `jobs.scope-rejected` в логе, без повтора; ошибка — `failed` с кодом, повтор только для `retryable`.
  Реестр `start({ jobs, schedules?, sweeps? })`: в `worker` расписания и обходы — очереди `short` с
  `schedule(имя, cron, null, { tz: deps.timeZone(), missed: "once" })`; пояс — настройка `clock.time-zone`,
  читается при старте (смена — после перезапуска `worker`).
- В тестах сценариев вместо `createJobs` — `InlineJobs` из `@kosht/testing` (выполняет сразу; форму сверяет
  `inline-jobs.test.ts`).
- `periods.ts` — `pendingPeriods(watermark, today, stepDays)`: закончившиеся периоды после водяного знака (текущий —
  нет); без водяного знака — только последний закончившийся.
- `schedule.ts` — `defineSchedule({ name, cron, stepDays, handle(ctx, periods) })` (расписание платформы, без scope)
  и `runSchedule`: водяной знак из `background_job_run` → `pendingPeriods` → обработчик → новый водяной знак только
  после успеха; итог `idle | completed | retry | failed`.
- `sweep.ts` — `defineSweep({ name, cron, find, job, payload(row) })` и `runSweep`: `crossTenant(pool, name, find)`
  (только `id, householdId, userId`) → `makeScope` строки → задача владельцу; строка журнала на обход.

## Публичный API — `realtime/` (T-061: NFR-21, ROLE-01, SEC-04, OBS-04, ADR-0008)
- `realtime.ts` — `createRealtime({ pool })` → `Realtime`: `changed(s: ScopedDb, { entity, ids })` — `pg_notify` через
  `s.db` (в `s.transaction` — при COMMIT; откат и `ROLLBACK TO SAVEPOINT` — сигнала нет), `progress(scope, { entity, id,
  percent? })` — сразу через пул (SystemDb). Домохозяйство сигнала — из `s.scope`/`scope`, не из входа.
  `createRealtimeStreams({ connect, log })` → `{ streams, start, stop }` — приём в `api`: слушатель и хаб; `stop` —
  потоки (`stopped`), затем LISTEN.
- `message.ts` — `RealtimeMessage` (Zod, strict: `householdId`, `type` `changed | progress`, `entity` (EntityKind),
  `ids` (uuid, ≥ 1), `percent?`), `encodeSignal(batch)` — куски JSON ≤ `NOTIFY_MAX_BYTES` = 7500 (`Buffer.byteLength`;
  не по схеме — `RangeError` без значений), `decodeSignal(payload)` — не JSON или не по схеме — `undefined`.
- `listener.ts` — `createRealtimeListener({ connect, log, onMessage, onReady, onLost? })`: `start()` — первое
  подключение (неудача — `RealtimeStartError`, текст для консоли без значений конфигурации); потеря — `realtime.lost`,
  переподключение через `reconnectDelayMs(n)` = 0,2 с × 2ⁿ, потолок 5 с (`realtime.reconnect-failed`), успех —
  `realtime.listening` и `onReady`; неверное сообщение — `realtime.bad-message` без текста; `stop()` — без
  переподключения, `realtime.stopped`.
- `hub.ts` — `createRealtimeHub({ log, queueLimit?, streamsPerUser? })` → `RealtimeHub`: карта `householdId → потоки`,
  ключ — `scope` сессии; `open(scope, signal)` → `StreamIterator` (конец — причина `StreamEnd`: `closed | reconnect |
  overflow | replaced | stopped`, oRPC шлёт её событием `done`; `return()` закрывает сразу), `deliver(message)`,
  `closeAll(reason)`, `size`. Не больше `STREAMS_PER_USER` = 8 потоков пользователя — девятый закрывает его самый
  старый (`realtime.stream-replaced`); переполнение очереди — `realtime.stream-overflow`, поток закрыт.
- `connection-queue.ts` — `ConnectionQueue(limit = QUEUE_LIMIT = 1000)`: `push` (схлопывание по `(type, entity, id)`,
  новый ключ сверх предела — `false`), `take`, `size`; без таймеров и ввода-вывода.
- `db/listen.ts` — единственное место `pg_notify` и `pg.Client`: `REALTIME_CHANNEL` = `kosht_realtime`,
  `notify(db, payloads)` (канал — параметром), `listenConnector(dbConfig, applicationName)` → `ListenConnect`
  (`keepAlive`, `LISTEN` с именем через `escapeIdentifier`, `onLost` один раз и не после `close()`).
- Процедура `events.stream` — `main/router.ts`: `authed`, `streams.open(context.s.scope, abort запроса ∪ shutdownSignal)`.

## Публичный API — `module/`, `tools/`, `db/user-data.ts` (T-007: NFR-10, AGT-03, PRIV-06, ADR-0003, ADR-0009)
- `module/define-module.ts` — `defineModule({ id, facade?, router?, events?, jobs?, subscriptions?, schedules?, sweeps?,
  tools?, deliveryChannels?, undo?, confirm?, userData?, settings?, secrets?, rateRules?, sessionSource?, scopeVerifier? })`
  → `ModuleDescriptor<F>` (источник сессий сайта и проверка владельца задач — по одному на процесс, их даёт `identity`;
  `consentSource` — облачное согласие (PRIV-02) и `knownNamesSource` — имена пользователя для маскирования (PRIV-03,
  `platform.knownNames`; даёт profile) — по одному на процесс; второй — `RegistryError`; `stop` — остановка работы
  модуля в памяти при `close()`, первой и в порядке, обратном созданию)
  (все списки есть, пустые — тоже). id — kebab-case; имена событий, задач, расписаний, обходов, `undo`/`confirm` —
  `<id>.<…>`; подписка — только своего модуля (`module === id`); иначе `RangeError` при создании. `Platform` (`clock`,
  `log`, `settings`, `secrets`, `rateLimiter`, `blobs`, `jobs`, `events`, `realtime`, `telemetry`, `consent.cloudAllowed(scope)`
  (нет источника — false), `tools()` — инструменты агента из реестра (до конца сборки — ошибка), `actionHandlers()` — реестры обработчиков
  `undo`/`confirm` всех модулей для `actions`, `deliveryChannels()` — каналы доставки уведомлений по имени (так же
  поздно), `userData()` — владельцы данных в порядке `modules.ts` (так же поздно; privacy, PRIV-05/06), `scoped(scope)`), `SystemPlatform`
  (+ `system: SystemDb`, `deriveKey("auth/v1")` — ключ из мастер-ключа, `localOrigin` — адрес локального входа, `modelsDir` —
  `<DATA_DIR>/models` для локальных моделей; только
  модулям с `system`/`public` в `modules.ts`), `ModuleDeps<F, P>` = `{ platform, facades }`
  (фасады — ровно `dependsOn`, ключ — id в camelCase), `NoFacades`, `ActionHandler(s, payload)`, `DeliveryChannel`.
- `tools/define-tool.ts` — `defineTool` (ARCHITECTURE §8.2): `ImmediateTool` (`read | write`, `execute(ctx, input)`,
  `output`) или `DestructiveTool` (`propose(ctx, input)` → `PendingActionDraft { action, payload }`, без `execute` по
  типу); `TOOLSETS` = `core | legal | planning | reports`; `ToolCtx { s, requestId, channel, page? }`. При
  определении: имя snake_case, описание — печатаемый ASCII (по-английски), набор из `TOOLSETS`, во входе нет
  `userId`/`householdId`/`ownerId`.
- `db/user-data.ts` — `defineUserData({ tables, export?, afterDelete? })` → `UserDataDef`: только `userOwnedTable`,
  без повторов; порядок — порядок удаления (дети раньше родителей); таблиц может не быть, только если есть хук. Хуки —
  данные вне таблиц домохозяйства: `export(s, sink)` дополняет архив «Мои данные» (`ExportSink.file(path, Blob)`:
  исходные файлы читаются потоком, когда до них дошла запись архива), `afterDelete(scope)` — идемпотентная уборка после удаления строк (каталог файлов, системные таблицы модуля,
  трассы). `UserDataOwner { module, data }` — элемент `Platform.userData()`.
- `http/procedures.ts` — `ModuleRouter`: ветка модуля в дереве процедур.

## Публичный API — `telemetry/`, `module/consent-source.ts`, `db/transaction-flag.ts` (T-010: OBS-03, PRIV-02, ADR-0009)
- `telemetry/telemetry.ts` — `createTelemetry(langfuse?)` → `Telemetry` (`enabled`, `langfuse` — `LangfuseTarget { baseUrl,
  publicKey, secretKey() }`; `options({ functionId, userId?, sessionId? })` →
  опции AI SDK `telemetry` (`isEnabled`, `functionId`, `includeRuntimeContext`) и `runtimeContext` с внутренними
  `userId`/`sessionId`; AI SDK платформа не импортирует. `loadLangfuseTarget(config.langfuse, log)` — ключи из
  файлов `LANGFUSE_*_KEY_FILE` (их создаёт `make init`); нет файла или Langfuse выключен (`LANGFUSE_ENABLED=false`) —
  `undefined` и `telemetry.langfuse-off` в логе. Интеграцию трасс строит модуль `llm` (T-011).
- `module/consent-source.ts` — `ConsentSource(scope)` и `createConsentRegistry()` (`register` — один источник;
  `cloudAllowed` — без источника false).
- `db/transaction-flag.ts` — `inTransaction()` / `withTransactionFlag(fn)`: `s.transaction` поднимает флаг в
  `AsyncLocalStorage` (только булево) — по нему шлюз llm бросает `LLM_IN_TRANSACTION`.

## Публичный API — `events/` (T-006: ADR-0004, ADR-0008, ARCHITECTURE §5)
- `define-event.ts` — `defineEvent({ name: "<модуль>.<прошедшее>", payload: z.object({ ids, … }) })` → `EventDef`:
  нагрузка — пачка `ids` (1…`MAX_EVENT_IDS` = 1000), проверяется всегда (`and` со схемой модуля).
- `define-subscription.ts` — `defineSubscription({ event, module, options?: { singletonKey, startAfterSeconds,
  retryLimit }, handle(ctx, p) })` → `SubscriptionDef` с задачей очереди `evt.<событие>.<модуль>` (политика short);
  без ключа модуля ключ — `jobKey(scope, sha256(нагрузки))`: одинаковые ожидающие события домохозяйства
  схлопываются, чужие — нет. pg-boss здесь не нужен: подписка — задача фасада `jobs`.
- `events.ts` — `createEvents({ jobs, subscriptions })` → `Events.publish(tx, event, payload)`: задача каждой подписке
  через `jobs.enqueue(tx, …)` в той же транзакции; подписок нет — ничего; нагрузка не по схеме — `RangeError`;
  модуль подписан на событие дважды — ошибка при создании.

## Публичный API — `cache/` (T-020: ARCHITECTURE §6.6, LLM-05)
- `cache/scoped-cache.ts` — `createScopedCache<V>({ max, ttlMs, clock })` → `scopedCache(s)` → `{ get(key), set(key,
  value) }`: ключ всегда с `householdId` из `s.scope` (чужое домохозяйство с тем же ключом записи не видит), срок
  жизни — по `Clock`, сверх `max` вытесняется давняя по использованию; в памяти процесса. Кэш пользовательских данных —
  только так (опция `cache` Drizzle выключена).

## Публичный API — `sandbox/` (T-025: SEC-03, NFR-11)
- `sandbox/isolated.ts` — `runIsolated(worker, input, { timeoutMs, memoryMb }, transfer?)`: недоверенный разбор (PDF, XLSX,
  картинки) в `worker_thread` с `resourceLimits` и `terminate()` по таймауту; сбой — `SandboxError { kind: timeout |
  memory | failed | rejected, code? }` без текста исключения. `defineIsolatedWorker({ name, devUrl })` описывает рабочий
  файл `*.worker.ts`, который зовёт `serveIsolated(handler)` (`sandbox/serve.ts`); отказ по правилу —
  `throw new SandboxRejection("код")`. В `make dev` поток — `.ts` рядом с кодом, в образе — `dist/<имя>.worker.mjs`
  (своя точка входа в `tsdown.config.ts`; `workerUrl` выбирает по расширению файла помощника). В рабочих файлах — без
  синтаксиса, который Node не стирает (параметры-свойства классов, enum). Проверки: `isolated.test.ts`,
  `isolated.build.test.ts` (tsdown собирает бандл и запускает его node).

## Таблицы платформы
`settings`, `secrets`, `rate_limits`, `background_job_run` (`jobs/`) — `systemTable` платформы (без домохозяйства), схема — `<папка>/schema.ts`,
запросы — `<папка>/<папка>.repo.ts` через `SystemDb`. Флаг `tables` в `modules.ts` не нужен: правило
`system-db-only-for-flagged-modules` смотрит только на `modules/*`. Схему видят только своя папка,
`drizzle.config.ts` и тесты (правило `schema-only-in-infrastructure`); `drizzle-orm` вне `platform/db` — только в
этих `schema.ts` и `*.repo.ts` (исключение `drizzle-and-pg-only-in-db`, решения по T-005 и T-006).
- `background_job_run` (OBS-07): строка на запуск — `kind`, `schedule_key`, `status` (`running | completed | failed |
  dropped`), `progress` 0…100, `watermark` (день, расписания платформы), `error_code` (код каталога, без текста),
  `started_at`, `finished_at`; без `household_id`/`user_id`. Имя — единственное число, как в ADR-0008 и SPEC.
  `jobs.repo.ts`: `startRun`, `finishRun`, `recordDropped`, `setProgress`, `lastWatermark`; строки старше 30 дней
  (`RETENTION_DAYS`) удаляются по 100 перед новой, кроме строки с текущим водяным знаком расписания.

## Публичный API — `db/` (ROLE-01, SEC-04, PRIV-07, ADR-0006). Общего `index.ts` нет: возможность = файл
- `tables.ts` — виды таблиц: `userOwnedTable` (id `uuidv7()`, `household_id`/`user_id` NOT NULL, `created_at`,
  `updated_at`, PK `(household_id, id)`), `systemTable`, `publicTable` (без владельца), `ownedFk` (составной FK +
  индекс). Колонки — `snake_case` из имён свойств (casing задаёт таблица). Таблица попадает в реестр при импорте схемы.
- `scoped-db.ts` — `createScopedDb(pool, scope): ScopedDb` (`own`, `insert`, `update`, `delete`, `transaction`;
  вложенная — SAVEPOINT); выключателя аудита нет.
- `system-db.ts` (`createSystemDb`), `cross-tenant.ts` (`crossTenant(pool, label, find)` — только
  `id, household_id, user_id`), `unsafe-raw.ts` (без аудита: миграции и тесты), `boss-db.ts` (подключение pg-boss:
  `bossDb(pool | client)` — IDatabase на пул приложения или соединение владельца, мимо аудитора;
  `bossTransaction(tx)` — `{ tx: tx.db, sql }` для `fromDrizzle`, через аудитор; только `jobs/`, `main/` и тесты —
  правило `boss-db-only-in-jobs`) — пути = `PLATFORM_DB` в
  `tooling/architecture/rules.ts`; переименовали файл — правьте `PLATFORM_DB` (тест T-002 краснеет).
- `audit.ts` — `auditQuery(sql, params, mode, owned)` и `IsolationViolation` (`code: "ISOLATION_VIOLATION"`,
  `reason: ViolationReason` — в том числе `UNPARSEABLE_SQL`, `table`); вызывается из `Logger` Drizzle (`audited.ts`)
  до отправки запроса.
- `connection.ts` (`createPool(config: DbConfig, { applicationName? })`: адрес без пароля, пароль из файла
  `DB_PASSWORD_FILE`/`MIGRATION_DB_PASSWORD_FILE` (`readPasswordFile`); `DbConfig` и чтение окружения — в `config/`;
  `pingDb`), `migrate.ts` (`runMigrations(pool, { folder, table? })` и `withMigrationLock` под `pg_advisory_lock`), `schema-check.ts`.
- `roles.ts` (ADR-0020) — `ensureAppRole(ownerPool, { appRole, passwordFile, schemas })`: на пуле владельца, после
  миграций, под той же блокировкой; создаёт роль (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  NOBYPASSRLS`) или возвращает ей атрибуты, пароль — готовым SCRAM-verifier и только если не совпал; `appRoleGrants` —
  `USAGE` на схемы, `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`, `USAGE ON ALL SEQUENCES`, `ALTER DEFAULT
  PRIVILEGES FOR ROLE <владелец>`, отзыв `TRUNCATE, REFERENCES, TRIGGER, MAINTAIN`, `CREATE` на `public` у `PUBLIC`,
  `SELECT` на `pg_stats`, `pg_stats_ext`, `pg_stats_ext_exprs` у `PUBLIC`; роль = владелец — `AppRoleError`.
  `assertAppRole(pool)` / `appRoleProblems(pool)` (для `make doctor`, T-011) — отказ роли с `rolsuper`, `rolcreatedb`,
  `rolcreaterole`, `rolreplication`, `rolbypassrls`, членством в любой роли или `CREATE` на `public`.
  `appRoleOptions(dbConfig)`, `APP_SCHEMAS` (`public`, `pgboss`), `scramVerifier`, `scramMatches`.

## Можно зависеть от
`@kosht/kernel`, `@kosht/contract` (каталог ошибок; `SiteEvent`, `EntityKind`, `EntityId` — `realtime/`), `zod`; `drizzle-orm`, `pg` — только `db/` (+ `drizzle-orm` в
`schema.ts`/`*.repo.ts` settings, secrets, rate-limit); `libpg-query` — только `db/` (ADR-0019); `pino`, `pino-roll` —
`logging/`; `pino-pretty` — только цели `make logs`/`log-find` (dev); `pg-boss` — только `jobs/` (ADR-0008); `hono`, `@hono/node-server`, `@orpc/server`,
`@orpc/openapi` — `http/` (oRPC — ещё `main/` и `api/` модулей); `node:worker_threads` — `sandbox/`. Модули — нет.

## Запреты
- `drizzle()`, `pg`, `$client`, `unsafeRaw` вне `platform/db` и тестов; `ISOLATION_VIOLATION` не ловить и не глушить.
- `process.env` вне `config/` и `entrypoints/`; значения переменных и секретов — в тексте ошибок и в логах.
- Лог: данные в строке сообщения (только ключ `^[a-z]+(\.[a-z0-9-]+)+$`), поля вне белого списка (`fields.ts`),
  `message`/`detail`/`where` ошибок pg, параметры `DrizzleQueryError` (OBS-04).
- `clock/` не импортирует `settings/` (цикл): пояс подаётся функцией.
- `pg_notify`, `LISTEN` и `pg.Client` вне `db/listen.ts`; имя канала, склеенное с данными; ключ потока хаба из
  сообщения канала или входа запроса (только `context.s.scope`); данные (тексты, суммы) в сигнале realtime.
- `audit.ts`, `audited.ts` вне `platform/db` и тестов; `connection.ts`, `migrate.ts` — ещё и в `main/`
  (правило `db-internals-only-in-platform-db`, пути — `PLATFORM_DB_INTERNALS` в `tooling/architecture/rules.ts`).
- `ISOLATION_VIOLATION` не входит в каталог ошибок `@kosht/contract`: наружу — как `INTERNAL` (`toErrorBody`).
- `VIEW`, функции и триггеры в `public`; `household_id` nullable; таблица вне реестров (`schema-check.ts`).
- `pg-boss` вне `jobs/` (правило `pg-boss-only-in-platform-jobs`); `boss-db.ts` вне `jobs/`, `main/` и тестов
  (`boss-db-only-in-jobs`); `makeScope` из конверта задачи — только `jobs/`; `singletonKey` не через `jobKey`
  (`enqueue` бросает); `userId`/`householdId` в нагрузке задачи или события (`isolation.mjs`); событие на каждую
  строку в цикле вместо пачки `ids`; `setTimeout`/`setInterval` вместо `defineSchedule`.

## Как тестировать
- `pnpm vitest run apps/server/src/platform` (unit и int); `make test-int` — только Postgres.
- Очередь на настоящем pg-boss под `kosht_app` — два файла: `jobs/jobs.int.test.ts` (права, транзакция, владелец из
  конверта, повтор, расписание с поясом, обход) и `events/events.int.test.ts` (публикация в транзакции, 300 событий
  → ≤ 5 задач, два домохозяйства); ожидание — промис из обработчика, опрос 0,5 с. Догон расписаний — на `FakeClock`
  без pg-boss (`jobs/schedule.int.test.ts`), журнал — `jobs/jobs.repo.int.test.ts`. Тест процессов: у очереди нет
  своих соединений, SIGTERM `worker`/`bot` — меньше 10 с.
- Живые сигналы: модульно — `realtime/*.test.ts` (куски NOTIFY, очередь, хаб, паузы переподключения на поддельных
  таймерах); на Postgres — `db/listen.int.test.ts` (LISTEN, потеря, NOTIFY в транзакции) и
  `main/events-stream.int.test.ts` (SSE на порту 0 через `readSse`: A не получает сигналы B — барьер-«часовой», 300
  сигналов, 1000 id, откат и коммит, `pg_terminate_backend`, остановка). SIGTERM при открытом SSE — `processes.int.test.ts`.
- Канарейки логов — `logging/log-file.test.ts` (по тексту файла pino-roll: email, карта, сумма, текст документа,
  значение строки в ошибке pg), секретов — `secrets/secrets.int.test.ts`; логгер в память для тестов —
  `logging/__fixtures__/memory-logger.ts`.
- Лимиты: 50 параллельных попыток → ровно `limit` (`rate-limit.int.test.ts`); кэш настроек — `FakeClock`.
- Канарейки аудитора — `audit.test.ts`, `scoped-db.test.ts` (без БД), `isolation.int.test.ts` (две семьи, хеш B).
- Права роли приложения — `roles.int.test.ts` (сырой `pg.Client` под `kosht_app` мимо аудитора: 42501 на файлы
  сервера, `COPY … PROGRAM`, DDL, роли, статистику, журнал миграций; гонка трёх баз; пароль вне лога контейнера
  `db` — тест читает `docker compose logs db`). Оракул `audit-differential.int.test.ts` — владелец: он проверяет
  аудитор, а не права.
- Сверка аудитора с Postgres — `audit-differential.int.test.ts`: варианты записи запросов (детерминированный ГПСЧ),
  оракул — сама база в транзакции с откатом (тронутые таблицы — `pg_stat_xact_user_tables`, утечка — данные или
  отпечаток B, а также созданное запросом отношение — `pg_class`). По умолчанию 24 варианта на запрос (~5 с); полный прогон — `AUDIT_DIFF_RUNS=800` (~35 тыс.
  вариантов, ~140 с), зерно — `AUDIT_DIFF_SEED`. Каждый текст, принятый базой, принимает и парсер (кроме
  известного расхождения со склейкой строки); ложные срабатывания — в лог по причине и шаблону, промах — красный тест.
- Тестовая схема `fx_*` и её миграции — `db/__fixtures__/` (`make db-generate DRIZZLE_CONFIG=…/__fixtures__/drizzle.config.ts`).

## Роли БД (ADR-0020)
- Приложение работает ролью `kosht_app` (только DML на таблицах `APP_SCHEMAS`); владелец `kosht` (суперпользователь
  из `compose.yaml`) — миграции, выдача прав, `make migrate`, сборка тестового шаблона. Схему с таблицами
  приложения вне `public` (`pgboss`) создаёт и мигрирует владелец, а роль получает права через `APP_SCHEMAS`.
- Роль общая для кластера, блокировка миграций — на базу: правка роли идёт только при расхождении, транзакция
  повторяется на 23505/42710/XX000. Тест, который портит роль, работает со своей ролью `test_*` (`testRoleName`).
- Права и права по умолчанию живут в каталогах базы и копируются с ней (клон шаблона).
- Пароль роли в лог Postgres не попадает: SCRAM-verifier вместо пароля и `SET LOCAL log_statement = 'none'`,
  `log_min_error_statement = 'panic'`, `log_min_duration_* = -1` в транзакции выдачи.

## Подводные камни
- oRPC: ошибка внутри потока (итератор событий) после его начала идёт мимо `clientInterceptors` — поток
  `events.stream` ошибок не бросает, а заканчивается причиной (`done`).
- Поток хаба — итератор, а не `async function*`: `return()` генератора, ждущего события, встаёт в очередь за этим
  ожиданием, и отключившийся клиент держал бы поток в хабе (и место в пределе 8 на пользователя).
- `events.stream` слушает только `api`: сигналы, отправленные, пока LISTEN переподключается, теряются — поэтому после
  переподключения хаб закрывает все потоки (`reconnect`), и клиент перезапрашивает данные.
- NOTIFY доставляется в базе, где он отправлен: каждая тестовая база (`test_*`) — свой канал. `implement(contract).router` не собирается без всех процедур контракта.
- Прокси Vite — без `changeOrigin`: проверка CSRF сверяет `Origin` с `Host` (`127.0.0.1:5173`), иначе 403.
- Ключ события: голова — только строчные буквы (`ratelimit.exceeded`, не `rate-limit.exceeded`): тип `EventKey` и
  проверка при записи совпадают; неверный ключ при записи заменяется на `log.bad-key` без текста.
- `redact` pino (ADR-0010: «страховка») не подключён: поля вне белого списка отбрасываются до pino, страховать нечего.
- Ротация pino-roll — по местному времени процесса (в контейнере — UTC), а не по настройке пояса.
- `scrub` узнаёт только данные с формой; поэтому сообщения ошибок pg не пишутся вовсе, а `.gitignore`/`.oxfmtrc.json`
  исключают только корневую `/secrets/` — папка `platform/secrets` с кодом в git и в проверках.
- `peek` настроек отдаёт последнее известное значение и обновляет устаревшее в фоне: сразу после смены пояса другим
  процессом часы могут отстать на один вызов после 5 с.
- Аудитор читает запрос парсером PostgreSQL 18 (`libpg-query`, WASM, ADR-0019): таблицы, предикаты, цели `SET`,
  `INSERT … VALUES`, `MERGE`, `SELECT … INTO` (в любом узле: Postgres берёт `INTO` у левой ветки `UNION`), CTE и
  подзапросы — из дерева. Текст, который парсер не принял, — `UNPARSEABLE_SQL`
  (громко; текст ошибки парсера — не в сообщение, OBS-04). Известное расхождение `libpg-query` 18.2.0 с базой:
  склейку строки через «--»-комментарий (`'x' --c↵'y'`) парсер не читает — отказ, а не утечка. Модуль WASM
  загружается `await loadModule()` при импорте `audit.ts`; разбор кэшируется по тексту, значения `$n`
  сравниваются на каждом вызове. Время аудита непрокэшированного запроса — 16–25 мкс (у лексера T-004 было 8–13 мкс;
  бюджет — 50 мкс), из кэша — ~0,05 мкс. Булев анализ по областям (`narrowLevel`): обращение сужает конъюнкт
  WHERE или ON (внешнего соединения — только для nullable-стороны), OR — если сужает каждая ветка; `NOT`, `CASE`,
  `filter (where …)`, список select, подзапрос и HAVING — не сужают; предикат без квалификатора — только при одной
  пользовательской таблице в области. Функции, читающие файлы сервера (`pg_read_file`, `pg_read_binary_file`,
  `pg_ls_*`, `pg_stat_file`, `lo_import`, `lo_export`), и обращения к статистике планировщика (`pg_stats`,
  `pg_stats_ext`, `pg_stats_ext_exprs`, `pg_statistic`, `pg_statistic_ext_data` в любой схеме) — `HIDDEN_SQL`: роли
  приложения они закрыты правами (ADR-0020), но аудитор — независимый замок (у суперпользователя страницы таблицы
  читаются мимо `RangeVar`, статистика показывает значения строк всех домохозяйств). Не видит: функции с побочным эффектом без доступа к чужим строкам
  (`pg_advisory_lock`, `pg_sleep`, `nextval`, `pg_terminate_backend`) — их ловит ревью; `pg_notify` пропускает
  намеренно — его зовёт только `db/listen.ts` (`notify`, канал — параметром); VIEW и
  функции базы; побочные каналы (ошибка в выражении рядом с фильтром на чужой строке).
  INSERT в пользовательскую таблицу — только отдельной командой без WITH и только VALUES; MERGE — нигде;
  пользовательская таблица — только в схеме `public`. Незагруженная схема не аудируется — старт (T-007) и
  `production-schema.int.test.ts` импортируют все схемы модулей.
- Drizzle закреплён точно (`1.0.0-rc.5`): после обновления красные канарейки = стоп (запасной путь — наследник `Pool`).
- `ON DELETE SET NULL` на составном FK drizzle-kit пишет неверно — правьте миграцию на `SET NULL (col)`.
- Водяной знак: ADR-0008 кладёт его «в доменную таблицу», ARCHITECTURE §9 — в `background_job_run`. Решено так:
  расписания платформы (`defineSchedule`, без scope) держат его в `background_job_run` по ключу расписания, а
  расписания «для каждого пользователя» (`defineSweep` + задача) — в таблицах своих модулей.
- Очередь создаётся `createQueue` при старте каждого процесса и уже существующую не меняет: смена политики
  (`singletonKey` ⇒ `short`) или `retryLimit` готовой задачи — только новым именем очереди или правкой владельцем.
- Подписка без своего ключа получает `jobKey(scope, sha256(нагрузки))`: очередь `short` без ключа держала бы одну
  ожидающую задачу на все домохозяйства.
- Итог задачи для pg-boss — `perJobResults`: `deadletter` без очереди мёртвых писем = `failed` без повторов
  (так отбрасываются задачи с чужим владельцем и не-retryable ошибки).
- pg-boss 12.38 при `reindex: false` всё равно ищет раздутые индексы через `pg_stats`, а он роли приложения закрыт
  (ADR-0020) — 42501 в конце прохода обслуживания. Поиск выключает наш патч `patches/pg-boss@12.38.0.patch`
  (`reindex: false` → проход без поиска; `patchedDependencies` в `pnpm-workspace.yaml`): новая версия pg-boss не
  поставится, пока патч не перенесён, а проход `supervise` под ролью приложения проверяет `jobs.int.test.ts`.
  Индексы pgboss перестраивать некому: владелец есть только на старте.
- Служебные запросы pg-boss (многокомандные транзакции с `SET LOCAL` и `pg_advisory_xact_lock`) аудитор SQL не
  принимает (`MULTIPLE_STATEMENTS`, `STATEMENT_NOT_ALLOWED`), поэтому `bossDb` идёт мимо него; через аудитор —
  только постановка в транзакции (`bossTransaction`). Пользовательских таблиц pg-boss не называет; держат права роли.
