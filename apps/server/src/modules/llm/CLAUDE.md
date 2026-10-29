# Модуль `llm`

Ярус 1 · таблицы: system, user · публикует: `llm.local-models-ready` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Шлюз к моделям — единственный, кто знает провайдеров: реестр, цепочки по задачам, лимитёр, журнал расхода, выбор модели,
маскирование перед облаком, локальные модели (загрузчик, самотест), админка ИИ, кассеты, трассы.

## Требования SPEC
LLM-01…06, 08…10, NFR-02/04/05/25, PRIV-02/03/04/09, SEC-10/11, OBS-03, ADM-20/21/22/50, NOTIF-03, QA-17, PRIV-06; LLM-07 — набор под машину без видеокарты (каталог).

## Публичный API (`index.ts`)
- Фабрика `createLlmModule({ platform, facades })` (`SystemPlatform`). `LlmFacade` = `LlmGateway`: `model(caller, "chat")` →
  `{ model, telemetry }` (цепочка как одна модель), `extract(caller, { task, schema, instructions, document, images?,
  promptVersion })`, `classify`, `embed` (только локально), `transcribe`; `LlmAdminFacade` = `LlmFacade` + `admin` (только
  модулю `admin`). `Embedder` (`gatewayEmbedder`; в тестах `hashEmbedder` из `@kosht/testing`), событие `localModelsReady`.
  `systemCaller("<модуль>")`, `Caller`: scope (облако — по `platform.consent` с версией текста) или задача без данных.
- Ответ цепочки: `providerMetadata.kosht = { model, unavailable }` — «Модель X недоступна, ответила Y» (LLM-10).
- Процедуры: `llm.models`, `llm.setPreferredModel` (authed, только чат); `llm.localModelsProgress` (localOnly: прогресс
  скачивания для первого запуска, опрос 2 с). Админу — `admin.ai*` (цепочки, реестр, ключи, расход) и локальные модели.
- Маскирование (PRIV-03): правила + склонённый словарь имён (`platform.knownNames`, даёт `profile`) + NER; метки на один
  вызов; демаскируются текст, поток, аргументы инструментов. Только облачные записи цепочки и вызов пользователя; шлюзу
  `masker` обязателен. Изображения — `sharp` без EXIF/GPS (PRIV-04), скан выписки — как есть. Документ: приказы и теги
  `</document>` нейтрализуются (SEC-10). Langfuse: `maskingSpanProcessor` + реестр замен (TTL 10 мин).
- Локальные модели (NFR-25): каталог с закреплёнными адресами и sha256, `downloadFile` (Range, `.part`, место), задача
  `llm.download-models` (старт — `identity.system-initialized` и кнопка; `llm.models-download` выключает), `presets.ini`
  для роутера llama-server, самотест («2+2», порядок векторов) с откатом на процессор, состояние — `llm_local_models`.
- Настройки: `llm.mode`, `llm.cassette(-delays)`, `llm.timeout-{cloud,local}-ms`, `llm.llama-base-url`,
  `llm.models-download`, `llm.{usage,trace}-retention-days`; секреты `llm.{groq,zai}-api-key`. Расписания: `llm.trace-
  deletions` (03:40), `llm.usage-retention` (03:20), `llm.trace-retention` (03:30). Админу — `ai-provider` (лимит, ошибка).
- Таблицы `systemTable`: `llm_models`, `llm_task_chains`, `llm_usage`, `llm_trace_deletions`, `llm_local_models`;
  `userOwnedTable` `llm_preferences`. Миграции: `…_llm-providers`, `…_llm-statement-scan`, `…_llm-local-models`.

## Устройство
- `domain/`: задачи, `build-chain.ts`, цена, `masking/` (метки, правила, имена), `injection.ts`. `application/`:
  `gateway.ts`, `chained-model.ts`, `limiter.ts`, `metered-model.ts`, `masking/` (`masker`, `masked-model`, `prompt`,
  `stream-unmasker`, `trace-mask`), `local-models/`, `preferences.ts`, `retention.ts`, `admin.ts`.
- `infrastructure/`: `providers/` (Groq, Z.ai, llama-server, кассеты), `masking/ner.ts` (transformers.js, лениво),
  `images/strip-metadata.ts` (`sharp`), `telemetry/` (Langfuse), `db/`. Подробности — ADR-0009, ADR-0011.

## Зависимости
Можно: privacy, identity, notifications (`tooling/architecture/modules.ts`). Слушает: `identity.system-initialized`.
`ai`, `@ai-sdk/*` — здесь; `@langfuse/*` — `telemetry/`; `sharp` — `images/`; `@huggingface/*` — `masking/` (правила `rules.ts`).

## Запреты
- Модель строкой и Vercel AI Gateway; облачная модель в обход `buildChain`, согласия и маскирования; векторы — не локально.
- Тексты запросов и ответов — в журнал, лог и трассы без маски (OBS-04); вызов модели в `s.transaction`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/llm`: цепочка на `MockLanguageModelV4`, маскирование (`masking/*.test.ts`,
  `gateway-masking.int.test.ts`, канарейка Langfuse `trace-mask.test.ts`), загрузчик на локальном HTTP-сервере
  (`local-models/*`), шлюз и админка на Postgres; прогресс и кнопки — `main/local-models.int.test.ts`.

## Подводные камни
- Шаблон тестовой БД сбрасывает боевой реестр (облачные выключены, цепочки удалены, `test/scripted` включена).
- Встроенная `mask` Langfuse не видит атрибуты GenAI (`gen_ai.*`) — маскирует свой процессор; NER на настоящей модели в
  фазе 3 не проверялась (модели не скачивались): только токены-имитации; INI-ключи роутера сверены по README, не запуском.
- Z.ai: `GET /models` без `*-flash`, `json_schema` игнорируется, нужен `thinking: disabled`; free-модели «перегружены» (429).
- Кассеты — `__cassettes__/` (`make ai-record SCENARIO=…`); повторяют паузы записи (`delays`).
