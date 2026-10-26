# Модуль `actions`

Ярус 1 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Журнал отменяемых действий и ожидающие решения «Да/Нет» — одинаково на сайте, в боте и в чате (P5, ARCHITECTURE §5).
Обработчики — у модулей-владельцев (`undo`/`confirm` в `defineModule`), actions исполняет их по имени.

## Требования SPEC
P5, AGT-05/07, TXN-03/04, TXN-10 (вопрос «одна покупка?»), TG-07 `/undo`, NOTIF-05.

## Публичный API (`index.ts`)
- Фабрика: `createActionsModule({ platform, facades })`; платформа — `Platform`; соседей нет. Обработчики — из
  `platform.actionHandlers()` (реестры корня композиции, позднее связывание: из фабрики модуля — ошибка).
- Фасад `ActionsFacade`: `record(tx, { handler, payload, subject, channel })` → undoToken (в транзакции действия
  владельца; неизвестный обработчик — ошибка программы); `undo(s, token)` → `undone | already-undone` (обработчик и
  отметка — одна транзакция, строка `FOR UPDATE`; чужой — `NOT_FOUND`; после действия объект `subject` правили —
  `CONFLICT`, обработчик не вызван); `propose(s, { handler, payload, summary })` → id решения (`summary` — ключ
  словаря и параметры); `answer(s, id, yes|no, channel)` → итог (повтор — прежний; «Да» — обработчик в той же
  транзакции; «Нет» — без него); `decision(s, id)`.
- `parseShortAnswer(text)` (`domain/short-answer.ts`) — «да / нет» текстом (русский, белорусский) для чата и бота.
- Контракт `contract.actions.*` (все authed, канал — web): `undo`, `decision`, `answer`.
- Таблицы (`userOwnedTable`): `action_journal` (handler, payload, subject `<вид>:<id>`, channel, status done|undone),
  `pending_decisions` (handler, payload, summary, status pending|yes|no, channel, answered_at); владелец данных —
  `user-data.ts`.

## Зависимости
Можно: — (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В нагрузке — только id: обработчик владельца перечитывает состояние через `s`.
- Токен и решение ищутся только через `s.own`; «чей» — только `s.scope`.
- Текст вопроса не хранится — только ключ словаря и параметры (текст пишет сайт или бот).

## Как тестировать
- `pnpm vitest run apps/server/src/modules/actions` — короткие ответы (unit), отмена и решения на Postgres: повтор,
  гонка двух нажатий, чужой токен, `CONFLICT`, откат при сбое обработчика (`application/actions.int.test.ts`).
