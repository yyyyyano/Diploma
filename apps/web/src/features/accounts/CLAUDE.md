# Экран `accounts` — Счета

Маршрут: `/accounts` (`routes/_app/accounts.tsx`) · доступ: пользователь (без сессии — `/login`). Пункт меню —
«Деньги → Счета».

## Макет
- Исходник: `design/screens/Accounts.dc.html`; описание — `design/SCREENS.md` § «Счета».
- Скриншоты: `design/screenshots/desktop/Accounts.png`, `design/screenshots/mobile-width/Accounts.png`.
- Состояния: `design/screenshots/states/Accounts--add-account.png` (окно «Новый счёт»).

## Требования SPEC
STMT-01 (счета, «Наличные», начальный остаток), STMT-02 (день остатка — всегда), STMT-09 (эквивалент в BYN по курсу
НБРБ), EXPL-01 (ⓘ у каждой суммы), P5 («Отменить»), AGT-07 (удаление после «Да»); состояния — DES-16; NFR-20.

## Данные (контракт)
- Чтение: `orpc.accounts.list` — `{ onDate, items, totals }`; `loader` — `prefetchQuery`. Контекст ассистента:
  `staticData.page = "accounts"`.
- Изменение: `create`, `rename`, `setInitialBalance` → `UndoActionToast`; `requestDelete` → `DecisionDialog`
  (`actions.answer`); «Отменить» отменённого позже — «уже изменили».
- ⓘ: `accounts.explain({ subject })` сохраняет расчёт → `ExplanationSheet` по `traceId` (курс НБРБ — в основаниях).
- Живые обновления: `events.stream` (`account`) → перезапрос.

## Компоненты
Свои: `AccountsPage` (`AccountMenu`, `AddAccountForm`, `RenameForm`, `InitialForm`, `HowBalances`). Из `entities`:
`account` (`AccountCard`, `useAccountName`), `action`, `explanation`. Из `ui`: `PageHeader`, `StatCard`, `Money`,
`WhyButton`, `EmptyState`, `SkeletonCard`; Mantine `Modal`, `Menu`, `SegmentedControl`, `Select`.

## Переходы
Нет (операции счёта — T-021).

## Отличия от макета (с причиной)
- Нет карточки «Валюта» (сумма по валюте): эквивалент в BYN с ⓘ — на карточке каждого валютного счёта, а суммы по
  валютам сервер пока не отдаёт (сайт денег не складывает, P1).
- Нет графика остатка, числа операций, «Последняя выписка/операция», цели на накопительном и пункта «Операции счёта»:
  данные — T-021 (операции), T-026 (выписки), T-032 (цели); кусок без модуля скрыт (ARCHITECTURE §10.5).
- В окне начального остатка нет «На дату»: начальный остаток сдвигает текущий остаток, день остатка ставит сервер.
- «Карта, не указана» появляется, когда понадобится чеку (RCPT-10), а не у всех сразу.

## Готово, когда
`AccountsPage.test.tsx` (состояния, ⓘ, нет курса, добавить, переименовать, меню «Наличных», удаление после «Да»)
зелёный; `make e2e` — axe 0 на 1440 и 390 (`accounts.spec.ts`: список, панель ⓘ, окно нового счёта, подтверждение).
