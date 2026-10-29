# Модуль `llm`

Ярус 1 · таблицы: system, user · публикует: `llm.local-models-ready` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Шлюз к моделям — единственный, кто знает провайдеров: реестр, цепочки по задачам, лимитёр, журнал расхода, выбор модели
пользователем, админка ИИ, кассеты, трассы. Маскирование и загрузчик локальных моделей — T-024.

## Требования SPEC
LLM-01…06, 08…10, NFR-02/04/05, PRIV-02/09, OBS-03, ADM-20/21/22/50, NOTIF-03, QA-17, PRIV-06; LLM-07, PRIV-03/04, NFR-25 — T-024.

## Публичный API (`index.ts`)
- Фабрика `createLlmModule({ platform, facades })` (`SystemPlatform`; фасад `notifications` — уведомления админу).
- `LlmFacade` = `LlmGateway`: `model(caller, "chat", { sessionId? })` → `{ model, telemetry }` (цепочка как одна модель),
  `extract(caller, { task, schema, instructions, document, promptVersion })` (документ — блоком `<document>`, вне схемы —
  один повтор, затем `LlmSchemaError`), `classify`, `embed` (только локально), `transcribe`. `LlmAdminFacade` = `LlmFacade`
  + `admin` (только модулю `admin`). `systemCaller("<модуль>")`, `Caller`: scope (облако — по `platform.consent`, он
  сверяет версию текста согласия) или задача без данных пользователя.
- Ответ цепочки: `providerMetadata.kosht = { model, unavailable: [id…] }` — «Модель X недоступна, ответила Y» (LLM-10).
- Процедуры (`authed`): `llm.models` (включённые, `user_selectable`, умеющие чат; облачные — только с согласием; ставшая
  недоступной выбранная — `null`, «Авто»), `llm.setPreferredModel({ modelId | null })`; выбор действует только в чате.
- Настройки: `llm.mode`, `llm.cassette(-delays)`, `llm.timeout-cloud-ms` (30 с), `llm.timeout-local-ms` (5 мин),
  `llm.llama-base-url`, `llm.usage-retention-days` (90), `llm.trace-retention-days` (30). Секреты `llm.groq-api-key`,
  `llm.zai-api-key` читаются в момент вызова. Расписания: `llm.trace-deletions` (03:40), `llm.usage-retention` (03:20),
  `llm.trace-retention` (03:30, `TraceDeleter.deleteTracesBefore`, пачки ≤ 1000).
- Админу: «лимит» (суточный исчерпан, 429) или «ошибка» → `notifyAdmins({ kind: "ai-provider", key: "<провайдер>:<вид>:<день>" })`.
- Таблицы `systemTable`: `llm_models` (реестр, цены, лимиты `rpm/tpm/rpd/tpd`, `user_selectable`), `llm_task_chains`
  (`task`, `model_id`, `position`; нет строк — по `priority`), `llm_usage` (журнал без текстов), `llm_trace_deletions`;
  `userOwnedTable` `llm_preferences` (`user-data.ts`: выгрузка, удаление, трассы Langfuse в `afterDelete`). Миграция
  `…_llm-providers`: Groq → Z.ai → локальная по задачам; `test/scripted` в боевой базе выключена.
- `LlmAdminFacade.admin` (`application/admin.ts`, ADM-20/21/22/50, LLM-08/09): `providers`, `setChain`, `enable`,
  `saveModel` (облачность — по провайдеру), `testConnection` (`GET /models`; у Z.ai список неполон — проба), `setKey`
  (только запись), `usage(period)` (скользящие сутки/7/30 дней, стоимость — по текущему прайсу), `setPrice`.

## Устройство
- `domain/`: задачи, `build-chain.ts` (порядок задачи, выбор; без согласия — только локальные), кто зовёт, цена. `application/`: `gateway.ts`, `chained-model.ts` (отказ, таймаут первого куска, 429, лимит, ошибка потока до первого
  куска → следующая; «Стоп» и `LLM_IN_TRANSACTION` не переключают), `limiter.ts` (окна по журналу + запросы в полёте,
  `x-ratelimit-*`, `retry-after` в памяти), `metered-model.ts`, `preferences.ts`, `retention.ts`, `provider-alerts.ts`, `admin.ts`.
- `infrastructure/providers/`: `ProviderAdapter` (`cloud`, `isConfigured`, `listModels`, `probe`), `groq.ts`,
  `openai-compatible.ts` (Z.ai: схема — в подсказке, мышление выключено; llama-server), `remote-fetch.ts`, тестовый провайдер, кассеты.
  `infrastructure/db/` — репозитории; `telemetry/` — Langfuse (ADR-0010). Подробности — ADR-0009, дополнение T-023.

## Зависимости
Можно: privacy, identity, notifications (`tooling/architecture/modules.ts`). Слушает: —. `ai`, `@ai-sdk/*` — здесь;
`@langfuse/*`, `@opentelemetry/*` — только `infrastructure/telemetry/` (`otel-only-in-llm-telemetry`; версии — точные).

## Запреты
- Модель строкой и Vercel AI Gateway — нет; облачная модель в обход `buildChain` и согласия — нет; векторы — только локально.
- Тексты запросов и ответов — не в журнал и не в лог (OBS-04); вызов модели в `s.transaction` — `LLM_IN_TRANSACTION`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/llm`: домен и цепочка на `MockLanguageModelV4` (`chained-model.test.ts`,
  `limiter.test.ts`), адаптеры на подставном fetch, шлюз на Postgres (`gateway*.int.test.ts`), умолчания миграции
  (`default-registry.int.test.ts`), выбор модели, админка, хранение; отзыв согласия — `main/cloud-consent.int.test.ts`.

## Подводные камни
- Шаблон тестовой БД сбрасывает боевой реестр (облачные выключены, цепочки удалены, `test/scripted` включена): `platform/db/__fixtures__/test-template.ts`.
- Z.ai: `GET /models` без бесплатных `*-flash`, `json_schema` игнорируется, без `thinking: disabled` ответ ~35 с (замер 2026-10-29); free-модели бывают «перегружены» (429) — работа цепочки.
- Лимиты тарифа — в миграции (источники — её комментарий); окна лимитёра скользящие: минута и 24 часа.
- Кассеты — `__cassettes__/` (`make ai-record SCENARIO=…`); повторяют паузы записи (`delays`): e2e видит поток.
