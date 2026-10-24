# `apps/server/src/platform` — ярус 0 сервера: техника без бизнеса

## Назначение
Общая техника всех модулей (ARCHITECTURE §2, §6): сейчас — `db` (T-004); config, logging, errors, http и др.
добавляют T-005…T-007. Используют модули, `main/compose.ts`, точки входа; модули сюда не импортируются.

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
- `connection.ts` (`DATABASE_URL` без пароля + файл `DB_PASSWORD_FILE`, по умолчанию `secrets/db_password`; T-005
  перенесёт чтение окружения в config), `migrate.ts` (`runMigrations` под `pg_advisory_lock`), `schema-check.ts`.

## Можно зависеть от
`@kosht/kernel`, `drizzle-orm`, `pg` (только `db/`), `libpg-query` (только `db/`, аудитор SQL — ADR-0019). Модули —
нет.

## Запреты
- `drizzle()`, `pg`, `$client`, `unsafeRaw` вне `platform/db` и тестов; `ISOLATION_VIOLATION` не ловить и не глушить.
- `audit.ts`, `audited.ts` вне `platform/db` и тестов; `connection.ts`, `migrate.ts` — ещё и в `main/`
  (правило `db-internals-only-in-platform-db`, пути — `PLATFORM_DB_INTERNALS` в `tooling/architecture/rules.ts`).
- `ISOLATION_VIOLATION` не входит в каталог ошибок `@kosht/contract`: наружу (T-005) — как `INTERNAL`.
- `VIEW`, функции и триггеры в `public`; `household_id` nullable; таблица вне реестров (`schema-check.ts`).

## Как тестировать
- `pnpm vitest run apps/server/src/platform/db` (unit и int); `make test-int` — только Postgres.
- Канарейки аудитора — `audit.test.ts`, `scoped-db.test.ts` (без БД), `isolation.int.test.ts` (две семьи, хеш B).
- Сверка аудитора с Postgres — `audit-differential.int.test.ts`: варианты записи запросов (детерминированный ГПСЧ),
  оракул — сама база в транзакции с откатом (тронутые таблицы — `pg_stat_xact_user_tables`, утечка — данные или
  отпечаток B). По умолчанию 24 варианта на запрос (~4 с); полный прогон — `AUDIT_DIFF_RUNS=800` (~28 тыс.
  вариантов, ~110 с), зерно — `AUDIT_DIFF_SEED`. Каждый текст, принятый базой, принимает и парсер (кроме
  известного расхождения со склейкой строки); ложные срабатывания — в лог по причине и шаблону, промах — красный тест.
- Тестовая схема `fx_*` и её миграции — `db/__fixtures__/` (`make db-generate DRIZZLE_CONFIG=…/__fixtures__/drizzle.config.ts`).

## Подводные камни
- Аудитор читает запрос парсером PostgreSQL 18 (`libpg-query`, WASM, ADR-0019): таблицы, предикаты, цели `SET`,
  `INSERT … VALUES`, `MERGE`, CTE и подзапросы — из дерева. Текст, который парсер не принял, — `UNPARSEABLE_SQL`
  (громко; текст ошибки парсера — не в сообщение, OBS-04). Известное расхождение `libpg-query` 18.2.0 с базой:
  склейку строки через «--»-комментарий (`'x' --c↵'y'`) парсер не читает — отказ, а не утечка. Модуль WASM
  загружается `await loadModule()` при импорте `audit.ts`; разбор кэшируется по тексту, значения `$n`
  сравниваются на каждом вызове. Время аудита непрокэшированного запроса — 13–23 мкс (было 8–12 мкс у лексера;
  бюджет — 50 мкс), из кэша — ~0,05 мкс. Не видит: `… OR true`, `NOT household_id = $1`, предикат в `select`/
  `CASE`/`filter (where …)`, принадлежность предиката без алиаса (предикаты считаются штуками), VIEW и функции.
  INSERT в пользовательскую таблицу — только отдельной командой без WITH и только VALUES; MERGE — нигде;
  пользовательская таблица — только в схеме `public`. Незагруженная схема не аудируется — старт (T-007) и
  `production-schema.int.test.ts` импортируют все схемы модулей.
- Drizzle закреплён точно (`1.0.0-rc.5`): после обновления красные канарейки = стоп (запасной путь — наследник `Pool`).
- `ON DELETE SET NULL` на составном FK drizzle-kit пишет неверно — правьте миграцию на `SET NULL (col)`.
