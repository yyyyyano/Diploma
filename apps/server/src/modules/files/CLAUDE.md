# Модуль `files`

Ярус 1 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Файлы домохозяйства: хранение `data/files/<householdId>/<fileId>`, выдача владельцу, удаление; владелец данных для
«Мои данные» и удаления аккаунта. Приём файлов (тип по содержимому, белый список, лимиты) — T-025: сейчас вид, имя
и тип файла задаёт код сервера (архив «Мои данные»).

## Требования SPEC
SEC-03, RCPT-11, STMT-10, PRIV-05/06. Сделано: хранение и выдача только владельцу (SEC-03, без приёма), PRIV-05/06.

## Публичный API (`index.ts`)
- Фабрика: `createFilesModule({ platform, facades })`; платформа — `Platform` (без `SystemDb`); соседей нет.
- Фасад `FilesFacade` (`application/files.ts`): `save(s, { kind, name, mime, content })` → `{ id, size }` (содержимое —
  `Uint8Array` или поток кусков `AsyncIterable`; порядок: id (`randomUUIDv7`) → файл в хранилище → строка; строка не
  записалась — файл удаляется), `open(s, id)` → метаданные + `blob` (чужой, несуществующий, потерянный на диске —
  `NOT_FOUND`), `remove(s, id)` (чужого нет — ничего). Типы `NewFile`, `OpenedFile`.
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
