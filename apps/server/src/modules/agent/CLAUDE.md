# Модуль `agent`

Ярус 4 · таблицы: — · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Цикл агента: модель из шлюза `llm`, инструменты модулей из реестра корня композиции, подсказка, предел шагов. Стражи
«вне темы», проверка чисел ответа, выбор набора по странице, дозапрос, цитаты — T-042.

## Требования SPEC
AGT-01…14, SEC-10, LLM-10 (выбор в запуске). Сделано: AGT-01 (≤ `agent.max-steps` шагов, по умолчанию 8; на последнем
— `toolChoice: "none"`), AGT-13 (ошибка инструмента — `{ ok: false, code }`).

## Публичный API (`index.ts`)
- Фабрика: `createAgentModule({ platform, facades })`; платформа — `Platform`; фасад соседа — `facades.llm`.
- Фасад `AgentFacade.run(s, { messages, abortSignal, requestId, sessionId, metadata, onFinish })` →
  `ReadableStream<UIMessageChunk>`: `ToolLoopAgent` AI SDK 7, модель — `llm.model(s.scope, "chat")` (облако — по
  согласию), инструменты набора `core` из `platform.tools()` через `bindTools` (ctx.s — из scope запуска),
  `createAgentUIStream`: `metadata` — в кусок `start`, `onFinish(message, aborted)` — итоговое UI-сообщение.
- `agentPrefix(tools)` — системная подсказка + описания инструментов `core` (для подсчёта токенов).
- Настройки (`settings.ts`): `agent.max-steps` (2…20, по умолчанию 8).
- Подсказка — `prompts/system.prompt.ts` (`SYSTEM_PROMPT`, `PROMPT_VERSION`): постоянна байт-в-байт (кэш префикса).

## Зависимости
Можно: llm, actions, profile, legal-consult (`tooling/architecture/modules.ts`). Слушает: —. Предметные модули — нет:
инструменты приходят реестром.

## Запреты
- Своих таблиц нет; данные — только инструментами модулей (`ctx.s` из scope запуска).
- Числа в ответе — только из результатов инструментов (подсказка; проверка кодом — T-042).
- Правка подсказки — новая `PROMPT_VERSION` и перезапись кассет (`make ai-record SCENARIO=…`).
- Модель — только через `llm`; модель строкой и провайдеры `@ai-sdk/*` — нет.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/agent` — цикл на `MockLanguageModelV4` (`run-agent.test.ts`: ctx.s из
  scope, `{ ok: false, code }`, предел шагов). Префикс ≤ 3 000 токенов `o200k_base` — `main/agent-prefix.int.test.ts`
  (настоящий реестр инструментов). Сценарий целиком на кассете — `chat/application/send.int.test.ts`.
