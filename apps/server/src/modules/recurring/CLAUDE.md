# Модуль `recurring`

Ярус 2 · таблицы: user · публикует: `recurring.changed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Поиск регулярных, ожидаемые даты, «возможно прекращён», подписки. Сейчас модуль пустой, но живой (T-007): фабрика,
описание `defineModule({ id: "recurring" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
REC-01…05.

## Публичный API (`index.ts`)
- Фабрика: `createRecurringModule({ platform, facades })` → `defineModule({ id: "recurring" })`; платформа —
  `Platform` (без `SystemDb`); фасады — `facades.transactions`, `facades.categories`, `facades.profile`,
  `facades.notifications`.
- Фасад `RecurringFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): `recurring.changed`; контракт, задачи, инструменты агента, отмена, владелец данных, настройки
  — добавляет задача модуля.

## Зависимости
Можно: transactions, categories, profile, notifications (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/recurring` — unit и int (нужен `make db-up`); общий — `make check`.
