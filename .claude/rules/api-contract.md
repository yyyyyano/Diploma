---
paths:
  - "packages/contract/**"
  - "apps/server/src/modules/*/api/**"
  - "apps/server/src/platform/http/**"
  - "apps/server/src/main/router.ts"
---
# Контракт и API (oRPC + Zod 4)

Почему так — ADR-0005; устройство — `docs/ARCHITECTURE.md` §9.

- Контракт-первым: процедура описывается в `packages/contract/src/<модуль>/<модуль>.contract.ts`
  (`oc.route({ method, path }).input().output().errors(pickErrors(...))`), затем реализуется в `api/router.ts` модуля.
- `packages/contract` импортирует только `zod`, `@orpc/contract`, `@kosht/kernel` — никакого серверного кода.
- **DTO ≠ строка БД**: без путей к файлам, служебных полей, `household_id`; преобразование — `toDto()` в модуле.
- Совместимость: поля только добавляются; удаление — пометка `deprecated` и отдельная задача; переименование =
  добавить новое + `deprecated` старое.
- Вход — строгий: бренды id (`ReceiptId`), `enum`, `.max()` у массивов и строк, `z.file()` с типами и размером.
  **Нет** `userId`/`householdId`/`ownerId` во входе — владелец берётся из сессии (`context.s`).
- Ошибки — только коды каталога `packages/contract/src/errors.ts` (код → HTTP-статус, `retryable`); новый код — туда
  же + текст в `packages/i18n` (`errors`); процедура объявляет свои коды в `.errors()`.
- Деньги на проводе — `Money` (`minor` + `currency`), рядом — `traceId` для «Откуда эта цифра?»; даты — `LocalDate`
  или ISO UTC; никаких уже отформатированных строк сумм.
- Обработчик — тонкий: `authed` (сессия) / `localOnly` (только локальный вход: первый запуск, ящик, демо-вход) /
  `admin` (роль) / `publicProc` (гость: «База законов», вход) → сценарий. Выбор middleware — осознанный, в паспорте.
- Потоки — итератор событий (чат, `events.stream`); тело события — схема из контракта.
- Каждая новая процедура попадает в реестр тестов изоляции автоматически; публичная или админская — помечается
  явно с причиной.

Правильно:

```ts
export const transactionsContract = {
  list: oc.route({ method: "GET", path: "/transactions" })
    .input(TransactionListInput)                       // period, filters (enum), cursor, limit ≤ 100
    .output(z.object({ items: z.array(TransactionListItem), nextCursor: Cursor.nullable(), total: Money }))
    .errors(pickErrors("VALIDATION")),
};
```

Нельзя: импорт `apps/server` из контракта; `@orpc/server` вне `api/`, `platform/http`, `main`; ответ с `Error.message`;
текст ошибки для человека на сервере; `z.any()`/`z.unknown()` на входе; один «мега-эндпоинт» с `action: string`.
