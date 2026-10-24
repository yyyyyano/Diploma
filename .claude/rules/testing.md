---
paths:
  - "**/*.test.{ts,tsx}"
  - "**/*.int.test.ts"
  - "**/*.agent.test.ts"
  - "**/*.contract.test.ts"
  - "**/__cassettes__/**"
  - "**/__fixtures__/**"
  - "e2e/**"
  - "packages/testing/**"
  - "datasets/**"
---
# Тесты

Стратегия и уровни — `docs/ARCHITECTURE.md` §12; пороги — `CONSTRAINTS.md`.

- Где: рядом с файлом — `x.test.ts` (без БД), `x.int.test.ts` (настоящий Postgres, шаблонная БД на файл),
  `*.agent.test.ts` (сценарии агента на кассетах), `*.test.tsx` (компоненты); `apps/server/src/main/*.contract.test.ts`
  и `isolation.*.int.test.ts`; `e2e/specs/*.spec.ts`. Отдельного дерева `tests/` нет.
- Офлайн и детерминированно: время — `FakeClock`, файлы — `MemoryBlobStore`, модели — кассеты (`ReplayModel`, режим
  `replay`) или `MockLanguageModelV4`, pravo.by и НБРБ — фикстуры, прочий HTTP — MSW. Промах кассеты — ошибка с
  подсказкой `make ai-record SCENARIO=…`, а не поход в сеть.
- Сценарий модуля — `*.int.test.ts` на реальной БД (не фейки репозиториев). Чистые правила `domain/` и `calc` —
  `*.test.ts`. Новая процедура/инструмент попадает в генерируемый тест изоляции — нужна фикстура для её бренда id
  (тест подскажет «добавьте фикстуру»).
- Название теста — человеческое, по-русски, с ожидаемым результатом: `it("чек 3 × 2,49 = 8,47 не сходится и называет
  строку 2")`. Один тест — одно поведение; утверждения — о результате, а не о внутренних вызовах.
- Примеры и КП из SPEC — тесты с номером требования в `describe`: `describe("TAX-07", …)`.
- Тестовые данные — фабрики `@kosht/testing` и синтетика `tooling/synth/`; реальные ПД, `samples/` и реальные
  выписки — никогда (NFR-18). Фикстуры pravo.by — сохранённые страницы с указанием даты.
- Кассеты (`__cassettes__/`) и фикстуры (`__fixtures__/`) — рядом с тестом; перезапись кассет — только
  `make ai-record` (тратит лимиты, нужны ключи), отдельным коммитом `test(...)`.
- E2E: 5–8 ключевых сценариев + axe на каждом маршруте при 1440 и 390 px; сервер — в режиме кассет.
- Eval (QA-10…15) — не в `make test`: `*.eval.ts` в модуле `quality`, запуск `make eval`.

Правильно:

```ts
describe("RCPT-06", () => {
  it("перепроверка исправила строку 2 — чек получает статус «сходится» и историю перепроверки", async () => {
    const { s, receipt } = await seedReceiptWithBadLine(db);
    await recognize(s, receipt.id);                          // кассета: receipts/recheck-fixes-line-2
    expect(await getReceipt(s, receipt.id)).toMatchObject({ status: "ok", rechecks: 1 });
  });
});
```

Нельзя: `.skip`, `.only`, `.todo`; `sleep`/реальные таймеры для ожидания; сеть и реальные ключи; общие изменяемые
данные между тестами; удалять или ослаблять тест, чтобы прошёл код; snapshot вместо проверки смысла.
