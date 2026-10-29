# Модуль `llm`

Ярус 1 · таблицы: system, user · публикует: `llm.local-models-ready` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Шлюз к моделям — единственный, кто знает провайдеров: реестр моделей и провайдеров, цепочки по задачам, лимитёр,
журнал расхода, выбор модели пользователем, админка ИИ, кассеты, опции трасс. Маскирование и загрузчик локальных
моделей — T-024.

## Требования SPEC
LLM-01…10, NFR-04/05/25, PRIV-02/03/04/09, OBS-03, ADM-20/21/22/50. Сделано: LLM-01…06, LLM-08…10, OBS-03
(Langfuse), NFR-02/04/05, PRIV-02/09 (фильтр цепочки, версия согласия), ADM-20/21/22/50, NOTIF-03 (`ai-provider`),
QA-17 (кассеты), PRIV-06 (трассы).

## Публичный API (`index.ts`)
- Фабрика: `createLlmModule({ platform, facades })`; платформа — `SystemPlatform`; фасады — `notifications`
  (уведомление администратору), `privacy`, `identity` (пока не нужны).
- Фасад `LlmFacade` = `LlmGateway`: `model(caller, "chat", { sessionId? })` → `{ model: LanguageModelV4, telemetry }`
  (цепочка как одна модель; `telemetry` — `LlmTelemetryOptions`), `extract(caller, { task, schema, instructions,
  document, promptVersion })` (документ — блоком `<document>`, вне схемы — один повтор, затем `LlmSchemaError`),
  `classify`, `embed` (только локально), `transcribe`. `LlmAdminFacade` = `LlmFacade` + `admin` — только для модуля
  `admin` (ниже).
- `systemCaller("<модуль>")`, `Caller` — кто зовёт: scope (облако — по `platform.consent`, а он сверяет версию
  текста согласия) или задача без данных пользователя (облако разрешено).
- Ответ цепочки несёт `providerMetadata.kosht = { model: "<провайдер>/<модель>", unavailable: [id…] }` — кто ответил
  и какие модели были недоступны до него («Модель X недоступна, ответила Y», LLM-10; на экране — T-043).
- Процедуры (`api/router.ts`, `authed`): `llm.models` — модели для выбора в чате (включены, `user_selectable`, умеют
  чат; облачные — только с облачным согласием) и выбор вошедшего (`selected`, ставшая недоступной — `null`, «Авто»);
  `llm.setPreferredModel({ modelId | null })` — не из списка — `VALIDATION`. Выбор действует только в чате.
- Настройки (`settings.ts`): `llm.mode`, `llm.cassette`, `llm.cassette-delays`; `llm.timeout-cloud-ms` (30 с) и
  `llm.timeout-local-ms` (5 мин) — срок первого куска ответа; `llm.llama-base-url` (`LLAMA_BASE_URL`);
  `llm.usage-retention-days` (90) и `llm.trace-retention-days` (30). Секреты: `llm.groq-api-key` (`GROQ_API_KEY`),
  `llm.zai-api-key` (`ZAI_API_KEY`) — читаются в момент вызова: смена ключа в админке действует сразу.
- Расписания (ночью, по поясу системы): `llm.trace-deletions` (03:40, повтор удаления трасс удалённых аккаунтов),
  `llm.usage-retention` (03:20, журнал старше срока пачками по 1000) и `llm.trace-retention` (03:30, трассы Langfuse
  старше срока через `TraceDeleter.deleteTracesBefore`, пачки ≤ 1000; Langfuse выключен — ничего).
- Уведомления администратору: событие цепочки «лимит» (суточный лимит исчерпан, 429) или «ошибка» провайдера →
  `notifyAdmins({ kind: "ai-provider", key: "<провайдер>:<вид>:<день>" })` — идемпотентно за день.
- Владелец данных (`user-data.ts`): `llm_preferences` (выгрузка и удаление с аккаунтом) и хук `afterDelete` — трассы
  Langfuse пользователя (`trace-deletion.ts`); не вышло или Langfuse выключен — очередь `llm_trace_deletions`.
