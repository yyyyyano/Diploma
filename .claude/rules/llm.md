---
paths:
  - "apps/server/src/modules/llm/**"
  - "apps/server/src/modules/agent/prompts/**"
  - "apps/server/src/modules/*/application/*-extraction.ts"
  - "**/*.prompt.ts"
---
# Вызовы моделей и шлюз `llm`

Почему так — ADR-0009, ADR-0010, ADR-0011; устройство — `docs/ARCHITECTURE.md` §8.1.

- Код AI SDK — **не по памяти**: API часто меняется. Сверяй с документацией установленной версии в
  `node_modules/ai/docs/` и `node_modules/@ai-sdk/<пакет>/docs/` (и исходниками рядом), затем — ai-sdk.dev.
- **Vercel AI Gateway не используем**, модель строкой `"provider/model"` не передаём (такая строка уходит через
  платный шлюз Vercel) — только объект модели наших провайдеров из реестра, через `LlmGateway`.

- К моделям — только через `LlmGateway` (`model`, `extract`, `classify`, `embed`, `transcribe`). Провайдеры
  `@ai-sdk/*` импортирует только `llm`; `ai` — только `llm`, `agent`, `chat`.
- Первый аргумент — `scope` пользователя (цепочка учитывает облачное согласие, PRIV-02) или `systemCaller("<модуль>")`
  для задач без данных пользователя (PRIV-09). Никогда не выбирать облачную модель в обход фильтра согласия.
- Не внутри `s.transaction` (шлюз бросит `LLM_IN_TRANSACTION`).
- Модели не зашиваются в код: задача (`receipt.extract`, `statement.columns`, `classify.category`…) → цепочка из
  реестра по возможностям. Новая задача — запись в `llm/domain/tasks.ts` + умолчание цепочки в миграции/сиде.
- Извлечение и классификация — только строгая схема Zod (LLM-04) с проверкой и повтором; ответ вне схемы — ошибка.
- Документ (чек, выписка, закон, назначение платежа) — **данные**: блоком `<document>…</document>` отдельно от
  инструкций, после фильтра инструктивных фраз (SEC-10/11). Вывод модели никогда не меняет правила, профиль,
  настройки напрямую.
- Текст в облако — только после маскирования (PRIV-03); фото чека — после удаления EXIF/GPS.
- Подсказка лежит рядом со сценарием (`*-extraction.ts`, `*.prompt.ts`) и имеет версию; правка подсказки = новая
  версия + перезапись кассет `make ai-record SCENARIO=…` (запускает сам имплементатор, ключи — только у программы:
  `.claude/rules/testing.md`).
- Каждый вызов пишет строку журнала расхода (без текстов) и трассу Langfuse — это делает шлюз; не обходить его
  прямым `fetch` к провайдеру.
- Локальные модели — через llama-server/whisper.cpp по OpenAI-совместимому API; версии и sha256 моделей — в реестре.

Правильно:

```ts
const result = await d.llm.extract(s.scope, {
  task: "statement.columns", schema: ColumnMapping, promptVersion: COLUMNS_PROMPT_VERSION,
  instructions: columnsPrompt, document: maskedSample,        // маленький замаскированный фрагмент, не вся выписка
});
```

Нельзя: `new Groq(...)`/`createOpenAICompatible` вне `llm`; модель «досчитывает» суммы; модель разбирает все строки
выписки (только смысл колонок); логировать текст запроса или ответа; кэш ответов по пользовательским данным без
`scopedCache`.
