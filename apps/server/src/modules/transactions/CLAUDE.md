# Модуль `transactions`

Ярус 2 · таблицы: user · публикует: `transactions.changed`, `transactions.merged` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Операции, разбивка по категориям, переводы и возвраты, предварительные, сопоставление чек ↔ выписка, массовые
действия, агрегации пачками; вызывает фасад `accounts` для пересчёта остатка (STMT-02). Сейчас (T-021): таблица со
страницами и фильтрами, ручной ввод и правка с «Отменить», удаление после «Да», карточка с историей, инструменты
агента, фон (курс НБРБ и модель для категории). Массовые действия и правило из исправления — T-022.

## Требования SPEC
TXN-01…11, FIN-01, STMT-02/09, STMT-07/08 (запись), CAT-05 (применить к прошлым).

## Публичный API (`index.ts`)
- Фабрика: `createTransactionsModule({ platform, facades })` → `defineModule({ id, router, events, jobs, tools, undo,
  confirm, userData })`; фасадов наружу пока нет (`undefined`). Форма будущего фасада зафиксирована (ARCHITECTURE §4.3,
  §15): агрегаты — **только пачками**, `aggregate(s, { period, groupBy })` → `{ key, total: Money, count }`; запись
  чужими модулями — только фасадом с `tx` (`recordFromReceipt(tx, …)`, импорт выписки).
- Контракт `contract.transactions.*` (authed, канал отмены — web, источник — «вручную»): `list` (страница + размер ≤ 100
  + `total`; фильтры — период, счёт, категория, тип, сумма в BYN, источник, текст по контрагенту, описанию, комментарию
  и названию категории; сортировка день → время (без времени — в конце дня) → `id`), `get` (карточка: `rate` для валюты
  и `history`), `create`/`update` (→ `{ transaction, undoToken }`), `requestDelete { ids }` (→ `{ decisionId }`),
  `explainRate` (→ `traceId`, курса нет или он уже не тот — `UNAVAILABLE`).
- Сценарии — файлы `application/`: `read` (list, get, explainRate), `write` (create, update), `remove` (requestDelete,
  confirmDelete), `restore` («Отменить»), `background` (fillRates, categorizeFallback); общее — `ledger` (ревизии,
  сдвиг остатков, событие и сигнал), `prepare` (категория, контрагент, курс), `operations` (сборка).
- Правила записи: операция пишется в валюте своего счёта (иное — `VALIDATION`), счёт не указан — «Наличные»; расход
  уводит деньги со счёта, доход и возврат приводят, у перевода направление выбирают; категория — выбрана (источник
  `user`), иначе правила `categories.byRules`, непокрытое — «Прочее» (`fallback`) и задача `transactions.categorize`;
  эквивалент в BYN — `fxRates.convert` до транзакции, курса нет — `amountInByn: null` и задача `transactions.fill-rates`.
  Остаток счёта сдвигается всегда на сумму операции (`accounts.applyBalanceChange`), день остатка не уходит назад.
- Версия операции растёт с каждой правкой человека; `expectedVersion` и «Отменить» сверяют её (позднюю правку не
  затираем — `CONFLICT`). Фон (курс, модель) версию не трогает и пишет в историю канал `system`.
- События (`events.ts`): `transactions.changed { ids }` — пачка id одного действия (в той же транзакции); сигнал сайту —
  `realtime.changed` сущности `transaction`; `transactions.merged` — T-029.
- Инструменты (`agent/tools.ts`, набор `core`): `search_transactions` (`read`, ≤ 50 строк + `total`), `add_transaction`,
  `update_transaction` (`write` + `undoToken`, источник «ассистент»), `delete_transaction` (`destructive`: только
  решение). Агрегации (`aggregate_transactions`) — T-031.
- Отмена `transactions.restore { batchId }` (создание — удаляет, правка — возвращает «до», удаление — воссоздаёт с тем же
  `id`); подтверждение `transactions.delete { ids, channel }` — возвращает undoToken «Отменить» сразу после «Да».
- Задачи (`jobs/`): `transactions.fill-rates { ids }` (повторяемая `UNAVAILABLE`, пока НБРБ молчит),
  `transactions.categorize { ids }`.
- Таблицы (`userOwnedTable`, `user-data.ts`): `transactions` (счёт, тип и направление, день и время, сумма и валюта,
  сумма в BYN и id курса, исходное описание, контрагент и его ключ, комментарий, категория и источник, источник
  операции, видимость `personal`, пара перевода, исходная покупка, версия), `transaction_revisions` (пачка действия,
  действие, канал, состояние «до», версия после, поля; без FK на операцию — история удалённой остаётся). Составные FK
  на `accounts`, `categories`, `system_categories` и на себя — руками в миграции `*_transactions` (чужая схема модулю
  недоступна): счёт и своя категория — `RESTRICT`, пара и покупка — `SET NULL (колонка)`.
- Правила без БД (`domain/transactions.ts`): направление по типу, виды категорий, сдвиг остатков (`@kosht/calc`),
  изменённые поля.

## Зависимости
Можно: accounts, categories, merchants, fx-rates, actions, explain, notifications (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- Фасад без агрегатов пачками (метод «сумма по одной категории», который зовут в цикле) — нет: только `aggregate`.
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)`; «чьи» — только `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/transactions` — правила (`domain/transactions.test.ts`); сценарии на Postgres
  с настоящими accounts, actions, explain, merchants и categories (`application/__fixtures__/transactions-with-journal.ts`:
  курсы НБРБ — карта в памяти, шлюз моделей — шпион): `operations.int.test.ts` (ввод, правка, удаление, «Отменить»,
  валюта, счёт с операциями), `list.int.test.ts` (страницы, поиск, фильтры), `background.int.test.ts` (курс и модель в
  фоне), инструменты — `agent/tools.int.test.ts`; изоляция — `main/isolation.registry.int.test.ts`; удаление аккаунта —
  `main/account-deletion.int.test.ts`.
