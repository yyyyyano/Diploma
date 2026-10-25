# Модуль `calendar`

Ярус 3 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
События, напоминания (таблица `reminders` + тик), сроки налогов, гарантии, страховки. Сейчас модуль пустой, но живой
(T-007): фабрика, описание `defineModule({ id: "calendar" })` и место в корне композиции; содержимое добавляет задача
модуля.

## Требования SPEC
CAL-01…08, PROF-07 (вопрос об имуществе).

## Публичный API (`index.ts`)
- Фабрика: `createCalendarModule({ platform, facades })` → `defineModule({ id: "calendar" })`; платформа — `Platform`
  (без `SystemDb`); фасады — `facades.profile`, `facades.transactions`, `facades.recurring`, `facades.receipts`,
  `facades.normTables`, `facades.notifications`, `facades.actions`.
- Фасад `CalendarFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: profile, transactions, recurring, receipts, norm-tables, notifications, actions (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/calendar` — unit и int (нужен `make db-up`); общий — `make check`.
