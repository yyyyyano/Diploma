# Экран `operations` — Операции

Маршрут: `/operations` (`routes/_app/operations.tsx`, адрес — `model/search.ts`) · доступ: пользователь (пункт меню
«Деньги → Операции», место 2 на нижней панели телефона).

## Макет
- Исходник: `design/screens/Operations.dc.html`; описание — `design/SCREENS.md` § «Операции».
- Скриншоты: `design/screenshots/desktop/Operations.png`, `design/screenshots/mobile-width/Operations.png`.
- Состояния: `design/screenshots/states/Operations--{loading,empty,error,add-operation,operation-panel}.png`;
  `bulk-selection` — T-022.

## Требования SPEC
TXN-01…05, STMT-02 (остаток от операций), STMT-09 (эквивалент в BYN и курс), EXPL-01 (ⓘ у курса), P5 («Отменить»),
AGT-07 (удаление после «Да»); состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.transactions.list` (страница по 50 — компьютер; страницы подряд `infiniteOptions` — телефон),
  `transactions.get` (карточка: поля, `rate`, `history`), `accounts.list`, `categories.list`.
- Изменение: `create`, `update` → `UndoActionToast` (правка шлёт только изменённые поля и `expectedVersion`);
  `requestDelete` → `DecisionDialog` → «Да» отдаёт undoToken → «Операция удалена» с «Отменить»; `explainRate` →
  `ExplanationSheet` («Откуда курс?»).
- Адрес: `page`, `q`, `type`, `from`, `to`, `account`, `category` (`system:<код>` / `custom:<id>`), `min`, `max` (BYN
  текстом), `source`, `op` (открытая карточка). Контекст ассистента: `staticData.page = "operations"`.
- Живые обновления: `events.stream` (`transaction`, `account`, `category`) → перезапрос только своих запросов.

## Компоненты
Свои: `OperationsPage`, `OperationsToolbar` (поиск с паузой 300 мс, тип, категория, счёт, источник, период, сумма),
`OperationsTable`/`OperationsCards`, `OperationForm` (добавление и правка), `OperationPanel`. Из `entities`: `account`,
`category` (`CategoryPicker`, `CategoryBadge`), `transaction` (`TransactionAmount`), `action`, `explanation`. Из `ui`:
`PageHeader`, `Sheet`, `EmptyState`, `Money`, `WhyButton`, `StatusBadge`; Mantine `Modal`, `Pagination`.

## Переходы
Нет (из дашборда — `/operations?category=…`, T-033).

## Отличия от макета (с причиной)
- Телефон — список карточек и «Показать ещё», а не таблица с прокруткой (TXN-02, 390 px без горизонтальной прокрутки).
- Дата в строке — «21.10.2026» (с годом: список бывает за разные годы); история изменений — дата без времени (формата
  «чч:мм» для момента события в `@kosht/i18n` нет: пояс — `LocalDate.fromInstant`).
- Нет строки «Весь октябрь · Расходы · Доходы» (агрегации — T-031), флажков выбора и панели массовых действий (T-022),
  признаков «есть чек» и «регулярный» и фильтра «С чеком» (T-028, T-030), импорта в карточке (T-026), «Выгрузить в Excel»
  (T-051), позиций чека и парной операции ссылкой (T-028, T-029), кнопок «Загрузить выписку»/«Сканировать чек» в пустом
  состоянии (T-026, T-028): кусок без модуля скрыт (ARCHITECTURE §10.5).
- Поиск и фильтры — единственная панель (период, сумма, источник открыты сразу), а не «С чеком» и два списка.

## Готово, когда
`OperationsPage.test.tsx` (состояния, строки, валюта и «курс не получен», поиск и страница в адресе, телефон, ввод,
правка, карточка, «Откуда курс?», удаление после «Да») и `model/search.test.ts` зелёные; `make e2e` (`operations.spec.ts`)
— axe 0 на 1440 и 390 во всех состояниях, без горизонтальной прокрутки.
