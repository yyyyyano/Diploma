# Экран `dashboard` — Главная

Маршрут: `/home` (`routes/_app/home.tsx`; период — `?from=&to=`) · доступ: пользователь. Стартовый «/» ведёт вошедшего сюда (`routes/index.tsx`);
первый пункт меню, на телефоне — место 1.

## Макет
- Исходники: `design/screens/Main.dc.html` (+ `Main--loading`, `--empty`, `--why-panel`), `design/screens/MobileHome.dc.html`; описание — `design/SCREENS.md` § «Главная».
- Скриншоты: `design/screenshots/desktop/Main.png`, `design/screenshots/mobile-width/Main.png`, состояния — `design/screenshots/states/Main--*.png`.

## Требования SPEC
DASH-01…04 (период, состав, переходы в операции, первые шаги), EXPL-01 (ⓘ у каждого числа), REC-03, BUD-02, DES-13…15; состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Одна процедура `orpc.dashboard.overview({ from?, to? })` (GET): остатки счетов и «всего», доходы и расходы, категории (≤ 6 + «Остальное»), динамика (6 месяцев),
  лимиты и цели, свободный остаток (всегда три полных месяца), ближайшие платежи, `hasData`; у каждого числа — `traceId` → `ExplanationSheet` (шторка на телефоне).
  Сайт денег не считает (P1): высоты столбцов и доли кольца — геометрия по значениям ответа.
- Период — `from`/`to` в адресе (`model/search.ts`); нет — текущий месяц по `Clock` сервера. Выбор — стрелки месяца и «Свой период» (`@mantine/dates`, чанк грузится лениво — `PeriodBar`).
- Переходы (DASH-03): категория → `/operations?from&to&category=system:<код>` (или `custom:<id>`); столбец месяца → `/operations?from&to&type=expense|income`; параметры уже есть в «Операциях».
- Взнос в копилку — `entities/goal` (`ContributeDialog`, `budgets.contribute`) с «Отменить» (`UndoActionToast`). Живые обновления: `transaction`, `account`, `budget`, `goal`, `recurring`, `profile-fact` → `orpc.dashboard.key()`.

## Компоненты
Свои: `HomePage` (страница; вход экрана отдаёт её через `lazyPage` (`lib/lazy-page.tsx`) — отдельный чанк, чтобы страница не попала в первую загрузку), `PeriodBar`, `model/period.ts`. Из `entities`: `goal` (`GoalCard` compact), `action`,
`category`, `explanation`, `account` (`useAccountName`). Из `ui`: `StatCard`, `Money`, `WhyButton`, `LimitBar`, `DonutChart`, `ColumnChart`, `EmptyState`, `SkeletonCard`.

## Отличия от макета (с причиной)
- Скрыто до своих задач: вычеты, итоги недели, «Могу ли я позволить покупку?», события календаря; в «Ближайших платежах» — только `recurring.upcoming` (T-033, фаза 7 добавит остальное).
- Нет плавающей кнопки «Спросить ассистента» и панели чата — T-043. Колокольчик — в каркасе (`features/notifications`).
- Подпись долей кольца в процентах не показана: доли считает код, а сервер их не отдаёт (P1); у категорий — суммы с ⓘ.
- «Остальное» и месяцы динамики — ⓘ у каждой суммы списком под диаграммой (столбцы — кнопки с подписью «Расходы, май: …»), а не подсказкой при наведении.

## Готово, когда
`HomePage.test.tsx` (четыре состояния, числа и ⓘ, категория и месяц → «Операции», период, лимиты, цели, взнос, «первые шаги») и `model/period.test.ts` зелёные;
`make e2e` — axe 0 на 1440 и 390 (`home.spec.ts`); `make bench` — главная ≤ 300 мс p95.
