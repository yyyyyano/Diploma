<!--
Шаблон паспорта экрана (фичи) сайта: apps/web/src/features/<id>/CLAUDE.md.
Паспорт ≤ 30 строк. Создаётся в задаче экрана (или коротко в бетонной фазе), обновляется в том же коммите, что меняет
поведение, процедуры, переходы или отличия от макета. Внешний вид — по макету, поведение — по SPEC (DES-00).
Пример заполнения — operations; строки в <угловых скобках> заменить.
-->
# Экран `<id>` — <название по-русски, как в меню>

Маршрут: `<путь, например /operations>` (`routes/_app/<файл>.tsx`) · доступ: <гость | пользователь | только localhost | админ>

## Макет
- Исходник: `design/screens/<Экран>.dc.html`; описание — `design/SCREENS.md` § «<Экран>».
- Скриншоты: `design/screenshots/desktop/<Экран>.png`, `design/screenshots/mobile-width/<Экран>.png`
  <(+ `design/screenshots/phone/<…>.png`)>.
- Состояния: `design/screenshots/states/<Экран>--<состояние>.png` — <loading, empty, error, add-operation, …>.

## Требования SPEC
<TXN-01…05, TXN-10/11, CAT-03, CAT-05, STMT-06, STMT-09, XLS-01>; состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.<модуль>.<процедура>` — <что показывает>.
- Изменение: `orpc.<модуль>.<процедура>` — <одиночное → UndoToast | массовое/удаление → ConfirmDialog>.
- Адрес (`model/search.ts`): <period, account, category, type, q, sort, open>. Контекст ассистента: `staticData.page = "<id>"`.
- Живые обновления: `events.stream` → инвалидация <каких запросов>.

## Компоненты
Свои: <OperationsTable, FiltersBar, BulkActionsBar, AddOperationModal>. Из `entities`: <transaction, category,
receipt, explanation>. Из `ui`: <Money, WhyButton, StatusBadge, EmptyState, Skeletons, Sheet, ConfirmDialog, UndoToast>.

## Переходы
<Клик по чеку → панель чека; «Спросить ассистента» → `assistant-bridge` с контекстом; из дашборда — `/operations?category=…`.>

## Отличия от макета (с причиной)
- <— | что изменено и почему; ссылка на требование SPEC, которое важнее макета.>

## Готово, когда
Тесты состояний (загрузка, пусто, ошибка, успех) зелёные; `make e2e` — axe 0 нарушений на 1440 и 390, без
горизонтальной прокрутки; скриншоты сверены с макетом.
