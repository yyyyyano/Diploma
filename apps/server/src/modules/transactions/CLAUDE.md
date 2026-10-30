# Модуль `transactions`

Ярус 2 · таблицы: user · публикует: `transactions.changed`, `transactions.merged` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Операции, переводы и возвраты, сопоставление чек ↔ выписка, массовые действия, агрегации пачками; остаток счёта
пересчитывает фасад `accounts` (STMT-02). Сделано: таблица, ввод, правка и удаление с «Отменить», карточка, массовые действия, запись выписки, операция от чека (T-028), сопоставление чека и выписки (T-029).

## Требования SPEC
TXN-01…11, FIN-01, STMT-02/09, STMT-07/08 (запись), CAT-05 (применить к прошлым).
## Публичный API (`index.ts`)
- Фабрика: `createTransactionsModule({ platform, facades })`. Фасад (`statements`): `importBatch(tx, { importId, rows })` (`importId` есть и в DTO операции, STMT-10) — выписка
  пачкой (`import_id`, `external_id`, `dedupe_key`; пара перевода, «Наличные» для снятия, покупка возврата; одно
  `transactions.changed`), `deleteImport`, `knownKeys`, `transferCandidates`, `purchaseCandidates`, `countEditedInImport`,
  `requestMarkTransfer`; чеки (`application/receipt-ops.ts`): `recordFromReceipt(tx, …)` (наличные — со счёта «Наличные»; карта — `pending`
  на счёте по цифрам или «Карта, не указана», остаток не меняет; `transaction_splits` — разбивка по категориям), `updateFromReceipt`,
  `setReceiptReviewed`, `removeForReceipt` (слитую с банковской только отвязывает), `operationOfReceipt`. Сопоставление (`application/match.ts`,
  TXN-10/11): `matchReceipt(s, receiptId)` и `matchBankOps(s, ids)` — кандидат: расход выписки на ту же сумму (допуск), окно ±2 дня; один
  уверенный (контрагент справочника или похожее название) — связь сама + уведомление `receipt-match` с «Это разные покупки», иначе один
  вопрос «одна покупка?» (`actions`, `MATCH_HANDLER`); `linkReceipt`/`unlinkReceipt` (контракт, с «Отменить»). Слитая операция хранит снимок чека
  (`merged_receipt`, и прежние категорию и разбивку операции выписки): разрыв возвращает чек и операцию выписки как были; `match_declined` — пары, которые не предлагают снова. Настройки `match-*`. Агрегаты — T-031.
- Контракт `contract.transactions.*` (authed, канал отмены — web, источник — «вручную»): `list` (страница + размер ≤ 100
  + `total`; фильтры — период, счёт, категория, тип, сумма в BYN, источник, текст, `hasReceipt`, `needsReview`; сортировка день → время → `id`),
  `get` (карточка: `rate`, `history`), `create`/`update` (→ `{ transaction, undoToken, applyToPast }`), `requestDelete`, `requestChangeCategory`,
  `requestMarkTransfer` (`ids` → `{ decisionId }`), `explainRate` (→ `traceId`; курса нет — `UNAVAILABLE`).
- Сценарии — файлы `application/`: `read`, `write`, `remove`, `restore` («Отменить»), `bulk` («Да»), `rule`, `background`
  (курс, модель), `receipt-ops`; общее — `ledger` (ревизии, остатки без `pending`, событие), `prepare`, `handlers`.
- Запись: валюта — валюта счёта (иное `VALIDATION`), счёт не указан — «Наличные»; расход уводит деньги со счёта, доход и
  возврат приводят; категория — выбрана (`user`), иначе `categories.byRules`, непокрытое — «Прочее» (`fallback`) и задача
  `categorize`; BYN — `fxRates.convert` до транзакции (нет курса — `amountInByn: null`, задача `fill-rates`); остаток — `accounts`.
- Версия растёт с каждой правкой человека; `expectedVersion` и «Отменить» сверяют её (`CONFLICT`); фон версию не трогает
  (канал `system`). События: `transactions.changed { ids }` — пачка действия, в его транзакции; `transactions.merged { ids }` — слияние.
- Инструменты (`agent/tools.ts`, набор `core`): `search_transactions` (`read`, ≤ 50 строк + `total`), `add_transaction`,
  `update_transaction` (`write` + `undoToken`, источник «ассистент»), `bulk_change_category`, `delete_transaction`
  (`destructive`: только решение). Входы плоские (id — 36 знаков, день «ГГГГ-ММ-ДД», копейки): префикс агента ≤ 3 000
  токенов (`agent-prefix.int.test.ts`, сейчас 2 768), строгий разбор — в `execute`; категорию выбирает сервер.
- Отмена `transactions.restore { batchId, rule? }` (создание — удаляет, правка — возвращает «до», удаление — воссоздаёт
  с тем же `id`; пачку, которую правили позже, — `CONFLICT`); подтверждения (`handlers.ts`): `delete`, `bulk-category`,
  `bulk-transfer`, `apply-rule`, `match` — каждое отдаёт undoToken «Отменить» сразу после «Да». CAT-05: ручная смена категории
  (`user`) у операции с контрагентом пишет правило (`categories.setUserRule`, «Отменить» возвращает прежнее) и предлагает
  `applyToPast`. Задачи (`jobs/`): `fill-rates` (повторяемая `UNAVAILABLE`), `categorize`.
- Таблицы (`userOwnedTable`, `user-data.ts`): `transactions` (счёт, тип, направление, день и время, сумма и валюта, BYN и
  id курса, описание, контрагент и ключ, категория и источник, источник операции, пара, покупка, `receipt_id`, `pending`,
  `needs_review`, версия), `transaction_revisions` (пачка, действие, канал, состояние «до»; без FK) и `transaction_splits`
  (категория и сумма, сумма частей = сумме операции). Составные FK — руками в миграциях: счёт и категория `RESTRICT`, пара и
  покупка `SET NULL (колонка)`; `import_id` и `receipt_id` без FK.

## Зависимости
Можно: accounts, categories, merchants, fx-rates, actions, explain, notifications (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- Фасад без агрегатов пачками («сумма по одной категории» в цикле) — только `aggregate`; поиск кандидатов и справочник внутри `s.transaction`.
- В чужой модуль — только через его `index.ts`, из «Можно»; наверх — событием (ADR-0004). Данные — только через
  `s: ScopedDb` с `s.own(таблица)`, «чьи» — только `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/transactions` — правила (`domain/`); сценарии на Postgres с настоящими
  accounts, actions, explain, merchants и categories (`main/__fixtures__/transactions-with-journal.ts`: курсы НБРБ — карта
  в памяти, шлюз моделей — шпион): `operations`, `list`, `bulk`, `background`, `agent/tools`; изоляция —
  `main/isolation.registry.int.test.ts`; выписка — `import-batch.int.test.ts`. «Страница 50 строк ≤ 150 мс p95» — `make bench`.
