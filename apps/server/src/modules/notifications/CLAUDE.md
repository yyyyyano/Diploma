# Модуль `notifications`

Ярус 1 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Уведомления, центр, настройки по видам и каналам, реестр каналов доставки (web, telegram). Сейчас модуль пустой, но
живой (T-007): фабрика, описание `defineModule({ id: "notifications" })` и место в корне композиции; содержимое
добавляет задача модуля.

## Требования SPEC
NOTIF-01…05, BUD-03, CAL-07 (доставка).

## Публичный API (`index.ts`)
- Фабрика: `createNotificationsModule({ platform, facades })` → `defineModule({ id: "notifications" })`; платформа —
  `Platform` (без `SystemDb`); фасады — `facades.identity`.
- Фасад `NotificationsFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: identity (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/notifications` — unit и int (нужен `make db-up`); общий — `make check`.
