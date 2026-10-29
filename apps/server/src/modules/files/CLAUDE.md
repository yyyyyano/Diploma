# Модуль `files`

Ярус 1 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Файлы домохозяйства: приём (тип по содержимому, белый список, лимиты), хранение `data/files/<householdId>/<fileId>`,
выдача владельцу, удаление; владелец данных для «Мои данные» и удаления аккаунта.

## Требования SPEC
SEC-03 (приём и выдача), STMT-03, RCPT-01 (приём), RCPT-11, STMT-10, PRIV-05/06.

## Публичный API (`index.ts`)
- Фабрика: `createFilesModule({ platform, facades })`; платформа — `Platform` (без `SystemDb`); соседей нет.
- Фасад `FilesFacade` (`application/files.ts`): `save(s, { kind, name, mime, content })` → `{ id, size }` (содержимое —
  `Uint8Array` или поток кусков `AsyncIterable`; порядок: id (`randomUUIDv7`) → файл в хранилище → строка; строка не
  записалась — файл удаляется), `open(s, id)` → метаданные + `blob` (чужой, несуществующий, потерянный на диске —
  `NOT_FOUND`), `remove(s, id)` (чужого нет — ничего). Типы `NewFile`, `OpenedFile`.
- Приём (`application/accept-upload.ts`, фасад `accept(s, kind, uploads)` → `[{ id, name, mime, size }]`; контракт
  `contract.files.upload`, authed, `POST /api/files`, multipart: `kind` (`receipt-photo | statement`) и `files[0]`, `files[1]`…):
  тип по содержимому (`file-type`, `infrastructure/sniff`) + белый список вида (`domain/file-policy.ts`: фото — JPEG,
  PNG, WebP, HEIC; выписка — PDF, XLSX, XLS, CSV (текст без сигнатуры), скан-фото); расширение имени, не
  подходящее найденному типу, — `FILE_TYPE_NOT_ALLOWED`; размер вида (`FILES_MAX_PHOTO_BYTES` 15 МБ,
  `FILES_MAX_STATEMENT_BYTES` 25 МБ) — `FILE_TOO_LARGE`; файлов за раз (`FILES_MAX_PER_UPLOAD`, 10) —
  `TOO_MANY_FILES`; все проверяются до сохранения первого. В хранилище — тип по содержимому, не заявленный клиентом.
  Тело запроса ограничивает Hono до чтения: `http.upload-body-limit-bytes` (`platform/http/body-limit.ts`).
- Контракт `contract.files.download` (authed, `GET /api/files/{id}`): сам файл, `Content-Disposition: attachment`
  (ASCII-имя + `filename*`), тип — из метаданных; сайт скачивает обычной ссылкой.
- Имя файла — только метаданные: `domain/file-name.ts` (`safeFileName`: без каталогов, управляющих и запрещённых
  знаков, ≤ 120 символов с расширением); путь строит `BlobStore` из `householdId` scope и id.
- Таблица `files` (`userOwnedTable`): `kind` (`data-export | receipt-photo | statement`), `name`, `mime`, `size`.
- Владелец данных (`user-data.ts`): строки `files` выгружает и удаляет privacy; хук `export` отдаёт в архив исходные
  файлы «`<id>-<имя>`» как `Blob` (читаются потоком при записи архива; кроме прежних архивов `data-export`),
  `afterDelete` удаляет весь каталог домохозяйства. Архив «Мои данные» сохраняет privacy через `save` (поток кусков).

## Зависимости
Можно: — (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- Имя и путь из запроса в хранилище не попадают: вход процедуры — только uuid файла, его строка ищется через `s`.
- Выдача — только `attachment`: тип файла пришёл не от сервера, показывать его на странице сайта нельзя.
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(files)`; «чьи данные» — только `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/files` — имя файла (`domain/file-name.test.ts`), сохранение, поток, чужой id,
  откат при ошибке строки, архив и каталог (`application/files.int.test.ts`); сквозь HTTP — `main/files.int.test.ts`.
