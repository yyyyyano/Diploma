# `apps/server/src/platform` — ярус 0 сервера: техника без бизнеса

## Назначение
Общая техника всех модулей (ARCHITECTURE §2, §6, §9): `db` (T-004); `config`, `logging`, `errors`, `clock`,
`blob-store`, `settings`, `secrets`, `rate-limit` (T-005); `http` (T-059; точки входа — `src/entrypoints`);
`jobs`, `events`, `realtime` — T-006. Используют модули, `main/compose.ts`, точки входа; модули сюда не импортируются.
Общего `index.ts` ни у одной папки нет: возможность = файл.

## Публичный API — T-005 (NFR-15, NFR-16, NFR-23, OBS-01/02/04/06, SEC-02)
- `config/config.ts` — `loadConfig(env?)` → `AppConfig` (`db`, `listeners.local/lan`, `trustedOrigins`, `dataDir`
  абсолютный, `logLevel`, `masterKey`, `env(name)` — чтение переменной для `defineSetting`/`defineSecret`);
  `loadDbConfig(env?)` — только `DATABASE_URL`/`DB_PASSWORD_FILE`, без мастер-ключа (`make migrate`, globalSetup
  тестов); `DbConfig`, `ConfigError` (имя переменной и ожидание, **без значения**), `CONFIG_VARIABLES` (сверяется с
  `.env.example`). `process.env` читают только `config/` и `entrypoints/` (тест `env-readers.test.ts`).
