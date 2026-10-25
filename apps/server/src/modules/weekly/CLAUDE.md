# Модуль `weekly`

Ярус 3 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Итоги недели: числа — `calc`, текст — модель. Сейчас модуль пустой, но живой (T-007): фабрика, описание
`defineModule({ id: "weekly" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
WEEK-01…03.

## Публичный API (`index.ts`)
- Фабрика: `createWeeklyModule({ platform, facades })` → `defineModule({ id: "weekly" })`; платформа — `Platform` (без
  `SystemDb`); фасады — `facades.transactions`, `facades.budgets`, `facades.calendar`, `facades.recurring`,
  `facades.tax`, `facades.llm`, `facades.notifications`, `facades.explain`.
- Фасад `WeeklyFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: transactions, budgets, calendar, recurring, tax, llm, notifications, explain (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/weekly` — unit и int (нужен `make db-up`); общий — `make check`.
