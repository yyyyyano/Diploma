# Модуль `chat`

Ярус 4 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Диалоги, сообщения (`UIMessage.parts`), поток ответа, вложения, контекст страницы, «статья изменилась». Сейчас модуль
пустой, но живой (T-007): фабрика, описание `defineModule({ id: "chat" })` и место в корне композиции; содержимое
добавляет задача модуля.

## Требования SPEC
CHAT-01…10.

## Публичный API (`index.ts`)
- Фабрика: `createChatModule({ platform, facades })` → `defineModule({ id: "chat" })`; платформа — `Platform` (без
  `SystemDb`); фасады — `facades.agent`, `facades.files`, `facades.receipts`, `facades.statements`, `facades.voice`,
  `facades.legalBase`, `facades.legalConsult`.
- Фасад `ChatFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: agent, files, receipts, statements, voice, legal-base, legal-consult (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/chat` — unit и int (нужен `make db-up`); общий — `make check`.
