# Пакет `@kosht/contract` — форма данных «на проводе»: схемы, каталог ошибок, процедуры oRPC

## Назначение
Контракт-первым (ADR-0005): сайт и сервер делят одни схемы Zod 4 и описания процедур oRPC, не импортируя друг
друга. Отдельно от `kernel`, потому что меняется ради экранов. Правила кода — `.claude/rules/api-contract.md`.

## Кто использует
`apps/server` (реализует процедуры в `api/router.ts` модулей, переводит `AppError` в ответ), `apps/web` (клиент
oRPC, формы на схемах), `@kosht/i18n` (тексты ошибок по `ErrorCode`).

## Публичный API
- Вход: `packages/contract/src/index.ts`.
- Ошибки (`errors.ts`): `ERRORS` — код → `{ status, retryable }` (8 базовых: `VALIDATION` 400, `UNAUTHORIZED` 401,
  `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `RATE_LIMITED` 429 повторяемая, `INTERNAL` 500, `UNAVAILABLE`
  503 повторяемая); `ErrorCode`, `ERROR_CODES`, `isRetryable(code)`; `ErrorData = { requestId, params }`
  (параметры — строка, число или флаг для подстановки в текст); `pickErrors(...codes)` — карта для `.errors()`.
- Общие схемы (`common.ts`): `Money`, `LocalDate` — те же объекты, что в `kernel`; `PageNumber` (целое ≥ 1),
  `PageSize` (1..100, по умолчанию 50), `RowCount` (целое ≥ 0).

## Можно зависеть от
`zod`, `@orpc/contract` (версия — `catalog:` в `pnpm-workspace.yaml`), `@kosht/kernel` — правило
`contract-allowed-deps` в `tooling/architecture/rules.ts`.

## Запреты
- Серверный код, `@orpc/server`, `@orpc/openapi` — нет (ADR-0005).
- Код ошибки вне каталога, текст ошибки для человека, `Error.message` в данных — нет: текст — в словаре `errors`.
- `userId` / `householdId` / `ownerId` в схемах — нет (проверяет `isolation.mjs`): владелец — из сессии.

## Как тестировать
- `pnpm vitest run packages/contract`; «не компилируется» (код вне каталога) — тест с `@ts-expect-error`.

## Подводные камни
- `pickErrors` в обход типов (`as`) с чужим кодом — `RangeError`: карта ошибок без статуса молча сломала бы ответ.
