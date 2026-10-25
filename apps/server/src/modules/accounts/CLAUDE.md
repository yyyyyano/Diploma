# Модуль `accounts`

Ярус 2 · таблицы: user · публикует: `accounts.balances-changed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Счета, «Наличные», «Карта, не указана», остатки и дата остатка; пересчёт остатка по операциям (STMT-02) выполняет по
вызову `transactions` — сам от `transactions` не зависит. Сейчас модуль пустой, но живой (T-007): фабрика, описание
`defineModule({ id: "accounts" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
STMT-01/02.

## Публичный API (`index.ts`)
- Фабрика: `createAccountsModule({ platform, facades })` → `defineModule({ id: "accounts" })`; платформа — `Platform`
  (без `SystemDb`); фасады — `facades.identity`, `facades.fxRates`, `facades.explain`.
- Фасад `AccountsFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): `accounts.balances-changed`; контракт, задачи, инструменты агента, отмена, владелец данных,
  настройки — добавляет задача модуля.

## Зависимости
Можно: identity, fx-rates, explain (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/accounts` — unit и int (нужен `make db-up`); общий — `make check`.
