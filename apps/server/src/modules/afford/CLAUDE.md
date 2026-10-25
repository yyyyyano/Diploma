# Модуль `afford`

Ярус 3 · таблицы: — · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Три сценария покупки, просадки, безопасный платёж по ПДН. Сейчас модуль пустой, но живой (T-007): фабрика, описание
`defineModule({ id: "afford" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
AFF-01…08.

## Публичный API (`index.ts`)
- Фабрика: `createAffordModule({ platform, facades })` → `defineModule({ id: "afford" })`; платформа — `Platform` (без
  `SystemDb`); фасады — `facades.accounts`, `facades.transactions`, `facades.recurring`, `facades.fin`,
  `facades.budgets`, `facades.calendar`, `facades.normTables`, `facades.profile`, `facades.explain`.
- Фасад `AffordFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: accounts, transactions, recurring, fin, budgets, calendar, norm-tables, profile, explain (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Своих таблиц нет: ни схем, ни `SystemDb`; данные — фасадами соседей.
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/afford` — unit и int (нужен `make db-up`); общий — `make check`.
