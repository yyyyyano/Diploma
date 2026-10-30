# Экран `documents` — Чеки и документы (выписки)

Маршрут: `/documents` (`routes/_app/documents.tsx`) · доступ: пользователь (без сессии — `/login`). Пункт меню —
«Деньги → Чеки и документы».

## Макет
- Исходник: `design/screens/Documents.dc.html`; описание — `design/SCREENS.md` § «Чеки и документы».
- Состояния: `Documents--statement-preview`, `--empty`, `--error`, `--scan-checking`, `--scan-result`, `--receipt-panel` (блок чеков — `receipts/`).

## Требования SPEC
RCPT-01…08, RCPT-11, RCPT-12 (чеки), STMT-03 (загрузка), STMT-04 (предпросмотр, «Исправить колонки»), STMT-07 (дубли), STMT-11 (откат с подтверждением),
NFR-21 (ход разбора), P5 («Отменить»), AGT-07 («Да/Нет» для спорных переводов); состояния — DES-16; NFR-20.

## Данные (контракт)
- `orpc.statements.list` (loader — `prefetchQuery`), `get` (предпросмотр: итоги и первые строки считает сервер),
  `confirm`, `fixColumns`, `cancel`, `rollbackInfo`, `rollback`. Загрузка — `files.upload` (вид `statement`) → `statements.start`.
- Живые обновления: `events.stream` — сущность `statement-import` перезапрашивает `statements.*`; процент разбора —
  `progressQueryKey("statement-import", id)`.
- «Отменить» сразу после импорта — `UndoActionToast` (`actions.undo`); позже — «Откатить импорт» с окном, где названо
  число операций и правленных вручную; спорные переводы — `DecisionDialog` (`decisionId` из `confirm`).

## Чеки (`receipts/`, T-028)
- `ReceiptsSection`: карточка «Сканировать чек» (`<input accept="image/*,.heic" multiple>` без `capture`: на телефоне «Камера / Галерея»;
  перетаскивание; ≤ 10 фото), `files.upload` (вид `receipt-photo`) → `receipts.start`, список (`receipts.list`), три шага «Как Кошт не задваивает».
- `ReceiptCardView` (`receipts.get`): проверка по этапам (`Steps`: «Читаю чек» → «Проверяю арифметику» → «Перепроверка строки 2»; этап — из
  записи чека, живые сигналы — сущность `receipt`), результат с `ReceiptStatusBadge`, позиции с категориями и пометками спорных, «Верно» /
  «Изменить» (`ReceiptEditor`: ввод текстом → копейки и тысячные, статус пересчитывает сервер) / «Отменить» (подтверждение, удаляет чек, операцию
  и фото), фото (`/api/files/<id>`), «Проверить на сайте МНС» (ссылка `noopener`, УИ и день копируются; к МНС запросов нет), дубль «Этот чек уже загружен 12.10».
- Адрес: `?open=<id чека>` (из карточки операции и уведомления).

## Компоненты
Свои: `DocumentsPage` (`ImportItem`, `ImportPanel`, `ColumnsDialog`). Из `entities`: `category` (`CategoryBadge`), `action`, `receipt` (`ReceiptStatusBadge`, форматы).
Из `ui`: `Steps`, `StatusBadge`, `PageHeader`, `EmptyState`, `Money`, `ConfirmDialog`, `SkeletonCard`; Mantine `Modal`, `NativeSelect`.

## Переходы
Из карточки операции — `/documents?import=<id>` (STMT-10, `model/search.ts`): импорт открыт сразу. Операции импорта
видны в «Операциях»; чек открывается по `?open=` из карточки операции.

## Отличия от макета (с причиной)
- В подзаголовке предпросмотра нет имени файла и плашки «Способ разбора» — способ показан строкой примечаний
  (`preview.method.*`); имени исходного файла в `ImportSummary` нет.
- Стили — только объявленные токены (`ui/theme/css-vars.test.ts`): несуществующий `var(--…)` молча снимал рамки,
  скругления и приглушённый текст.
