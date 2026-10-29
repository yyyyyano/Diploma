# Модуль `statements`

Ярус 2 · таблицы: user · публикует: `statements.imported`, `statements.rolled-back` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Импорт: чтение PDF/XLSX/XLS/CSV/сканов, определение колонок, запоминание формата, дубли, типы, предпросмотр, откат.
Сделано (T-025): разбор файла в `ParsedStatement`, колонки, сверка остатков, запоминание формата. Дубли, типы, предпросмотр,
задача `statements.parse`, импорт и откат — T-026.

## Требования SPEC
STMT-03…12, SEC-03, SEC-10/11 (документы). Сделано: STMT-04, STMT-05, STMT-12.

## Публичный API (`index.ts`)
- Фабрика: `createStatementsModule({ platform, facades })` (`Platform`, без `SystemDb`); фасады — `files`, `accounts`,
  `transactions`, `categories`, `merchants`, `fxRates`, `llm`, `actions`, `notifications`.
- `StatementsFacade`: `parseStatement(s, fileId)` → `ParsedStatement` (файл открывает `files`, тип — по сохранённому mime),
  `parseBytes(s, { type, bytes })`, `rememberFormat(s, parsed)` → запомнено ли (скан формата не имеет; вызывает T-026 после
  успешного импорта). Ошибки: `STATEMENT_UNREADABLE` (нечитаемый, таймаут, «бомба», не из белого списка).
- `ParsedStatement` (`domain/types.ts`): строки (`date`, `time?`, `description`, `amount` со стороны счёта, `original?`,
  `balance?`), банк, маска, валюта, период, остатки на начало/конец, `method: remembered | detected | model`, `fingerprint`,
  `schema`, `sourceKind` (`csv | xlsx | xls | pdf | scan`), `formatChanged`, `balance { status ok | mismatch | unknown,
  difference?, trace? }`, `warnings` (`currency-assumed`, `rows-skipped`).
- События, роутер, задачи, откат — T-026. Таблица `statement_formats` (`userOwnedTable`, в `defineUserData`): отпечаток
  (sha256 вида файла и названий колонок), схема (роли колонок, порядок дат, десятичные разделители), банк, счётчик.
- Настройки: `statements.parse-timeout-ms` (60 с), `statements.parse-memory-mb` (512), `statements.columns-sample-rows` (8).

## Устройство
- `infrastructure/parsing/`: `parse.worker.ts` (рабочий файл песочницы `platform/sandbox`; точка входа tsdown
  `statement-parse.worker`), `read-csv.ts` (BOM → строгий utf-8 → windows-1251; `papaparse`), `read-sheet.ts` (SheetJS CE из
  `vendor/`), `read-pdf.ts` (`unpdf`: слова → ячейки с координатами; без текстового слоя — картинки `extractImages` + `sharp`),
  `zip-guard.ts` (ZIP-бомбы до SheetJS), `read-document.ts` (адаптер порта `DocumentReader`).
- `domain/`: `structure.ts` (шапка по словарю и по форме, PDF по координатам), `column-roles.ts` (словарь заголовков),
  `detect-columns.ts`, `extract-rows.ts` (расход/приход со знаком, перенос описания), `values.ts` (суммы, даты), `preamble.ts`,
  `balance.ts` (цепочка остатков через `@kosht/calc`), `fragment.ts` (фрагмент для модели).
- `application/parse-statement.ts`: запомненный формат → словарь → модель (`statement.columns`, только смысл колонок);
  скан — `statement.scan` (суммы и даты разбирает код, ошибки ловит сверка остатков). Подсказки — `*-extraction.ts`.

## Зависимости
Можно: files, accounts, transactions, categories, merchants, fx-rates, llm, actions, notifications. Слушает: —.
Библиотеки `unpdf`, `xlsx`, `papaparse` — только `infrastructure` (правило `document-parsers-only-in-statements-infrastructure`).

## Запреты
- Модель разбирает строки выписки или считает суммы; текст документа в инструкциях модели (только `document`); вызов модели и
  чтение файла внутри `s.transaction`; чтение недоверенного файла вне песочницы.
- В чужой модуль — только через `index.ts`; «чьи данные» — только `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/statements`: чистые правила (`domain/*.test.ts`), чтение файлов в потоке и из бандла
  (`infrastructure/parsing/*.test.ts`), весь набор `datasets/statements` на Postgres (`application/parse-statement.int.test.ts`);
  сквозь корень композиции — `main/statements.int.test.ts`. Модель в тестах — сценарный двойник `scripted-llm.ts`.

## Подводные камни
- Многострочная шапка таблицы в PDF не выравнивается по словарю — колонки определит модель; PDF без шапки нечитаем.
- Сканы в облако уходят как есть (R50); качество чтения модели не проверено (`make eval`).
