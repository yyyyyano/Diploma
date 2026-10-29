# Модуль `transactions`

Ярус 2 · таблицы: user · публикует: `transactions.changed`, `transactions.merged` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Операции, переводы и возвраты, сопоставление чек ↔ выписка, массовые действия, агрегации пачками; остаток счёта
пересчитывает фасад `accounts` (STMT-02). Сейчас (T-021, T-022): таблица и фильтры, ввод, правка и удаление с «Отменить»,
карточка с историей, массовые действия, правило из исправления, инструменты агента, фон (курс НБРБ, модель).

## Требования SPEC
TXN-01…11, FIN-01, STMT-02/09, STMT-07/08 (запись), CAT-05 (применить к прошлым).
## Публичный API (`index.ts`)
- Фабрика: `createTransactionsModule({ platform, facades })`; фасадов наружу пока нет. Форма будущего (ARCHITECTURE §4.3,
  §15): агрегаты — **только пачками**, `aggregate(s, { period, groupBy })` → `{ key, total: Money, count }`; запись
  чужими модулями — фасадом с `tx`.
- Контракт `contract.transactions.*` (authed, канал отмены — web, источник — «вручную»): `list` (страница + размер ≤ 100
  + `total`; фильтры — период, счёт, категория, тип, сумма в BYN, источник, текст; сортировка день → время → `id`),
  `get` (карточка: `rate`, `history`),
  `create`/`update` (→ `{ transaction, undoToken, applyToPast }`), `requestDelete`, `requestChangeCategory`,
  `requestMarkTransfer` (`ids` → `{ decisionId }`), `explainRate` (→ `traceId`; курса нет — `UNAVAILABLE`).
- Сценарии — файлы `application/`: `read`, `write`, `remove`, `restore` («Отменить»), `bulk` (массовые решения и их
  «Да»), `rule` (правило из исправления), `background` (курс, модель); общее — `ledger` (ревизии, остатки, событие),
  `prepare` (категория, контрагент, курс), `handlers` (имена обработчиков).
- Запись: валюта — валюта счёта (иное `VALIDATION`), счёт не указан — «Наличные»; расход уводит деньги со счёта, доход и
  возврат приводят, у перевода направление выбирают; категория — выбрана (`user`), иначе `categories.byRules`, непокрытое
  — «Прочее» (`fallback`) и задача `categorize`; BYN — `fxRates.convert` до транзакции, курса нет — `amountInByn: null` и
  задача `fill-rates`; остаток — `accounts.applyBalanceChange`.
- Версия растёт с каждой правкой человека; `expectedVersion` и «Отменить» сверяют её (`CONFLICT`); фон версию не
  трогает, в историю пишет канал `system`. События: `transactions.changed { ids }` — пачка действия, в его транзакции
  (сигнал сайту — сущность `transaction`); `transactions.merged` — T-029.
- Инструменты (`agent/tools.ts`, набор `core`): `search_transactions` (`read`, ≤ 50 строк + `total`), `add_transaction`,
  `update_transaction` (`write` + `undoToken`, источник «ассистент»), `bulk_change_category`, `delete_transaction`
  (`destructive`: только решение). Входы плоские (id — 36 знаков, день «ГГГГ-ММ-ДД», копейки): префикс агента ≤ 3 000
  токенов (`agent-prefix.int.test.ts`, сейчас 2 768), строгий разбор — в `execute`; категорию при добавлении выбирает
  сервер. Агрегации — T-031.
- Отмена `transactions.restore { batchId, rule? }` (создание — удаляет, правка — возвращает «до», удаление — воссоздаёт
  с тем же `id`; пачку, которую правили позже, — `CONFLICT`); подтверждения (`handlers.ts`): `delete`, `bulk-category`,
  `bulk-transfer`, `apply-rule` — каждое отдаёт undoToken «Отменить» сразу после «Да». CAT-05: ручная смена категории
  (источник `user`) у операции с контрагентом пишет правило по его ключу очистки (`categories.setUserRule`, «Отменить»
  возвращает прежнее — `rule.previous`) и предлагает `applyToPast` — прошлые не выбранные вами вручную. Задачи (`jobs/`):
  `fill-rates` (повторяемая `UNAVAILABLE`), `categorize`.
- Таблицы (`userOwnedTable`, `user-data.ts`): `transactions` (счёт, тип, направление, день и время, сумма и валюта, BYN и
  id курса, описание, контрагент и ключ, категория и источник, источник операции, пара, покупка, версия) и
  `transaction_revisions` (пачка, действие, канал, состояние «до»; без FK — история удалённой остаётся). Составные FK —
  руками в миграции `*_transactions`: счёт и своя категория `RESTRICT`, пара и покупка `SET NULL (колонка)`.

## Зависимости
Можно: accounts, categories, merchants, fx-rates, actions, explain, notifications (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- Фасад без агрегатов пачками (метод «сумма по одной категории» в цикле) — нет: только `aggregate`.
- В чужой модуль — только через его `index.ts`, из «Можно»; наверх — событием (ADR-0004). Данные — только через
  `s: ScopedDb` с `s.own(таблица)`, «чьи» — только `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/transactions` — правила (`domain/`); сценарии на Postgres с настоящими
  accounts, actions, explain, merchants и categories (`main/__fixtures__/transactions-with-journal.ts`: курсы НБРБ — карта
  в памяти, шлюз моделей — шпион): `operations`, `list`, `bulk`, `background`, `agent/tools`; изоляция —
  `main/isolation.registry.int.test.ts`. Бюджет «страница 50 строк ≤ 150 мс p95» — `make bench`
  (`application/list.bench.ts`, 10 000 операций; p95 печатается).
