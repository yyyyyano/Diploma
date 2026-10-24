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
  `reason`, `table`); вызывается из `Logger` Drizzle (`audited.ts`) до отправки запроса.
- `connection.ts` (`DATABASE_URL` без пароля + файл `DB_PASSWORD_FILE`, по умолчанию `secrets/db_password`; T-005
  перенесёт чтение окружения в config), `migrate.ts` (`runMigrations` под `pg_advisory_lock`), `schema-check.ts`.

## Можно зависеть от
`@kosht/kernel`, `drizzle-orm`, `pg` (только `db/`). Модули — нет.

## Запреты
- `drizzle()`, `pg`, `$client`, `unsafeRaw` вне `platform/db` и тестов; `ISOLATION_VIOLATION` не ловить и не глушить.
- `ISOLATION_VIOLATION` не входит в каталог ошибок `@kosht/contract`: наружу (T-005) — как `INTERNAL`.
- `VIEW`, функции и триггеры в `public`; `household_id` nullable; таблица вне реестров (`schema-check.ts`).

## Как тестировать
- `pnpm vitest run apps/server/src/platform/db` (unit и int); `make test-int` — только Postgres.
- Канарейки аудитора — `audit.test.ts`, `scoped-db.test.ts` (без БД), `isolation.int.test.ts` (две семьи, хеш B).
- Тестовая схема `fx_*` и её миграции — `db/__fixtures__/` (`make db-generate DRIZZLE_CONFIG=…/__fixtures__/drizzle.config.ts`).

## Подводные камни
- Аудитор проверяет текст: `… OR true`, предикат в `select`, VIEW и функции он не видит. Незагруженная схема не
  аудируется — старт (T-007) и `production-schema.int.test.ts` импортируют все схемы модулей.
- Drizzle закреплён точно (`1.0.0-rc.5`): после обновления красные канарейки = стоп (запасной путь — наследник `Pool`).
- `ON DELETE SET NULL` на составном FK drizzle-kit пишет неверно — правьте миграцию на `SET NULL (col)`.
