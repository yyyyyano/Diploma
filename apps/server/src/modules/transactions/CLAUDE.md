# Модуль `transactions`

Ярус 2 · таблицы: user · публикует: `transactions.changed`, `transactions.merged` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Операции, разбивка по категориям, переводы и возвраты, предварительные, сопоставление чек ↔ выписка, массовые
действия, агрегации пачками; вызывает фасад `accounts` для пересчёта остатка (STMT-02). Сейчас модуль пустой, но живой
(T-007): фабрика, описание `defineModule({ id: "transactions" })` и место в корне композиции; содержимое добавляет
задача модуля.

## Требования SPEC
TXN-01…11, FIN-01, STMT-07/08 (запись), CAT-05 (применить к прошлым).

## Публичный API (`index.ts`)
- Фабрика: `createTransactionsModule({ platform, facades })` → `defineModule({ id: "transactions" })`; платформа —
  `Platform` (без `SystemDb`); фасады — `facades.accounts`, `facades.categories`, `facades.merchants`,
  `facades.fxRates`, `facades.actions`, `facades.explain`, `facades.notifications`.
- Фасад `TransactionsFacade` — пока нет (`undefined`). Его форма зафиксирована до первой задачи модуля (ARCHITECTURE
  §4.3, §15 «бог-модули» и N+1 на дашборде): агрегаты — **только пачками**, одним вызовом на всю выборку:
  `aggregate(s, { period, groupBy })` → строки `{ key, total: Money, count }` по ключу группировки (`category`,
  `merchant`, `month`, `account`); соседи (`fin`, `budgets`, `recurring`, `dashboard`, `tax`, `weekly`) не зовут фасад
  «по категории в цикле». Запись чужими модулями — только фасадом с `tx` (`recordFromReceipt(tx, …)`, импорт
  выписки); пересчёт остатка — вызов фасада `accounts` (STMT-02).
- События (`events.ts`): `transactions.changed`, `transactions.merged`; контракт, задачи, инструменты агента, отмена,
  владелец данных, настройки — добавляет задача модуля.

## Зависимости
Можно: accounts, categories, merchants, fx-rates, actions, explain, notifications (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- Фасад без агрегатов пачками (метод «сумма по одной категории», который зовут в цикле) — нет: только `aggregate`.
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/transactions` — unit и int (нужен `make db-up`); общий — `make check`.
