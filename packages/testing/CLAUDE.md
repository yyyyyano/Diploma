# Пакет `@kosht/testing` — помощники тестов: часы, фабрики примитивов, тестовая база

## Назначение
Всё, что делает тесты офлайн и детерминированными (`.claude/rules/testing.md`, ARCHITECTURE §12), и генератор тестов
изоляции. Остальное (кассеты моделей) добавляют задачи, которым оно нужно.

## Кто использует
Только тесты (`*.test.ts`, `*.int.test.ts`, `e2e/`) во всех пакетах и приложениях; боевому коду — запрещено.

## Публичный API
- Вход: `packages/testing/src/index.ts`.
- `FakeClock implements Clock` (`@kosht/kernel`): `new FakeClock("2026-10-21T09:00:00Z", timeZone?)`, `now()`,
  `today()` — `LocalDate.fromInstant` по поясу (по умолчанию `Europe/Minsk`, NFR-23), `set(instant)`, `advance(ms)`.
- Фабрики примитивов: `byn(minor)` — деньги BYN в копейках, `day("2026-10-21")`, `testUserId(n)`,
  `testHouseholdId(n)`, `testTraceId(n)` — валидные uuidv7 по номеру, `testScope({ user, household })`.
- `MemoryBlobStore` — хранилище файлов в памяти с поведением `platform/blob-store` сервера (`put`, `putStream`, `get`,
  `open` → `Blob`, `delete`, `deleteHousehold`; id — uuid-бренды, иначе `RangeError`; копии массивов), `size`. Форму сверяет
  `apps/server/src/platform/blob-store/blob-store.test.ts`: один набор проверок для обоих хранилищ.
- `InlineJobs<Tx>(find)` — очередь задач без pg-boss для тестов сценариев: `enqueue(tx, job, payload)` находит
  обработчик функцией `find(name)` и выполняет его сразу в той же транзакции; нет обработчика — ошибка; `enqueued` —
  поставленные по порядку; `discardHousehold` — 0 (ожидающих задач у неё не бывает); `overview()` — пустой обзор. Форму с портом `Jobs` сверяет `apps/server/src/platform/jobs/inline-jobs.test.ts`.
- `readZip(bytes)` — записи ZIP-архива (путь → содержимое) через `yauzl`: проверка архива «Мои данные» (PRIV-05).
- `readSse(body)` — события Server-Sent Events из тела ответа `fetch` по порядку: `{ event, data }` и комментарии
  keepalive (`{ comment: true }`); для тестов `events.stream` (T-061): клиента oRPC на сервере нет.
- Генератор тестов изоляции (`isolation.ts`, ROLE-01, замок 5): `generate({ contract, procedures, tools, fixtures })`
  → `{ cases, exempted, problems }` — реестры приходят аргументом (дерево контракта, путь → доступ
  `authed | admin | public | local`, имена инструментов); у каждой процедуры и инструмента (`tool:<имя>`) — фикстура
  `{ input: (b) => вход из данных B }` или `{ exempt: "причина ≥ 10 символов" }`, иначе проблема «добавьте фикстуру»;
  лишняя фикстура и процедура вне дерева сервера — тоже проблемы. `contractProcedurePaths`, `leakedIds(ответ, id B)`,
  `uncoveredUserTables(таблицы, владельцы)` — полнота `defineUserData`. Сам тест —
  `apps/server/src/main/isolation.registry.int.test.ts`.
- Вход `@kosht/testing/db` (`src/db.ts`, отдельно — чтобы unit-тесты не грузили `pg`): `createTestDb()` — своя база
  `test_<запуск>_<процесс>_<n>` из шаблона (`beforeAll`; `afterAll` — `drop()`) с двумя пулами: `pool` — роль
  приложения `kosht_app` (только DML, как приложение), `owner` — владелец (DDL, фикстуры, служебные запросы; ADR-0020).
  `TestDbContext` (`inject("testDb")`): `admin` (владелец из `MIGRATION_*`: создание и удаление `test_*`, шаблон),
  `app` (роль приложения из `DATABASE_URL`), `template`, `runId`. `testRoleName()` и `dropTestRole(admin, name)` — своя
  роль `test_<запуск>_<процесс>_r<n>` для тестов, которые портят роль (роль общая для кластера). `prepareTemplate(…,
  { rebuild })`, `dropOrphans` (базы, затем роли `test_*` мёртвых прогонов), `fingerprintDir`, `dropDatabase` — для
  globalSetup проекта `int` (он в `apps/server/src/platform/db/__fixtures__/`).

## Можно зависеть от
`@kosht/kernel`; `pg` — только в `src/db.ts` (исключение правила `drizzle-and-pg-only-in-db`); `vitest` (`inject`);
`yauzl` — только `src/zip.ts`.

## Запреты
- Импорт из боевого кода (`testing-not-in-prod` в `.dependency-cruiser.mjs`) и из `apps/server`: миграции в шаблон
  применяет globalSetup сервера, пакет только клонирует и удаляет базы.
- Базы и роли без префикса `test_` — не создаются и не удаляются (ошибка до запроса).
- Случайность и реальное время: данные одинаковы при каждом запуске.
- Реальные ПД, `samples/`, реальные выписки (NFR-18) — только синтетика.

## Как тестировать
- `pnpm vitest run packages/testing`; `db.int.test.ts` — в проекте `int` (`make test-int`, Postgres поднимается сам).

## Подводные камни
- `makeScope` здесь разрешён (ARCHITECTURE §6.4): `isolation.mjs` пакет не проверяет — не выносите отсюда Scope
  в боевой код.
- `FakeClock.now()` возвращает копию: правка возвращённой `Date` часы не двигает.
- Шаблон `test_tpl_<отпечаток>` (папка `apps/server/drizzle` + текст выдачи прав роли приложения) переиспользуется
  между прогонами; изменилась миграция или выдача прав — собирается новый, старый удаляется. Роль приложения не
  входит (нет роли или пароль из `secrets/db_app_password` не подходит) — шаблон собирается заново, и сборка приводит
  роль в порядок. Права роли копируются с шаблоном в клон. Клон — стратегией по умолчанию (WAL_LOG, ≈30 мс; FILE_COPY ≈77 мс).
