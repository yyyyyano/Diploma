# Пакет `@kosht/kernel` — общие примитивы: деньги, дни, период, Scope, бренды id, трасса, часы

## Назначение
Типы, без которых не обходится ни один пакет и приложение: «что такое деньги, день и чьи данные». Меняется редко;
новый общий тип — только если он нужен минимум двум пакетам/приложениям (`.claude/rules/calc.md`).

## Кто использует
`@kosht/calc`, `@kosht/contract`, `@kosht/testing`, `apps/server` (модули, `platform/clock`), `apps/web`.

## Публичный API
- Вход: `packages/kernel/src/index.ts`. Значение и тип с одним именем: `Money.of(…)` / `Money`, `LocalDate.parse(…)`.
- `Money { minor, currency }` — целые копейки в безопасном диапазоне `Number`, валюта — три заглавные буквы;
  `Money.of` (иначе `RangeError`), `Money.schema`, `Money.sameCurrency` (разные валюты — `CurrencyMismatchError`).
  Арифметики здесь нет — она в `calc`.
- `LocalDate` — строка «ГГГГ-ММ-ДД» с брендом: `parse`, `compare`, `schema`, `fromInstant(instant, timeZone)`;
  `TimeZone`, `DEFAULT_TIME_ZONE = "Europe/Minsk"` — умолчание настройки (NFR-23), сам пояс всегда аргумент.
- `Period { from, to }` — **обе границы включительно**: `of` (начало позже конца — `RangeError`), `contains`, `schema`.
- `Clock { now(), today() }` — только интерфейс: реализация по поясу из настройки — `platform/clock` (T-005),
  в тестах — `FakeClock` из `@kosht/testing`.
- Бренды id на `z.$brand` (схема = разбор): `UserId`, `HouseholdId`, `TraceId`.
- `Scope { userId, householdId }` с брендом, неизменяем; создаётся только `makeScope` (литерал не компилируется).
- `TraceNode { key, op, value, inputs, refs, note? }`, `TraceOp`, `TraceValue`, `TraceRef` — только типы.

## Можно зависеть от
Только `zod` (правило `kernel-only-zod` в `.dependency-cruiser.mjs`).

## Запреты
- `Intl` — только в `LocalDate.fromInstant`; часы (`Date.now()`, `new Date()`) и случайность — нигде.
  `calc-no-clock.mjs` kernel не проверяет: `fromInstant` законно использует `Intl` (`.claude/rules/calc.md`).
- `makeScope` вызывают только входы (ARCHITECTURE §6.4) и тесты — следит `isolation.mjs`.
- Без `enum`: `as const` объекты и союзы строк (ADR-0002).

## Как тестировать
- `pnpm vitest run packages/kernel`; покрытие — строки ≥ 90 %, ветви ≥ 85 % (`CONSTRAINTS.md`, `vitest.config.ts`).
- «Не компилируется» (литерал вместо `Scope`, перепутанные id) — тест с `@ts-expect-error` и причиной; его
  проверяет `make typecheck`.

## Подводные камни
- Бренд — только тип: `as unknown as Scope` компилятор пропустит, ловят его `isolation.mjs` и ревью.
- `LocalDate` сравнивается как строка только через `compare`; дни по разным поясам не смешивать.
