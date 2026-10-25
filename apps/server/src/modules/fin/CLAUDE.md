# Модуль `fin`

Ярус 3 · таблицы: — · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Свободный остаток, средний регулярный доход, прогноз остатка по дням. Сейчас модуль пустой, но живой (T-007): фабрика,
описание `defineModule({ id: "fin" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
FIN-01/20/21/22.

## Публичный API (`index.ts`)
- Фабрика: `createFinModule({ platform, facades })` → `defineModule({ id: "fin" })`; платформа — `Platform` (без
  `SystemDb`); фасады — `facades.accounts`, `facades.transactions`, `facades.recurring`, `facades.profile`,
  `facades.explain`.
- Фасад `FinFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: accounts, transactions, recurring, profile, explain (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Своих таблиц нет: ни схем, ни `SystemDb`; данные — фасадами соседей.
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/fin` — unit и int (нужен `make db-up`); общий — `make check`.
