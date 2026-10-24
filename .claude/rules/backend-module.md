---
paths:
  - "apps/server/src/modules/**"
  - "apps/server/src/main/**"
---
# Модуль сервера

Устройство — `docs/ARCHITECTURE.md` §4–5; карта и `dependsOn` — `tooling/architecture/modules.ts` (до бетона —
`docs/CAPABILITIES.md`); проверка — `make deps-check`. Сначала прочитай паспорт модуля (`<модуль>/CLAUDE.md`).

- Наружу — только `index.ts`: фабрика `create<Id>Module` и **типы** фасада. Без `export *` из `infrastructure/`.
  В чужой модуль — только через его `index.ts` и только если он в `dependsOn`. Новая зависимость — правка
  `modules.ts` в той же задаче + пункт итога задачи с обоснованием; зависимость вверх — событие или реестр (ADR-0004).
- Раскладка: `domain/` чистое (без БД, сети, времени, платформы) · `application/` — сценарий = файл, фабрика
  `make<Сценарий>(deps)` → `(s, input)` · `infrastructure/` — SQL и адаптеры · `api/`, `jobs/`, `agent/`,
  `subscriptions/` — тонкие, зовут сценарии, а не репозитории.
- Первый аргумент сценария и фасада с данными пользователя — `s: ScopedDb` (в транзакции — `tx`). В `llm`, конверт
  задачи, `realtime` передавай `s.scope`. Модули с системными таблицами получают `SystemDb` (флаг `systemTables`).
- Транзакция — явно `s.transaction(tx => …)` и только ради атомарности; внутри — БД, `events.publish(tx, …)`,
  фасады соседей с `tx`. Модель, HTTP, файлы — до или после.
- Числа — только `@kosht/calc`; показываемое число сохраняй `explain.save(s, calc)` и отдавай `traceId`.
- Ошибки — `throw new AppError("КОД", params)`; код — в `packages/contract/src/errors.ts`, текст — в словаре
  `errors` `packages/i18n`. Не бросай строки и `Error` с текстом для пользователя.
- Одиночное изменяющее действие регистрирует отмену в `actions` (`undo` в `defineModule`); удаление и массовое —
  только ожидающее действие (`confirm`).
- Новые пользовательские данные → запись в `user-data.ts` (`defineUserData`); «для всех» — `*.sweep.ts`.
- Настройки и пороги (допуски, окна, лимиты) — `settings.ts` (`defineSetting`), не константы в коде.
- Логи: `log.info({ receiptId, ms }, "receipt.recognized")` — ключ события + id.
- Изменил публичный API, зависимости, события, таблицы или запреты — обнови паспорт в том же коммите.

Правильно:

```ts
// api/router.ts — проверили вход контрактом, вызвали сценарий; ни SQL, ни правил
export const receiptsRouter = (uc: ReceiptsUseCases) => ({
  get: authed.receipts.get.handler(({ input, context }) => uc.get(context.s, input.id)),
  updateItems: authed.receipts.updateItems.handler(({ input, context }) => uc.updateItems(context.s, input)),
});
```

Нельзя:
- импорт `../../transactions/infrastructure/...` или чужого `application/` — только `index.ts` соседа;
- писать в чужие таблицы или создавать чужие сущности SQL-ом (операции создаёт только `transactions`);
- «сервис на 40 методов» вместо файлов сценариев; бизнес-логика в `api/`, `jobs/`, `main/`;
- порт-интерфейс на каждый репозиторий (порты — только для внешнего мира);
- брать «чей пользователь» из `input`; глобальные синглтоны с данными пользователя.
