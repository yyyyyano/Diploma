# Модуль `tax`

Ярус 3 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Калькулятор вычетов (через `calc`), найденные вычеты по операциям. Сейчас модуль пустой, но живой (T-007): фабрика,
описание `defineModule({ id: "tax" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
TAX-01…07, TAX-20.

## Публичный API (`index.ts`)
- Фабрика: `createTaxModule({ platform, facades })` → `defineModule({ id: "tax" })`; платформа — `Platform` (без
  `SystemDb`); фасады — `facades.profile`, `facades.transactions`, `facades.categories`, `facades.normTables`,
  `facades.legalBase`, `facades.legalConsult`, `facades.notifications`, `facades.explain`.
- Фасад `TaxFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: profile, transactions, categories, norm-tables, legal-base, legal-consult, notifications, explain (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/tax` — unit и int (нужен `make db-up`); общий — `make check`.
