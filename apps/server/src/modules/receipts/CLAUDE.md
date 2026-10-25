# Модуль `receipts`

Ярус 2 · таблицы: user · публикует: `receipts.recognized`, `receipts.needs-review`, `receipts.warranty-items-found` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Чеки: QR, распознавание, валидатор, перепроверка, дубли, правка, гарантийные позиции. Сейчас модуль пустой, но живой
(T-007): фабрика, описание `defineModule({ id: "receipts" })` и место в корне композиции; содержимое добавляет задача
модуля.

## Требования SPEC
RCPT-01…15, PRIV-04, SEC-11.

## Публичный API (`index.ts`)
- Фабрика: `createReceiptsModule({ platform, facades })` → `defineModule({ id: "receipts" })`; платформа — `Platform`
  (без `SystemDb`); фасады — `facades.files`, `facades.transactions`, `facades.categories`, `facades.merchants`,
  `facades.llm`, `facades.actions`, `facades.notifications`, `facades.explain`.
- Фасад `ReceiptsFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): `receipts.recognized`, `receipts.needs-review`, `receipts.warranty-items-found`; контракт,
  задачи, инструменты агента, отмена, владелец данных, настройки — добавляет задача модуля.

## Зависимости
Можно: files, transactions, categories, merchants, llm, actions, notifications, explain (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/receipts` — unit и int (нужен `make db-up`); общий — `make check`.
