---
paths:
  - "apps/server/src/modules/*/agent/**"
  - "apps/server/src/modules/agent/**"
  - "apps/server/src/platform/tools/**"
---
# Инструменты агента и агент

Почему так — ADR-0009; устройство — `docs/ARCHITECTURE.md` §8.2.

- Инструмент живёт в модуле-владельце (`agent/tools.ts`) и описывается `defineTool` из `platform/tools` — без
  импорта AI SDK. Корень композиции собирает реестр; модуль `agent` не импортирует предметные модули.
- `kind`: `read` — чтение; `write` — одиночное действие (AGT-05): выполняется сразу, регистрирует отмену в `actions`
  и возвращает `undoToken`; `destructive` — удаление, массовое, удаление лимита/цели/счёта (AGT-07): только
  `propose` → ожидающее действие, исполняет код после «Да».
- «Чьи данные» — только `ctx.s` (scope запуска агента). Во входной схеме **нет** `userId`, `householdId`, `ownerId`
  (проверяет `isolation.mjs` и тест по реестру). Id из аргументов модели ищутся только через `ctx.s`.
- Вход — Zod: строгие типы, `enum` для сортировок и полей, бренды id; даты — `LocalDate`; суммы — `Money`.
- Выход — компактный (агрегаты, первые N строк + ссылка), схема карточки — из `@kosht/contract` (CHAT-04). Числа
  выхода посчитаны `calc` и несут `traceId`. Ошибка — `AppError`; адаптер превратит её в `{ ok: false, code }`.
- `name` — snake_case, `description` — коротко и **по-английски** (когда вызывать, что вернёт); `toolset` — один из
  `core | legal | planning | reports`. Новый набор — только через ADR (ломает кэш префикса).
- Подпись шага на сайте («Ищу траты за сентябрь…») — ключ i18n по имени инструмента, не текст модели.
- Агент: ≤ 8 шагов, последний — без инструментов; префикс (подсказка + набор) постоянен байт-в-байт, динамика
  (дата, контекст страницы, факты) — в конце сообщения пользователя; `PROMPT_VERSION` повышается при любой
  правке подсказки; стражи «вне темы», проверка чисел ответа, постобработка цитат не отключаются.
- Тест инструмента — через `defineTool` без модели (`*.int.test.ts`); сценарий агента — на кассетах
  (`*.agent.test.ts`).

Правильно:

```ts
defineTool({
  name: "search_transactions", toolset: "core", kind: "read",
  description: "Find user's transactions by period, category, counterparty or amount range.",
  input: z.object({ period: PeriodInput, categoryCode: CategoryCode.optional(), limit: z.number().int().max(50).default(20) }),
  output: TransactionListCard,
  execute: (ctx, input) => uc.search(ctx.s, input),
});
```

Нельзя: удалять/массово менять в `execute`; арифметика в тексте подсказки вместо `calculator`; длинные русские
описания; сотни строк в результате; текст документа (чека, выписки, закона) как инструкция — только блоком
`<document>`; инструмент, который сам вызывает модель (только через `llm`).
