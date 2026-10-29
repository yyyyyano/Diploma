# Модуль `transactions`

Ярус 2 · таблицы: user · публикует: `transactions.changed`, `transactions.merged` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Операции, переводы и возвраты, сопоставление чек ↔ выписка, массовые действия, агрегации пачками; остаток счёта
пересчитывает фасад `accounts` (STMT-02). Сейчас (T-021): таблица со страницами и фильтрами, ввод и правка с «Отменить»,
удаление после «Да», карточка с историей, инструменты агента, фон (курс НБРБ, модель). Массовые действия — T-022.

## Требования SPEC
TXN-01…11, FIN-01, STMT-02/09, STMT-07/08 (запись), CAT-05 (применить к прошлым).
## Публичный API (`index.ts`)
- Фабрика: `createTransactionsModule({ platform, facades })` → `defineModule({ id, router, events, jobs, tools, undo,
  confirm, userData })`; фасадов наружу пока нет. Форма будущего (ARCHITECTURE §4.3, §15): агрегаты — **только
  пачками**, `aggregate(s, { period, groupBy })` → `{ key, total: Money, count }`; запись чужими модулями — фасадом с `tx`.
- Контракт `contract.transactions.*` (authed, канал отмены — web, источник — «вручную»): `list` (страница + размер ≤ 100
  + `total`; фильтры — период, счёт, категория, тип, сумма в BYN, источник, текст по контрагенту, описанию, комментарию и
  названию категории; сортировка день → время (без времени — в конце дня) → `id`), `get` (карточка: `rate`, `history`),
  `create`/`update` (→ `{ transaction, undoToken }`), `requestDelete { ids }` (→ `{ decisionId }`), `explainRate`
  (→ `traceId`; курса нет или он уже не тот — `UNAVAILABLE`).
- Сценарии — файлы `application/`: `read`, `write` (create, update), `remove` (requestDelete, confirmDelete), `restore`
  («Отменить»), `background` (fillRates, categorizeFallback); общее — `ledger` (ревизии, сдвиг остатков, событие и
  сигнал), `prepare` (категория, контрагент, курс), `operations` (сборка).
- Запись: валюта операции — валюта её счёта (иное — `VALIDATION`), счёт не указан — «Наличные»; расход уводит деньги
  со счёта, доход и возврат приводят, у перевода направление выбирают; категория — выбрана (`user`), иначе
  `categories.byRules`, непокрытое — «Прочее» (`fallback`) и задача `categorize`; эквивалент в BYN — `fxRates.convert` до
  транзакции, курса нет — `amountInByn: null` и задача `fill-rates`. Остаток счёта сдвигается на сумму операции
  (`accounts.applyBalanceChange`), день остатка не уходит назад.
- Версия растёт с каждой правкой человека; `expectedVersion` и «Отменить» сверяют её (позднюю правку не затираем —
  `CONFLICT`); фон версию не трогает, в историю пишет канал `system`. События: `transactions.changed { ids }` — пачка
  одного действия, в его транзакции (сигнал сайту — сущность `transaction`); `transactions.merged` — T-029.
- Инструменты (`agent/tools.ts`, набор `core`): `search_transactions` (`read`, ≤ 50 строк + `total`), `add_transaction`,
  `update_transaction` (`write` + `undoToken`, источник «ассистент»), `delete_transaction` (`destructive`: только
  решение). Входы плоские (id — 36 знаков, день «ГГГГ-ММ-ДД», копейки числом): префикс агента ≤ 3 000 токенов
  (`agent-prefix.int.test.ts`, сейчас 2 649), строгий разбор — в `execute` (`VALIDATION`); категорию добавлению
  подбирает сервер. Агрегации — T-031.
- Отмена `transactions.restore { batchId }` (создание — удаляет, правка — возвращает «до», удаление — воссоздаёт с тем
  же `id`); подтверждение `transactions.delete { ids, channel }` отдаёт undoToken «Отменить» сразу после «Да». Задачи
  (`jobs/`): `transactions.fill-rates` (повторяемая `UNAVAILABLE`, пока НБРБ молчит), `transactions.categorize`.
- Таблицы (`userOwnedTable`, `user-data.ts`): `transactions` (счёт, тип, направление, день и время, сумма и валюта,
  сумма в BYN и id курса, исходное описание, контрагент и ключ, комментарий, категория и источник, источник операции,
  видимость, пара перевода, исходная покупка, версия), `transaction_revisions` (пачка, действие, канал, состояние «до»,
  версия после, поля; без FK на операцию — история удалённой остаётся). Составные FK на `accounts`, `categories`,
  `system_categories` и на себя — руками в миграции `*_transactions`: счёт и своя категория — `RESTRICT`, пара и
  покупка — `SET NULL (колонка)`. Правила без БД — `domain/transactions.ts`.

## Зависимости
Можно: accounts, categories, merchants, fx-rates, actions, explain, notifications (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- Фасад без агрегатов пачками (метод «сумма по одной категории» в цикле) — нет: только `aggregate`.
- В чужой модуль — только через его `index.ts`, из «Можно»; наверх — событием (ADR-0004). Данные — только через
  `s: ScopedDb` с `s.own(таблица)`, «чьи» — только `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/transactions` — правила (`domain/`); сценарии на Postgres с настоящими
  accounts, actions, explain, merchants и categories (`main/__fixtures__/transactions-with-journal.ts`: курсы НБРБ — карта
  в памяти, шлюз моделей — шпион): `operations`, `list`, `background` (`*.int.test.ts`), `agent/tools.int.test.ts`;
  изоляция — `main/isolation.registry.int.test.ts`. Бюджет «страница 50 строк ≤ 150 мс p95» — `make bench`
  (`application/list.bench.ts`, 10 000 операций; p95 печатается).
