# Модуль `budgets`

Ярус 3 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Лимиты, цели, копилка, рекомендуемый взнос, пороги уведомлений. Сейчас модуль пустой, но живой (T-007): фабрика,
описание `defineModule({ id: "budgets" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
BUD-01…07.

## Публичный API (`index.ts`)
- Фабрика: `createBudgetsModule({ platform, facades })` → `defineModule({ id: "budgets" })`; платформа — `Platform`
  (без `SystemDb`); фасады — `facades.accounts`, `facades.transactions`, `facades.categories`, `facades.fin`,
  `facades.notifications`, `facades.actions`, `facades.explain`.
- Фасад `BudgetsFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: accounts, transactions, categories, fin, notifications, actions, explain (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/budgets` — unit и int (нужен `make db-up`); общий — `make check`.
