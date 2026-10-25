# Пакет `@kosht/testing` — помощники тестов: часы, фабрики примитивов, тестовая база

## Назначение
Всё, что делает тесты офлайн и детерминированными (`.claude/rules/testing.md`, ARCHITECTURE §12). Остальное
(кассеты моделей, генератор тестов изоляции) добавляют задачи, которым оно нужно.

## Кто использует
Только тесты (`*.test.ts`, `*.int.test.ts`, `e2e/`) во всех пакетах и приложениях; боевому коду — запрещено.

## Публичный API
- Вход: `packages/testing/src/index.ts`.
- `FakeClock implements Clock` (`@kosht/kernel`): `new FakeClock("2026-10-21T09:00:00Z", timeZone?)`, `now()`,
  `today()` — `LocalDate.fromInstant` по поясу (по умолчанию `Europe/Minsk`, NFR-23), `set(instant)`, `advance(ms)`.
- Фабрики примитивов: `byn(minor)` — деньги BYN в копейках, `day("2026-10-21")`, `testUserId(n)`,
  `testHouseholdId(n)`, `testTraceId(n)` — валидные uuidv7 по номеру, `testScope({ user, household })`.
- `MemoryBlobStore` — хранилище файлов в памяти с поведением `platform/blob-store` сервера (`put`, `get`, `delete`,
  `deleteHousehold`; id — uuid-бренды, иначе `RangeError`; копии массивов), `size`. Форму сверяет
  `apps/server/src/platform/blob-store/blob-store.test.ts`: один набор проверок для обоих хранилищ.
- Вход `@kosht/testing/db` (`src/db.ts`, отдельно — чтобы unit-тесты не грузили `pg`): `createTestDb()` — своя база
  `test_<запуск>_<процесс>_<n>` из шаблона (`beforeAll`; `afterAll` — `drop()`), `prepareTemplate`, `dropOrphans`,
  `fingerprintDir`, `dropDatabase` — для globalSetup проекта `int` (он в `apps/server/src/platform/db/__fixtures__/`).

## Можно зависеть от
`@kosht/kernel`; `pg` — только в `src/db.ts` (исключение правила `drizzle-and-pg-only-in-db`); `vitest` (`inject`).

## Запреты
- Импорт из боевого кода (`testing-not-in-prod` в `.dependency-cruiser.mjs`) и из `apps/server`: миграции в шаблон
  применяет globalSetup сервера, пакет только клонирует и удаляет базы.
- Базы без префикса `test_` — не создаются и не удаляются (ошибка до запроса).
- Случайность и реальное время: данные одинаковы при каждом запуске.
- Реальные ПД, `samples/`, реальные выписки (NFR-18) — только синтетика.

## Как тестировать
- `pnpm vitest run packages/testing`; `db.int.test.ts` — в проекте `int` (`make test-int`, Postgres поднимается сам).

## Подводные камни
- `makeScope` здесь разрешён (ARCHITECTURE §6.4): `isolation.mjs` пакет не проверяет — не выносите отсюда Scope
  в боевой код.
- `FakeClock.now()` возвращает копию: правка возвращённой `Date` часы не двигает.
- Шаблон `test_tpl_<отпечаток apps/server/drizzle>` переиспользуется между прогонами; изменилась миграция —
  собирается новый, старый удаляется. Клон — стратегией по умолчанию (WAL_LOG, ≈30 мс; FILE_COPY ≈77 мс).
