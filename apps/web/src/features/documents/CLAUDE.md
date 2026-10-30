# Экран `documents` — Чеки и документы (выписки)

Маршрут: `/documents` (`routes/_app/documents.tsx`) · доступ: пользователь (без сессии — `/login`). Пункт меню —
«Деньги → Чеки и документы».

## Макет
- Исходник: `design/screens/Documents.dc.html`; описание — `design/SCREENS.md` § «Чеки и документы».
- Состояния: `Documents--statement-preview`, `--empty`, `--error`. Блок чеков скрыт до T-028.

## Требования SPEC
STMT-03 (загрузка), STMT-04 (предпросмотр, «Исправить колонки»), STMT-07 (дубли), STMT-11 (откат с подтверждением),
NFR-21 (ход разбора), P5 («Отменить»), AGT-07 («Да/Нет» для спорных переводов); состояния — DES-16; NFR-20.

## Данные (контракт)
- `orpc.statements.list` (loader — `prefetchQuery`), `get` (предпросмотр: итоги и первые строки считает сервер),
  `confirm`, `fixColumns`, `cancel`, `rollbackInfo`, `rollback`. Загрузка — `files.upload` (вид `statement`) → `statements.start`.
- Живые обновления: `events.stream` — сущность `statement-import` перезапрашивает `statements.*`; процент разбора —
  `progressQueryKey("statement-import", id)`.
- «Отменить» сразу после импорта — `UndoActionToast` (`actions.undo`); позже — «Откатить импорт» с окном, где названо
  число операций и правленных вручную; спорные переводы — `DecisionDialog` (`decisionId` из `confirm`).

## Компоненты
Свои: `DocumentsPage` (`ImportItem`, `ImportPanel`, `ColumnsDialog`). Из `entities`: `category` (`CategoryBadge`), `action`.
Из `ui`: `PageHeader`, `EmptyState`, `Money`, `ConfirmDialog`, `SkeletonCard`; Mantine `Modal`, `NativeSelect`.

## Переходы
Из карточки операции — `/documents?import=<id>` (STMT-10, `model/search.ts`): импорт открыт сразу. Операции импорта
видны в «Операциях»; карточка чека — T-028.

## Отличия от макета (с причиной)
- В подзаголовке предпросмотра нет имени файла и плашки «Способ разбора» — способ показан строкой примечаний
  (`preview.method.*`); имени исходного файла в `ImportSummary` нет.
- Стили — только объявленные токены (`ui/theme/css-vars.test.ts`): несуществующий `var(--…)` молча снимал рамки,
  скругления и приглушённый текст.