- Таблицы: `llm_models` (реестр: провайдер, модель, облачная, возможности, приоритет, вкл., цены, лимиты тарифа `rpm`,
  `tpm`, `rpd`, `tpd`, `user_selectable`), `llm_task_chains` (`task`, `model_id`, `position` — порядок цепочки по
  задачам; нет строк — по `priority`), `llm_usage` (журнал без текстов и пользователя), `llm_trace_deletions` —
  `systemTable`; `llm_preferences` — `userOwnedTable` (одна строка на пользователя, «Авто» — строки нет). Миграция
  `…_llm-providers` кладёт Groq (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b` с изображениями, `whisper-large-v3-turbo`),
  Z.ai (`glm-4.7-flash`, `glm-4.6v-flash`), локальные (`qwen3.5-4b`, `bge-m3`) и цепочки Groq → Z.ai → локальная по
  каждой задаче; тестовая модель `test/scripted` в боевой базе выключена.
- Админ-фасад `LlmAdminFacade.admin` (`application/admin.ts`; ADM-20/21/22/50, LLM-08/09): `providers()` (провайдеры и
  статус ключей, реестр, цепочки задач), `setChain`, `enable`, `saveModel` (облачность — по провайдеру, не по входу),
  `testConnection` (`GET /models` и модель в списке; у Z.ai список неполон — проба на один токен), `setKey`
  (только запись), `usage(period)` (цифры журнала за скользящие сутки, 7 и 30 дней; стоимость — по текущему прайсу),
  `setPrice`. Ответы — типы `@kosht/contract` (`admin/ai.contract.ts`), тексты и пользователи в них не входят.

## Устройство
- `domain/`: `tasks.ts` (задача → возможности), `build-chain.ts` (порядок задачи, выбор пользователя, инвариант:
  без согласия — только локальные), `caller.ts`, `cost.ts` (микродоллары за миллион токенов, вверх).
- `application/`: `gateway.ts` (цепочка из реестра + порядок задач + выбор пользователя + провайдеры без ключа
  пропускаются), `chained-model.ts` («цепочка как одна модель»: ошибка, таймаут первого куска, 429, исчерпанный лимит и
  ошибка внутри потока до первого куска → следующая; «Стоп» пользователя и `LLM_IN_TRANSACTION` не переключают),
  `limiter.ts` (окна RPM/TPM/RPD/TPD по журналу + запросы в полёте, остаток по `x-ratelimit-*`, размыкатель по
  `retry-after` — в памяти процесса), `metered-model.ts` (запрет вызова в `s.transaction`, строка журнала на каждый
  вызов), `preferences.ts`, `retention.ts`, `provider-alerts.ts`, `admin.ts`, `masking/ports.ts` (`Masker`,
  `KnownNames` — реализация T-024).
- `infrastructure/providers/`: `ProviderAdapter` (`cloud`, `isConfigured`, `listModels`, `probe`), реестр
  провайдеров (код), `groq.ts` (`@ai-sdk/groq`), `openai-compatible.ts` (Z.ai: схема ответа — в подсказке, мышление
  выключено; llama-server: `json_schema`), `remote-fetch.ts` (адрес и ключ — в момент вызова), тестовый провайдер
  (`test-provider.ts`), кассеты (`cassettes.ts`).
- `infrastructure/db/`: `llm.repo.ts` (реестр, цепочки, окна расхода), `usage-stats.repo.ts` (агрегаты «Запросов к
  ИИ»), `preferences.repo.ts`, `trace-deletions.repo.ts`.
- `infrastructure/telemetry/` — Langfuse: `langfuse-traces.ts` (`TraceDeleter`: по пользователю и старше срока),
  `langfuse-tracing.ts` (ADR-0010).

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
- `pnpm vitest run apps/server/src/modules/llm` — домен (unit, свойство «без согласия — только локальные»), цепочка на
  `MockLanguageModelV4` (`chained-model.test.ts`, `limiter.test.ts`), адаптеры на подставном fetch
  (`adapters.test.ts`), шлюз на Postgres (`gateway.int.test.ts`: журнал-канарейка, транзакция, схема, кассеты, трассы;
  `gateway-chains.int.test.ts`: порядок задач, лимиты из журнала, выбор пользователя, уведомления), умолчания миграции
  (`default-registry.int.test.ts`), выбор модели (`preferences.int.test.ts`), админка (`admin.int.test.ts`), хранение
  (`retention.int.test.ts`); отзыв согласия сквозь HTTP — `main/cloud-consent.int.test.ts`.
- Кассеты — `__cassettes__/` рядом с тестом; перезапись — `make ai-record SCENARIO=<модуль>/<имя>`.

## Подводные камни
- Шаблонная база тестов сбрасывает боевой реестр: облачные записи выключены, цепочки удалены, `test/scripted` включена
  (`platform/db/__fixtures__/test-template.ts`); тесты добавляют нужные записи сами. Умолчания миграции проверяет
  `default-registry.int.test.ts`, выполняя SQL файла миграции.
- Z.ai: `GET /models` не перечисляет бесплатные `*-flash` модели (проба вместо отказа); `json_schema` игнорирует; без
  `thinking: disabled` JSON приходит за ~35 с (проверено 2026-10-29, `openai-compatible.ts`). Free-модели Z.ai бывают
  «перегружены» (429) — это работа цепочки: следующий провайдер.
- Лимиты в миграции: Groq — `rpd`/`tpm` из заголовков живого ответа, `rpm`/`tpd` из таблицы лимитов Groq; у Z.ai не
  опубликованы (`null`). Контекст модели — нижняя граница, в логике не участвует.
- Окно лимитёра — скользящее: минута и 24 часа по `llm_usage`; календарных суток провайдера журнал не знает.
- Кассета повторяет паузы записи (`delays`): e2e видит поток; тесты сценариев их пропускают.
