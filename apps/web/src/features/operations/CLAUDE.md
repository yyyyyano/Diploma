# Экран `operations` — Операции

Маршрут: `/operations` (`routes/_app/operations.tsx`, адрес — `model/search.ts`) · доступ: пользователь (пункт меню
«Деньги → Операции», место 2 на нижней панели телефона).

## Макет
- Исходник: `design/screens/Operations.dc.html`; описание — `design/SCREENS.md` § «Операции».
- Скриншоты: `design/screenshots/desktop/Operations.png`, `design/screenshots/mobile-width/Operations.png`.
- Состояния: `design/screenshots/states/Operations--{loading,empty,error,add-operation,operation-panel,bulk-selection}.png`.

## Требования SPEC
TXN-01…05, CAT-05 (правило из исправления), STMT-02 (остаток от операций), STMT-09 (эквивалент в BYN и курс), EXPL-01 (ⓘ у курса), P5 («Отменить»),
AGT-07 (удаление после «Да»); состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.transactions.list` (страница по 50 — компьютер; страницы подряд `infiniteOptions` — телефон),
  `transactions.get` (карточка: поля, `rate`, `history`), `accounts.list`, `categories.list`.
- Изменение: `create`, `update` → `UndoActionToast` (правка шлёт только изменённые поля и `expectedVersion`);
  `requestDelete` → `DecisionDialog` → «Да» отдаёт undoToken → «Операция удалена» с «Отменить»; `explainRate` →
  `ExplanationSheet` («Откуда курс?»); массовые — `requestChangeCategory`, `requestMarkTransfer`, `requestDelete`
  (`ids`) → `DecisionDialog` («Да, перенести 13») → «Да» отдаёт undoToken → «Отменить» возвращает всё; смена категории
  в карточке отвечает `applyToPast` → вопрос «Да, применить к N» (CAT-05).
- Адрес: `page`, `q`, `type`, `from`, `to`, `account`, `category` (`system:<код>` / `custom:<id>`), `min`, `max` (BYN
  текстом), `source`, `op` (открытая карточка). Контекст ассистента: `staticData.page = "operations"`.
- Живые обновления: `events.stream` (`transaction`, `account`, `category`) → перезапрос только своих запросов.

## Компоненты
Свои: `OperationsPage`, `OperationsToolbar` (поиск с паузой 300 мс, тип, категория, счёт, источник, период, сумма),
`OperationsTable`/`OperationsCards` (с галочками), `BulkBar`, `BulkCategoryDialog`, `OperationForm`, `OperationPanel`. Из `entities`: `account`,
`category` (`CategoryPicker`, `CategoryBadge`), `transaction` (`TransactionAmount`), `action`, `explanation`. Из `ui`:
`PageHeader`, `Sheet`, `EmptyState`, `Money`, `WhyButton`, `StatusBadge`; Mantine `Modal`, `Pagination`.

## Переходы
Нет (из дашборда — `/operations?category=…`, T-033).

## Отличия от макета (с причиной)
- Телефон — список карточек и «Показать ещё», а не таблица с прокруткой (TXN-02, 390 px без горизонтальной прокрутки).
- Дата в строке — «21.10.2026» (с годом: список бывает за разные годы); история изменений — дата без времени (формата
  «чч:мм» для момента события в `@kosht/i18n` нет: пояс — `LocalDate.fromInstant`).
- Смена категории выбранным — два шага: окно выбора категории и «Продолжить», затем вопрос «Да/Нет» с текстом сервера
  (число, категория, примеры) и «Да, перенести 13»: вопрос — настоящее ожидающее решение `actions` (AGT-07), его
  создаёт сервер, а не окно. Выбор строк сбрасывается при смене фильтра или страницы (телефон — переживает «Показать ещё»).
- Нет строки «Весь октябрь · Расходы · Доходы» (агрегации — T-031), признаков «есть чек» и «регулярный» и фильтра «С чеком» (T-028, T-030), импорта в карточке (T-026), «Выгрузить в Excel»
  (T-051), позиций чека и парной операции ссылкой (T-028, T-029), кнопок «Загрузить выписку»/«Сканировать чек» в пустом
  состоянии (T-026, T-028): кусок без модуля скрыт (ARCHITECTURE §10.5).
- Поиск и фильтры — единственная панель (период, сумма, источник открыты сразу), а не «С чеком» и два списка.

## Готово, когда
`OperationsPage.test.tsx` (состояния, строки, валюта и «курс не получен», поиск и страница в адресе, телефон, ввод,
правка, карточка, «Откуда курс?», удаление после «Да»), `OperationsBulk.test.tsx` (выбор, удалить, пометить переводом,
сменить категорию, правило) и `model/search.test.ts` зелёные; `make e2e` (`operations.spec.ts`) — axe 0 на 1440 и 390
во всех состояниях, в том числе с выбранными строками и открытым вопросом, без горизонтальной прокрутки.
