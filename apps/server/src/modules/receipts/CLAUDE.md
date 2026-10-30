# Модуль `receipts`

Ярус 2 · таблицы: user · публикует: `receipts.recognized`, `receipts.needs-review`, `receipts.warranty-items-found` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Чеки: QR, распознавание, валидатор, перепроверка, дубли, правка, гарантийные позиции. Сделано: подготовка фото, QR и дубли,
извлечение моделью, арифметика (`calc`), перепроверка (T-027); учёт в операциях с разбивкой, карточка «Верно / Изменить /
Отменить», вкладка, уведомление, гарантия, инструменты агента (T-028); сопоставление с выпиской — T-029.

## Требования SPEC
RCPT-01…15, PRIV-04, SEC-11. Сделано: RCPT-01…15 (RCPT-10 — наличные и «ожидает выписки»; слияние с операцией банка — T-029).

## Публичный API (`index.ts`)
- Фабрика: `createReceiptsModule({ platform, facades })`; используются files, merchants, llm, explain, categories, transactions, notifications.
- `ReceiptsFacade`: `start(s, fileId)` → `{ id }` — чек «распознаётся» и задача `receipts.recognize` одной транзакцией.
- Контракт `contract.receipts.*` (authed): `start({ fileIds ≤ 10 })` (после `files.upload`, каждое фото — своя задача), `list`
  (новые сверху, ≤ 50), `get` (карточка: позиции с категориями, расхождения, история попыток, операция, `mns`, `traceId`),
  `confirm` («Верно»), `updateItems` («Изменить»: валидатор пересчитывает статус, операция и разбивка обновляются), `cancel`
  («Отменить»: чек, операция и фото удаляются сразу, без вопроса — как отмена черновика импорта). «Не вышло» (`failed`) подтвердить
  или править нельзя (`CONFLICT`); дубль — `duplicateOf { id, date "12.10" }`.
- Задача `receipts.recognize` (worker, `priority 10`, `retryLimit 0`, `jobKey(scope, receiptId)`, в нагрузке только id): ход — `realtime.progress`
  (сущность `receipt`: 10 → 30 → 60 → 100), этап и спорные строки — в записи (`stage`, `disputed_lines`: «Перепроверка строки 2…»).
- События: `receipts.recognized`, `receipts.needs-review`, `receipts.warranty-items-found` (RCPT-13: `electronics` или наименование
  прибора); уведомление `receipt-review` при «требует проверки». Инструменты (`reports`, `read`): `get_receipt`, `receipt_status`.
- Таблицы (`userOwnedTable`, `defineUserData`): `receipts` (статус, шапка, итог, оплата, УИ уникален в домохозяйстве, спорные
  строки, `remainder_minor`, `confirmed_at`, `trace_id`, код ошибки, `duplicate_of`), `receipt_items` (`normalized_name`, количество
  в тысячных, категория, `warranty`), `receipt_attempts`. Настройки: `tolerance-minor` (1), `max-rechecks` (2), `prepare-*`, `image-max-side`.

## Устройство
- `domain/`: `printed.ts`, `qr.ts`, `read-receipt.ts` (`readReceipt`, `checkReceipt` — те же валидатор и расхождения для чтения моделью и
  правки), `recheck.ts`, `warranty.ts`. `application/`: `receipt-extraction.ts` (подсказки, `PROMPT_VERSION`), `recognize.ts`, `review.ts`,
  `operation-plan.ts` (категории позиций, `splitByCategory` из calc, операция), `receipt-card.ts` (DTO), `ports.ts`. `infrastructure/image/`
  (`heic-decode`, `sharp`, `zxing-wasm` — только здесь, песочница `receipt-prepare.worker`), `infrastructure/db/`.
- `run`: фото → поток → УИ → дубль → модель → арифметика → перепроверка (≤ N) → магазин → дубль без QR → категории позиций (вне
  транзакции) → транзакция: чек, позиции, попытки, `explain.save`, `transactions.recordFromReceipt`, события, уведомление; после коммита — `transactions.matchReceipt` (TXN-10).

## Зависимости
Можно: files, transactions, categories, merchants, llm, actions, notifications, explain (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- Модель считает суммы или получает наименования в подсказке перепроверки; вызов модели и чтение файла внутри `s.transaction`;
  недоверенное фото вне песочницы; чужой модуль мимо `index.ts`; «чьи данные» не из `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/receipts`: `domain/*.test.ts`; фото на настоящих декодерах и бандл; весь путь на Postgres
  (`application/recognize.int.test.ts`: набор `datasets/receipts`, перепроверка, дубли, учёт в операциях, «Верно / Изменить / Отменить»).

## Подводные камни
- Формат QR настоящего чека не проверен: УИ — единственная группа из 24 символов, иначе дубль по магазину, дню, времени и итогу
  (одновременные чеки без QR оба сохранятся). Дубль и сбой — чек `failed` с `error_code`; повтор — загрузка заново.
- Чек не в BYN операции не получает. Модель на настоящих чеках не измерялась (`make eval`, QA-11).
