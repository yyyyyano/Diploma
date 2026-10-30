# Модуль `statements`

Ярус 2 · таблицы: user · публикует: `statements.imported`, `statements.rolled-back` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Импорт: чтение PDF/XLSX/XLS/CSV/сканов, определение колонок, запоминание формата, дубли, типы, предпросмотр, откат.
Сделано: разбор файла в `ParsedStatement`, колонки, сверка остатков, запоминание формата (T-025); дубли, типы, предпросмотр,
импорт одной транзакцией, откат, «Исправить колонки», черновики и вкладка выписок (T-026).

## Требования SPEC
STMT-03…12, SEC-03, SEC-10/11 (документы). Сделано: STMT-03…STMT-12 (дубли, типы, откат, остатки).

## Публичный API (`index.ts`)
- Фабрика: `createStatementsModule({ platform, facades })` (`Platform`); фасады — files, accounts, transactions, categories,
  merchants, fxRates, llm, actions, notifications.
- `StatementsFacade`: `parseStatement(s, fileId)` → `ParsedStatement` (файл открывает `files`, тип — по сохранённому mime),
  `parseBytes(s, { type, bytes })`, `rememberFormat(s, parsed)` → запомнено ли (скан формата не имеет; вызывает T-026 после
  успешного импорта). Ошибки: `STATEMENT_UNREADABLE` (нечитаемый, таймаут, «бомба», не из белого списка).
- `ParsedStatement` (`domain/types.ts`): строки (`date`, `time?`, `description`, `amount` со стороны счёта, `original?`,
  `balance?`), банк, маска, валюта, период, остатки, `method: remembered | detected | model`, `fingerprint`, `schema`, `sample`,
  `sourceKind` (`csv | xlsx | xls | pdf | scan`), `formatChanged`, `balance { status ok | mismatch | unknown, difference?,
  trace? }`, `warnings` (`currency-assumed`, `rows-skipped`).
- Импорт (`application/imports.ts`, фасад): `start(s, fileId)` → черновик + задача `statements.parse` (worker; прогресс —
  `realtime.progress`, сущность `statement-import`), `get`, `list`, `fixColumns`, `cancel`, `confirm` (одна транзакция: счёт по
  банку + маске + валюте, `transactions.importBatch`, остаток с днём `accounts.setStatementBalance`, `rememberFormat`,
  `actions.record` отката, `statements.imported`, одно уведомление `statement-imported`, пакет спорных переводов «Да/Нет»),
  `rollbackInfo` (сколько операций и правленных вручную), `requestRollback` (undo `statements.rollback`: операции импорта
  удаляются, поправка остатка снимается), `discard` (обход `discard-drafts.sweep.ts` раз в сутки, TTL — настройка).
- Предпросмотр (`build-preview.ts`): тип STMT-08 (`domain/classify.ts`), контрагент (`merchants`), категория (правила → модель
  пачками, вне транзакции), BYN по курсу НБРБ на день операции, дубли STMT-07 (`domain/dedupe.ts`: ключ с порядковым
  номером, банковский id), пары переводов и покупки возвратов; числа — `domain/preview.ts`. Контракт `contract.statements.*`,
  инструмент `statement_import_status` (`read`).
- Таблицы (`userOwnedTable`, `defineUserData`): `statement_formats` (отпечаток, схема, банк, счётчик) и `statement_imports`
  (статус, итоги, `payload` предпросмотра — очищается после импорта, поправка остатка, токен отката).
- Настройки: `parse-timeout-ms` (60 с), `parse-memory-mb` (512), `columns-sample-rows` (8), `transfer-window-days` (3), `refund-window-days` (60), `draft-ttl-days` (7), `preview-rows` (5).

## Устройство
- `infrastructure/parsing/`: `parse.worker.ts` (рабочий файл песочницы `platform/sandbox`; точка входа tsdown
  `statement-parse.worker`), `read-csv.ts` (BOM → строгий utf-8 → windows-1251; `papaparse`), `read-sheet.ts` (SheetJS CE из
  `vendor/`), `read-pdf.ts` (`unpdf`: слова → ячейки с координатами; без текстового слоя — картинки `extractImages` + `sharp`),
  `zip-guard.ts` (ZIP-бомбы до SheetJS), `read-document.ts` (адаптер порта `DocumentReader`).
- `domain/`: `structure.ts`, `column-roles.ts`, `detect-columns.ts`, `extract-rows.ts`, `values.ts`, `preamble.ts`, `balance.ts`
  (цепочка остатков через `@kosht/calc`), `fragment.ts` (фрагмент для модели), `classify.ts`, `dedupe.ts`, `preview.ts`.
- `application/parse-statement.ts` (+ `ParseOptions.columns` — роли человека): запомненный формат → словарь → модель (`statement.columns`, только смысл колонок);
  скан — `statement.scan` (суммы и даты разбирает код, ошибки ловит сверка остатков). Подсказки — `*-extraction.ts`.

## Зависимости
Можно: files, accounts, transactions, categories, merchants, fx-rates, llm, actions, notifications (`tooling/architecture/modules.ts`). Слушает: —.
`unpdf`, `xlsx`, `papaparse` — только `infrastructure` (`document-parsers-only-in-statements-infrastructure`).

## Запреты
- Модель разбирает строки выписки или считает суммы; текст документа в инструкциях модели (только `document`); вызов модели и
  чтение файла внутри `s.transaction`; недоверенный файл вне песочницы; чужой модуль мимо `index.ts`; «чьи данные» не из `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/statements`: `domain/*.test.ts`, чтение файлов и бандл (`infrastructure/parsing/`), набор
  `datasets/statements` и полный путь импорта на Postgres (`application/*.int.test.ts`); API — `main/statement*.int.test.ts`.

## Подводные камни
- PDF: многострочная шапка таблицы не выравнивается по словарю (колонки определит модель), без шапки — нечитаем; сканы уходят в облако как есть (R50), качество не проверено (`make eval`).
