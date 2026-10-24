# Пакет `@kosht/testing` — помощники тестов: часы, фабрики примитивов

## Назначение
Всё, что делает тесты офлайн и детерминированными (`.claude/rules/testing.md`, ARCHITECTURE §12). Остальное
(шаблонная БД, `MemoryBlobStore`, кассеты моделей, генератор тестов изоляции) добавляют задачи, которым оно нужно.

## Кто использует
Только тесты (`*.test.ts`, `*.int.test.ts`, `e2e/`) во всех пакетах и приложениях; боевому коду — запрещено.

## Публичный API
- Вход: `packages/testing/src/index.ts`.
- `FakeClock implements Clock` (`@kosht/kernel`): `new FakeClock("2026-10-21T09:00:00Z", timeZone?)`, `now()`,
  `today()` — `LocalDate.fromInstant` по поясу (по умолчанию `Europe/Minsk`, NFR-23), `set(instant)`, `advance(ms)`.
- Фабрики примитивов: `byn(minor)` — деньги BYN в копейках, `day("2026-10-21")`, `testUserId(n)`,
  `testHouseholdId(n)`, `testTraceId(n)` — валидные uuidv7 по номеру, `testScope({ user, household })`.

## Можно зависеть от
`@kosht/kernel`. Внешние пакеты — по мере надобности задач (например, Postgres для шаблонной БД — T-004).

## Запреты
- Импорт из боевого кода (`testing-not-in-prod` в `.dependency-cruiser.mjs`).
- Случайность и реальное время: данные одинаковы при каждом запуске.
- Реальные ПД, `samples/`, реальные выписки (NFR-18) — только синтетика.

## Как тестировать
- `pnpm vitest run packages/testing`.

## Подводные камни
- `makeScope` здесь разрешён (ARCHITECTURE §6.4): `isolation.mjs` пакет не проверяет — не выносите отсюда Scope
  в боевой код.
- `FakeClock.now()` возвращает копию: правка возвращённой `Date` часы не двигает.
