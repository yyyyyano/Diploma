# Экран `budget` — Лимиты и цели

Маршрут: `/budget` (`routes/_app/budget.tsx`) · доступ: пользователь (без сессии — `/login`). Пункт меню — «Деньги → Лимиты и цели».

## Макет
- Исходник: `design/screens/Budget.dc.html` (+ состояние `Budget--new-goal`); описание — `design/SCREENS.md` § «Лимиты и цели».
- Скриншоты: `design/screenshots/desktop/Budget.png`, `design/screenshots/mobile-width/Budget.png`, `design/screenshots/states/Budget--new-goal.png`.

## Требования SPEC
BUD-01…07 (лимиты, полосы, пороги 80/100 %, копилка и привязка к счёту, рекомендуемый взнос, «укладывается в свободный остаток»), EXPL-01
(ⓘ у процента и взноса), P5 («Отменить»), AGT-07 (удаление — «Да/Нет»); состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.budgets.overview` (`{ month, daysLeft, limits, goals, freeBalance }`), `loader` — `prefetchQuery`; контекст ассистента — `staticData.page = "budget"`.
- Изменение (одиночное → `UndoActionToast`): `setLimit` (новый, правка, переключатели 80/100 %), `createGoal`, `updateGoal`, `contribute`.
  Удаление: `requestDeleteLimit` / `requestDeleteGoal` → `{ decisionId }` → `DecisionDialog` (вопрос — `decisions:limitDelete` / `goalDelete`, кнопка
  «Да, удалить лимит «…»»).
- Окно «Новая цель»: `previewGoal` (POST — вход вложенный) → «Откладывайте по X в месяц» и «укладывается ли»; считает сервер (P1).
- ⓘ: `traceId` из ответа → `ExplanationSheet`. Живые обновления: `events.stream` (`budget`, `goal`, `transaction`, `account`) → `orpc.budgets.key()`.

## Компоненты
Свои: `BudgetPage`, `LimitForm`, `GoalForm`, `model/format.ts` (месяц словами). Из `entities`: `goal` (`GoalCard`, `ContributeDialog`), `action`, `category`,
`explanation`. Из `ui`: `LimitBar`, `PageHeader`, `Money`, `WhyButton`, `EmptyState`, `SkeletonCard`, `CategoryIcon`; Mantine `Modal`, `Select`, `Chip`.

## Отличия от макета (с причиной)
- Нет блока «Как распределён свободный остаток» (свободный остаток, распределённое на цели, свободно после целей): долю «после других целей» сервер не считает;
  «укладывается ли» показано в каждой цели против общего свободного остатка (BUD-05).
- Нет подсказки «В среднем 8,00 в день. Чтобы уложиться — не больше 3,20 в день»: средние в день — деньги, а сервер их не отдаёт (P1).
- Нет кнопки «Спросить ассистента»: панель чата — T-043. Дата начала цели не показана; срок цели — поле даты браузера (`type="date"`).
- Уведомление «80 % отправлено 21.10» под лимитом не показано: сайт не знает дату отправки — она в колокольчике.

## Готово, когда
`BudgetPage.test.tsx` (четыре состояния, полосы 84 и 112 %, ⓘ, переключатель порога, взнос, новая цель с предпросмотром, удаление лимита через «Да») зелёный;
`make e2e` — axe 0 на 1440 и 390 (`budget.spec.ts`).
