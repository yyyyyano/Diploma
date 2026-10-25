# Модуль `statements`

Ярус 2 · таблицы: user · публикует: `statements.imported`, `statements.rolled-back` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Импорт: чтение PDF/XLSX/XLS/CSV/сканов, определение колонок, запоминание формата, дубли, типы, предпросмотр, откат.
Сейчас модуль пустой, но живой (T-007): фабрика, описание `defineModule({ id: "statements" })` и место в корне
композиции; содержимое добавляет задача модуля.

## Требования SPEC
STMT-03…12, SEC-10/11 (документы).

## Публичный API (`index.ts`)
- Фабрика: `createStatementsModule({ platform, facades })` → `defineModule({ id: "statements" })`; платформа —
  `Platform` (без `SystemDb`); фасады — `facades.files`, `facades.accounts`, `facades.transactions`,
  `facades.categories`, `facades.merchants`, `facades.fxRates`, `facades.llm`, `facades.actions`,
  `facades.notifications`.
- Фасад `StatementsFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): `statements.imported`, `statements.rolled-back`; контракт, задачи, инструменты агента,
  отмена, владелец данных, настройки — добавляет задача модуля.

## Зависимости
Можно: files, accounts, transactions, categories, merchants, fx-rates, llm, actions, notifications (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/statements` — unit и int (нужен `make db-up`); общий — `make check`.
