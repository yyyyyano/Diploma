# Модуль `receipts`

Ярус 2 · таблицы: user · публикует: `receipts.recognized`, `receipts.needs-review`, `receipts.warranty-items-found` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Чеки: QR, распознавание, валидатор, перепроверка, дубли, правка, гарантийные позиции. Сделано (T-027): подготовка фото, QR и
дубли, извлечение моделью, арифметика (`calc`), перепроверка, позиции и история попыток. Загрузка, учёт, карточка, правка — T-028.

## Требования SPEC
RCPT-01…15, PRIV-04, SEC-11. Сделано: RCPT-03…07, RCPT-14, RCPT-15 (+ фото в потоке: RCPT-01, форматы).

## Публичный API (`index.ts`)
- Фабрика: `createReceiptsModule({ platform, facades })` (`Platform`); используются files, merchants, llm, explain.
- `ReceiptsFacade`: `start(s, fileId)` → `{ id }` — чек «распознаётся» и задача `receipts.recognize` одной транзакцией (файл
  вида `receipt-photo`, иначе `VALIDATION`). Загрузка и экран зовут её в T-028.
- Задача `receipts.recognize` (worker, `priority 10`, `retryLimit 0`, ключ схлопывания `jobKey(scope, receiptId)`; в нагрузке
  только `receiptId`): ход — `realtime.progress` (сущность `receipt`: 10 → 30 → 60 → 100), этап и спорные строки — в самой
  записи (`stage`: `reading | checking | rechecking`, `disputed_lines`) — по ним карточка пишет «Перепроверка строки 2…».
- События (`events.ts`): `receipts.recognized` (чек сохранён — «сходится» или «требует проверки»), `receipts.needs-review`
  (расхождение осталось); нагрузка — id. `receipts.warranty-items-found` — T-028.
- Таблицы (`userOwnedTable`, `defineUserData`): `receipts` (статус `processing | ok | needs-review | failed`, шапка, итог,
  оплата, УИ — уникален в домохозяйстве, спорные строки, `remainder_minor`, число перепроверок, `trace_id`, код ошибки и
  `duplicate_of`), `receipt_items` (позиции с `normalized_name`, количество в тысячных, спорная пометка),
  `receipt_attempts` (0 — первичное чтение, дальше перепроверки: что спрашивали, что изменилось, что осталось).
- Настройки: `tolerance-minor` (1 = 0,01 BYN), `max-rechecks` (2), `prepare-timeout-ms`, `prepare-memory-mb`, `image-max-side`.
  Ошибки каталога: `RECEIPT_DUPLICATE` (параметр `date` строит читающий по `createdAt` первого чека), `RECEIPT_UNREADABLE`.

## Устройство
- `domain/`: `printed.ts` (числа, даты, время с чека текстом → копейки, тысячные, день), `qr.ts` (УИ из QR), `read-receipt.ts`
  (напечатанное → числа → `validateReceipt` из `@kosht/calc` → расхождения; описание для перепроверки — только цифры),
  `recheck.ts` (ответ перепроверки вливается только в названные места, наименования не меняются).
- `application/receipt-extraction.ts` (схема ответа, подсказки, `PROMPT_VERSION` = `receipt-extract-v1`,
  `receipt-recheck-v1`), `recognize.ts` (`start`, `run`), `ports.ts` (`PhotoPreparer`).
- `infrastructure/image/`: `prepare.worker.ts` (песочница `platform/sandbox`, точка входа tsdown `receipt-prepare.worker`:
  `heic-decode`, `sharp`, `zxing-wasm` с локальным `.wasm`), `prepare-photo.ts` (адаптер); `infrastructure/db/` — схема, репозиторий.
- Порядок `run`: фото → поток (HEIC, поворот, копия без метаданных, QR) → УИ → дубль → модель (`receipt.extract`) → арифметика →
  перепроверка (≤ `max-rechecks`) → магазин → дубль без QR (магазин + день + время + итог) → транзакция: чек, позиции,
  попытки, `explain.save`, события.

## Зависимости
Можно: files, transactions, categories, merchants, llm, actions, notifications, explain (`tooling/architecture/modules.ts`). Слушает: —.
`heic-decode`, `zxing-wasm`, `sharp` — только `infrastructure/image`.

## Запреты
- Модель считает или «подгоняет» суммы; наименование с чека в подсказке перепроверки (только цифры и номера строк); вызов
  модели и чтение файла внутри `s.transaction`; недоверенное фото вне песочницы; чужой модуль мимо `index.ts`; «чьи данные» не из `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/receipts`: `domain/*.test.ts`; подготовка фото на настоящих декодерах и бандл
  (`infrastructure/image/*.test.ts`); весь путь на Postgres (`application/recognize.int.test.ts`): набор
  `datasets/receipts` (`make synth-receipts`), перепроверка, дубли, приказы на чеке, сбои; модель — двойник `extract`.

## Подводные камни
- Формат содержимого QR настоящего чека не проверен (образца нет): УИ — единственная группа из 24 букв и цифр; иначе дубль
  по магазину, дню, времени и итогу. Два одинаковых чека без QR, загруженных одновременно, оба сохранятся (индекса на ключ нет:
  правка чека меняла бы итог).
- Дубль — чек со статусом `failed`, `error_code = RECEIPT_DUPLICATE` и `duplicate_of`; УИ у него пуст. Сбой чтения и модели
  — `failed` с кодом (`UNAVAILABLE`, `INTERNAL`…), повторить — загрузить фото заново. Сбой на перепроверке чек не теряет.
- Не прочитанный итог заменяется расчётным (с пометкой); нечитаемая строка уходит в «нераспознанный остаток».
- Качество чтения на настоящей модели не измерено (`make eval`, QA-11): тесты — на сценарном двойнике.
