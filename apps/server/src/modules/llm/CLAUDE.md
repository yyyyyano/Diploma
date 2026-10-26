# Модуль `llm`

Ярус 1 · таблицы: system, user · публикует: `llm.local-models-ready` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Шлюз к моделям — единственный, кто знает провайдеров: реестр моделей и провайдеров, цепочки по задачам, журнал
расхода, кассеты, опции трасс. Лимитёр, маскирование, Groq/Z.ai/llama-server, админка моделей — T-023, T-024.

## Требования SPEC
LLM-01…10, NFR-04/05/25, PRIV-02/03/04/09, OBS-03, ADM-20/21/22/50. Сделано: LLM-01, LLM-04 (схема + повтор),
LLM-06 (журнал), OBS-03 (трассы в Langfuse, T-011), LLM-09, NFR-04/05, PRIV-02/09 (фильтр цепочки), QA-17 (кассеты).

## Публичный API (`index.ts`)
- Фабрика: `createLlmModule({ platform, facades })`; платформа — `SystemPlatform`; фасады соседей пока не нужны.
- Фасад `LlmFacade` = `LlmGateway`: `model(caller, "chat", { sessionId? })` → `{ model: LanguageModelV4, telemetry }`
  (цепочка как одна модель; `telemetry` — `LlmTelemetryOptions`: `functionId`, `userId`, `sessionId`, `integrations`),
  `extract(caller, { task, schema, instructions, document, promptVersion })` (документ — блоком `<document>`, вне
  схемы — один повтор, затем `LlmSchemaError`), `classify`, `embed` (только локально), `transcribe`.
- `systemCaller("<модуль>")`, `Caller` — кто зовёт: scope (облако — по `platform.consent`) или задача без данных
  пользователя (облако разрешено).
- Настройки (`settings.ts`): `llm.mode` (`LLM_MODE`: `live | record | replay`), `llm.cassette` (`LLM_CASSETTE`, путь).
- Таблицы (`systemTable`): `llm_models` (реестр: провайдер, модель, облачная, возможности, приоритет, вкл., цены;
  миграция кладёт `test/scripted`), `llm_usage` (журнал: задача, провайдер, модель, токены, мс, стоимость, код
  ошибки — без текстов и пользователя).

## Устройство
- `domain/`: `tasks.ts` (задача → возможности), `build-chain.ts` (инвариант: без согласия — только локальные),
  `caller.ts`, `cost.ts` (микродоллары за миллион токенов, вверх).
- `application/`: `gateway.ts`, `chained-model.ts` (ошибка до ответа — следующая модель), `metered-model.ts` (запрет
  вызова в `s.transaction` — `LlmInTransactionError`, строка журнала на каждый вызов), `masking/ports.ts` (`Masker`,
  `KnownNames` — реализация T-024).
- `infrastructure/providers/`: `ProviderAdapter`, реестр провайдеров (код), тестовый провайдер (`test-provider.ts`:
  настоящий адаптер, локальный, сценарий чата с `list_accounts`, хэш-эмбеддинги, фиксированная расшифровка; пауза
  между кусками ответа 300 мс), кассеты (`cassettes.ts`: `replayModel`, `recordingModel`, `fingerprint`).
- `infrastructure/telemetry/langfuse-tracing.ts` (ADR-0010): `NodeTracerProvider` + `LangfuseSpanProcessor` (таймаут
  2 с) и `OpenTelemetry` из `@ai-sdk/otel` (корень `invoke_agent <задача>`, `user.id`/`session.id`) — в опции вызова
  (`telemetry.integrations`), только если задан `platform.telemetry.langfuse`; `stop` модуля досылает спаны.

## Зависимости
Можно: privacy, identity, notifications (`tooling/architecture/modules.ts`). Слушает: —. `ai`, `@ai-sdk/*` — здесь;
`@langfuse/*`, `@opentelemetry/*` — только `infrastructure/telemetry/` (правило `otel-only-in-llm-telemetry`; версии
OpenTelemetry закреплены точно, `@opentelemetry/api` — одна копия через `overrides`).

## Запреты
- Модель строкой и Vercel AI Gateway — нет; модели — записи реестра, провайдеры — адаптеры.
- Облачная модель в обход `buildChain` и согласия — нет; эмбеддинги — только локальные.
- Тексты запросов и ответов — не в журнал и не в лог (OBS-04).
- Вызов модели внутри `s.transaction` — ошибка `LLM_IN_TRANSACTION` (наружу — `INTERNAL`).

## Как тестировать
- `pnpm vitest run apps/server/src/modules/llm` — домен (unit, свойство «без согласия — только локальные»), шлюз на
  Postgres (`gateway.int.test.ts`: цепочка, журнал-канарейка, транзакция, схема, кассеты, трассы); дерево спанов
  Langfuse — `langfuse-tracing.test.ts` (экспорт в память вместо сети).
- Кассеты сценариев — `__cassettes__/` рядом с тестом; перезапись — `make ai-record SCENARIO=<модуль>/<имя>`
  (с тестового провайдера — без сети и ключей).

## Подводные камни
- `test/scripted` — в реестре и в боевой базе: пока других моделей нет, чат отвечает по сценарию; выключить в
  админке, когда появятся настоящие (T-023).
- Кассета повторяет паузы записи (`delays`): e2e видит поток; тесты сценариев их пропускают.
