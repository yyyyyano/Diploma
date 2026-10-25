# Модуль `xls-export`

Ярус 3 · таблицы: — · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Excel с живыми формулами (без диаграмм, R43). Сейчас модуль пустой, но живой (T-007): фабрика, описание
`defineModule({ id: "xls-export" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
XLS-01…04.

## Публичный API (`index.ts`)
- Фабрика: `createXlsExportModule({ platform, facades })` → `defineModule({ id: "xls-export" })`; платформа —
  `Platform` (без `SystemDb`); фасады — `facades.transactions`, `facades.categories`, `facades.budgets`,
  `facades.files`.
- Фасад `XlsExportFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: transactions, categories, budgets, files (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Своих таблиц нет: ни схем, ни `SystemDb`; данные — фасадами соседей.
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/xls-export` — unit и int (нужен `make db-up`); общий — `make check`.