- `config/master-key.ts` — `MasterKey` (32 байта из `secrets/master.key`; `derive("secrets/v1" | "rate-limit/v1")` —
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
- `blob-store/blob-store.ts` — `BlobStore` (`put`, `get` → `undefined` если нет, `delete`, `deleteHousehold`),
  `createLocalFsBlobStore(<DATA_DIR>/files)`: путь `<householdId>/<fileId>` (`FileId` — в `@kosht/kernel`), id
  проверяются схемой (не uuid — `RangeError`), tmp+rename, папки 0700, файлы 0600. В тестах — `MemoryBlobStore`.
- `settings/settings.ts` — `defineSetting({ key, schema, default, env?, fromEnv? })` (реестр; помощник модуля T-007
  только регистрирует здесь), `registeredSettings()`, `createSettings({ db, clock, env, log })` → `get` (кэш ≤ 5 с),
  `peek` (синхронно, для часов), `source`, `set` (не по схеме — `VALIDATION`), `reset`. `settings/time-zone.ts` —
  `TIME_ZONE` (`system.time-zone`, env `TIME_ZONE`, по умолчанию `Europe/Minsk`); в корне композиции:
  `createClock(() => settings.peek(TIME_ZONE))`.
- `secrets/secrets.ts` — `defineSecret({ name, env? })`, `registeredSecrets()`, `createSecrets({ db, masterKey, env,
  clock, log })` → `status` (`set | unset | unreadable`), `reveal` (только коду), `set`, `clear`.
- `rate-limit/rate-limit.ts` — `defineRateRule({ name, limit, windowMs })`, `createRateLimiter({ db, clock, masterKey,
  log, timeoutMs? })` → `hit` (`{ allowed, remaining, retryAfterMs }`), `enforce` (`RATE_LIMITED` с
  `retryAfterSeconds`); БД недоступна или молчит дольше 2 с — `UNAVAILABLE`. Перед записью удаляется до 100
  (`PURGE_BATCH`) строк того же правила из прошлых окон (индекс `(rule, window_start)`) — отдельной задачи
  очистки нет.

## Публичный API — `http/` (T-059: SEC-01, NFR-24, R40, OBS-01/02, ADR-0005, ADR-0016)
- `app.ts` — `createApp({ listener, trustedOrigins, log, ready, routes? })` → `HttpApp` (Hono) на один слушатель:
  request-id и контекст лога → Host и CSRF → маршрут → заголовки безопасности и строка `http.request` (`method`,
  `httpStatus`, `ms`, `listener`) на каждом ответе; `/healthz` (без БД), `/readyz` (`ready()` ≤ 2 с, иначе 503
  `UNAVAILABLE` без деталей); неизвестный маршрут — 404 `NOT_FOUND`; исключение — 500 `INTERNAL` + `http.error` со
  стеком; `routes` — маршруты процесса до статики.
- `guard.ts` — `ListenerName` (`local | lan`), `SECURITY_HEADERS` (CSP, `nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy: camera=(self), microphone=(self)`; без HSTS), `isAllowedHost(host, listener)` (local — `localhost`,
  `127.0.0.1`, `[::1]`; lan — они же и IP; имена — нет), `isSameSiteRequest` (кроме GET/HEAD/OPTIONS: `Sec-Fetch-Site`
  `cross-site`/`same-site` — отказ; `Origin` = `http://<Host>` или из `TRUSTED_ORIGINS`; оба пусты — не браузер),
  `requestIdFrom` (`[A-Za-z0-9-]{8,64}`, иначе новый uuid).
- `error-response.ts` — `httpErrorBody` / `errorResponse`: `{ defined, code, status, message: <код>, data: { requestId,
  params } }` — форма `ORPCError.toJSON()` oRPC 1.16.1, одна на все ответы об ошибке.

## Таблицы платформы
`settings`, `secrets`, `rate_limits` — `systemTable` платформы (без домохозяйства), схема — `<папка>/schema.ts`,
запросы — `<папка>/<папка>.repo.ts` через `SystemDb`. Флаг `tables` в `modules.ts` не нужен: правило
`system-db-only-for-flagged-modules` смотрит только на `modules/*`. Схему видят только своя папка,
`drizzle.config.ts` и тесты (правило `schema-only-in-infrastructure`); `drizzle-orm` вне `platform/db` — только в
этих `schema.ts` и `*.repo.ts` (исключение `drizzle-and-pg-only-in-db`, решение по T-005).

## Публичный API — `db/` (ROLE-01, SEC-04, PRIV-07, ADR-0006). Общего `index.ts` нет: возможность = файл
- `tables.ts` — виды таблиц: `userOwnedTable` (id `uuidv7()`, `household_id`/`user_id` NOT NULL, `created_at`,
  `updated_at`, PK `(household_id, id)`), `systemTable`, `publicTable` (без владельца), `ownedFk` (составной FK +
  индекс). Колонки — `snake_case` из имён свойств (casing задаёт таблица). Таблица попадает в реестр при импорте схемы.
- `scoped-db.ts` — `createScopedDb(pool, scope): ScopedDb` (`own`, `insert`, `update`, `delete`, `transaction`;
  вложенная — SAVEPOINT); выключателя аудита нет.
- `system-db.ts` (`createSystemDb`), `cross-tenant.ts` (`crossTenant(pool, label, find)` — только
  `id, household_id, user_id`), `unsafe-raw.ts` (без аудита: миграции и тесты) — пути = `PLATFORM_DB` в
  `tooling/architecture/rules.ts`; переименовали файл — правьте `PLATFORM_DB` (тест T-002 краснеет).
- `audit.ts` — `auditQuery(sql, params, mode, owned)` и `IsolationViolation` (`code: "ISOLATION_VIOLATION"`,
  `reason: ViolationReason` — в том числе `UNPARSEABLE_SQL`, `table`); вызывается из `Logger` Drizzle (`audited.ts`)
  до отправки запроса.
- `connection.ts` (`createPool(config: DbConfig)`: адрес без пароля, пароль из файла `DB_PASSWORD_FILE`; `DbConfig`
  и чтение окружения — в `config/`), `migrate.ts` (`runMigrations` под `pg_advisory_lock`), `schema-check.ts`.

## Можно зависеть от
`@kosht/kernel`, `@kosht/contract` (каталог ошибок), `zod`; `drizzle-orm`, `pg` — только `db/` (+ `drizzle-orm` в
`schema.ts`/`*.repo.ts` settings, secrets, rate-limit); `libpg-query` — только `db/` (ADR-0019); `pino`, `pino-roll` —
`logging/`; `pino-pretty` — только цели `make logs`/`log-find` (dev); `hono`, `@hono/node-server`, `@orpc/server`,
`@orpc/openapi` — `http/` (oRPC — ещё `main/` и `api/` модулей). Модули — нет.

## Запреты
- `drizzle()`, `pg`, `$client`, `unsafeRaw` вне `platform/db` и тестов; `ISOLATION_VIOLATION` не ловить и не глушить.
- `process.env` вне `config/` и `entrypoints/`; значения переменных и секретов — в тексте ошибок и в логах.
- Лог: данные в строке сообщения (только ключ `^[a-z]+(\.[a-z0-9-]+)+$`), поля вне белого списка (`fields.ts`),
  `message`/`detail`/`where` ошибок pg, параметры `DrizzleQueryError` (OBS-04).
- `clock/` не импортирует `settings/` (цикл): пояс подаётся функцией.
- `audit.ts`, `audited.ts` вне `platform/db` и тестов; `connection.ts`, `migrate.ts` — ещё и в `main/`
  (правило `db-internals-only-in-platform-db`, пути — `PLATFORM_DB_INTERNALS` в `tooling/architecture/rules.ts`).
- `ISOLATION_VIOLATION` не входит в каталог ошибок `@kosht/contract`: наружу — как `INTERNAL` (`toErrorBody`).
- `VIEW`, функции и триггеры в `public`; `household_id` nullable; таблица вне реестров (`schema-check.ts`).

## Как тестировать
- `pnpm vitest run apps/server/src/platform` (unit и int); `make test-int` — только Postgres.
- Канарейки логов — `logging/log-file.test.ts` (по тексту файла pino-roll: email, карта, сумма, текст документа,
  значение строки в ошибке pg), секретов — `secrets/secrets.int.test.ts`; логгер в память для тестов —
  `logging/__fixtures__/memory-logger.ts`.
- Лимиты: 50 параллельных попыток → ровно `limit` (`rate-limit.int.test.ts`); кэш настроек — `FakeClock`.
- Канарейки аудитора — `audit.test.ts`, `scoped-db.test.ts` (без БД), `isolation.int.test.ts` (две семьи, хеш B).
- Сверка аудитора с Postgres — `audit-differential.int.test.ts`: варианты записи запросов (детерминированный ГПСЧ),
  оракул — сама база в транзакции с откатом (тронутые таблицы — `pg_stat_xact_user_tables`, утечка — данные или
  отпечаток B, а также созданное запросом отношение — `pg_class`). По умолчанию 24 варианта на запрос (~5 с); полный прогон — `AUDIT_DIFF_RUNS=800` (~35 тыс.
  вариантов, ~140 с), зерно — `AUDIT_DIFF_SEED`. Каждый текст, принятый базой, принимает и парсер (кроме
  известного расхождения со склейкой строки); ложные срабатывания — в лог по причине и шаблону, промах — красный тест.
- Тестовая схема `fx_*` и её миграции — `db/__fixtures__/` (`make db-generate DRIZZLE_CONFIG=…/__fixtures__/drizzle.config.ts`).

## Подводные камни
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
  `pg_ls_*`, `pg_stat_file`, `lo_import`, `lo_export`), — `HIDDEN_SQL`: роль приложения — суперпользователь, и
  страницы таблицы читаются мимо `RangeVar`. Не видит: функции с побочным эффектом без доступа к чужим строкам
  (`pg_advisory_lock`, `pg_sleep`, `pg_notify`, `nextval`, `pg_terminate_backend`) — их ловит ревью; VIEW и
  функции базы; побочные каналы (ошибка в выражении рядом с фильтром на чужой строке).
  INSERT в пользовательскую таблицу — только отдельной командой без WITH и только VALUES; MERGE — нигде;
  пользовательская таблица — только в схеме `public`. Незагруженная схема не аудируется — старт (T-007) и
  `production-schema.int.test.ts` импортируют все схемы модулей.
- Drizzle закреплён точно (`1.0.0-rc.5`): после обновления красные канарейки = стоп (запасной путь — наследник `Pool`).
- `ON DELETE SET NULL` на составном FK drizzle-kit пишет неверно — правьте миграцию на `SET NULL (col)`.
