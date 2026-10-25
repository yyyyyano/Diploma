# Модуль `chat`

Ярус 4 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Диалоги, сообщения (`UIMessage.parts`), поток ответа агента. Список диалогов, вложения, контекст страницы, голос,
выбор модели, «статья изменилась» — T-043.

## Требования SPEC
CHAT-01…10. Сделано: CHAT-02 (поток, шаги, «Стоп»), NFR-21. Макет: `Assistant.dc.html` (сайт — `features/assistant`).

## Публичный API (`index.ts`)
- Фабрика: `createChatModule({ platform, facades })`; платформа — `Platform`; фасад соседа — `facades.agent`.
- Контракт `contract.chat.*` (authed): `history` — последний диалог и его сообщения (`ChatMessage { id, role, parts,
  status }`); `send({ conversationId?, text })` — итератор событий oRPC с кусками UI-сообщения AI SDK
  (`streamToEventIterator`), первый кусок `start` несёт `RunMetadata { runId, conversationId }`; чужой диалог —
  `NOT_FOUND`; `stop({ runId })` — «Стоп» своего запуска, чужой или законченный — `NOT_FOUND`.
- `stop` модуля (корень композиции, `close()`): идущие запуски доводятся до `RUNS_GRACE_MS` = 6 с, оставшиеся
  обрываются, ответ сохраняется «оборван».
- Владелец данных (`user-data.ts`): `chat_messages`, `chat_conversations`.
- Таблицы: `chat_conversations` (`title` — T-043), `chat_messages` (`conversation_id` — `ownedFk`, `role`, `parts`
  jsonb — части UI-сообщения AI SDK, `status` streaming | complete | interrupted).

## Устройство
- `application/runs.ts` — реестр запусков процесса `api` по ключу `householdId:runId`: поток агента читает сам
  реестр и копит куски, подписка (вкладка) получает их с первого; отписка запуск не останавливает.
- `application/send-message.ts` — вопрос и строка ответа «идёт» в одной транзакции → история → `agent.run` (вне
  транзакции) → реестр; итог — `finishMessage` и `realtime.changed(s, { entity: "chat-message" })`.

## Зависимости
Можно: agent, files, receipts, statements, voice, legal-base, legal-consult (`tooling/architecture/modules.ts`).
Слушает: —.

## Запреты
- Запуск не привязывать к `AbortSignal` запроса: «Стоп» — только `chat.stop`, остановка процесса — `stop` модуля.
- Ключ реестра — только `s.scope.householdId` и `runId`; id запуска из входа без домохозяйства — нет.
- Модель — только через `agent` и вне `s.transaction`; текст переписки — не в лог (OBS-04).

## Как тестировать
- `pnpm vitest run apps/server/src/modules/chat` — реестр (`runs.test.ts`), чат целиком на кассете `chat/accounts`
  (`api/send.int.test.ts`: поток, сохранение, закрытая вкладка, чужой диалог, «Стоп», остановка процесса); перезапись —
  `make ai-record SCENARIO=chat/accounts` (тестовый провайдер, паузы 300 мс — их повторяет e2e).

## Подводные камни
- Реестр — в памяти процесса `api`: запуск, начатый одним процессом, другим не остановить (процесс `api` один).
- Строка «идёт» после падения процесса остаётся «идёт» — пометка зависших — T-043.
