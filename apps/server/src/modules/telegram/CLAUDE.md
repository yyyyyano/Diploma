# Модуль `telegram`

Ярус 4 · таблицы: system · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Бот: привязка, команды, фото/файлы/голос, канал доставки уведомлений. Сейчас модуль пустой, но живой (T-007): фабрика,
описание `defineModule({ id: "telegram" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
TG-01…11, PRIV-08 (подключение), AUTH-05 (сброс через бот).

## Публичный API (`index.ts`)
- Фабрика: `createTelegramModule({ platform, facades })` → `defineModule({ id: "telegram" })`; платформа —
  `SystemPlatform` (с `system: SystemDb`); фасады — `facades.chat`, `facades.agent`, `facades.identity`,
  `facades.privacy`, `facades.notifications`, `facades.actions`, `facades.receipts`, `facades.statements`,
  `facades.voice`, `facades.dashboard`, `facades.budgets`, `facades.weekly`.
- Фасад `TelegramFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: chat, agent, identity, privacy, notifications, actions, receipts, statements, voice, dashboard, budgets, weekly (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- `SystemDb` — только для своих таблиц system/public; пользовательские таблицы через него не трогать (аудитор SQL).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/telegram` — unit и int (нужен `make db-up`); общий — `make check`.
