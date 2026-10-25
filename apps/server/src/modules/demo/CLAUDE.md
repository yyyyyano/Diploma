# Модуль `demo`

Ярус 4 · таблицы: — · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Демо-пользователь и связный набор данных от текущей даты (воспроизводимо). Сейчас модуль пустой, но живой (T-007):
фабрика, описание `defineModule({ id: "demo" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
DEMO-01…04.

## Публичный API (`index.ts`)
- Фабрика: `createDemoModule({ platform, facades })` → `defineModule({ id: "demo" })`; платформа — `Platform` (без
  `SystemDb`); фасады — `facades.identity`, `facades.privacy`, `facades.profile`, `facades.files`, `facades.accounts`,
  `facades.transactions`, `facades.receipts`, `facades.categories`, `facades.recurring`, `facades.budgets`,
  `facades.calendar`, `facades.weekly`.
- Фасад `DemoFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: identity, privacy, profile, files, accounts, transactions, receipts, categories, recurring, budgets, calendar, weekly (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Своих таблиц нет: ни схем, ни `SystemDb`; данные — фасадами соседей.
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/demo` — unit и int (нужен `make db-up`); общий — `make check`.
