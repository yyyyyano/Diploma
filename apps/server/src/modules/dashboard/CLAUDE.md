# Модуль `dashboard`

Ярус 3 · таблицы: — · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Сборка главного экрана (только чтение, пачками). Сейчас модуль пустой, но живой (T-007): фабрика, описание
`defineModule({ id: "dashboard" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
DASH-01…04.

## Публичный API (`index.ts`)
- Фабрика: `createDashboardModule({ platform, facades })` → `defineModule({ id: "dashboard" })`; платформа —
  `Platform` (без `SystemDb`); фасады — `facades.accounts`, `facades.transactions`, `facades.fin`, `facades.budgets`,
  `facades.recurring`, `facades.calendar`, `facades.tax`, `facades.weekly`.
- Фасад `DashboardFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: accounts, transactions, fin, budgets, recurring, calendar, tax, weekly (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Своих таблиц нет: ни схем, ни `SystemDb`; данные — фасадами соседей.
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/dashboard` — unit и int (нужен `make db-up`); общий — `make check`.
