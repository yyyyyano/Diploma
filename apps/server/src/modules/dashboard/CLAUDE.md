# Модуль `dashboard`

Ярус 3 · таблицы: — · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Сборка главного экрана (T-033, только чтение, пачками): все числа периода одним ответом, у каждого — `traceId` сохранённого расчёта.
Своих таблиц нет: данные — фасады соседей, числа — `@kosht/calc`. Виджеты вычетов, календаря и итогов недели — фаза 7.

## Требования SPEC
DASH-01…04, EXPL-01/02, REC-03, BUD-02, FIN-20, P1, P2.

## Публичный API (`index.ts`)
- Фабрика: `createDashboardModule({ platform, facades })` (`Platform`); фасады — accounts (`balances`), transactions (`aggregate`), fin (`freeBalance`),
  budgets (`overview`), recurring (`upcoming`), explain (`saveMany`); calendar, tax, weekly — пока не нужны.
- Фасад `DashboardFacade`: `overview(s, { from?, to? })` → `DashboardOverview` (для `telegram`).
- Контракт `contract.dashboard.overview` (authed, GET, `{ from?, to? }`; по умолчанию текущий месяц по `Clock`): остатки счетов и «всего» (BYN, нет курса — `null`),
  доходы и расходы периода, траты по категориям (≤ 6 рядов + «Остальное» с числом свёрнутых), динамика — шесть месяцев до месяца конца периода, лимиты и цели
  (`budgets.overview`), свободный остаток (всегда три полных месяца, независимо от периода), ближайшие платежи (расходы на 30 дней, ≤ 5), `hasData` (нет — «первые шаги»).
- Сборка: два агрегата операций (категории периода, месяцы), `budgets.overview`, остатки, свободный остаток, платежи — параллельно на одном `s`, без транзакции;
  трассы — двумя `saveMany` (числа периода — с периодом; остальные — без): повтор даёт те же `traceId`. Ключ категории — `system:код` / `custom:id` — он же параметр `category` «Операций».

## Зависимости
Можно: accounts, transactions, fin, budgets, recurring, calendar, tax, weekly, explain (`tooling/architecture/modules.ts`). Слушает: —.
`explain` добавлен в T-033: трассы «Остальное», итогов и остатков счетов сохраняет сам дашборд (`explain.saveMany`).

## Запреты
- Своих таблиц, схем и `SystemDb` нет; в чужой модуль — только через его `index.ts` и только из «Можно».
- Числа — только `@kosht/calc`; «сегодня» — только `platform.clock`; «чьи данные» — только `s.scope`.
- Нет курса — `null`, а не 0; цикла «вызов фасада на каждую категорию» нет (N+1).

## Как тестировать
- `pnpm vitest run apps/server/src/modules/dashboard`: раскладка (`domain/layout.test.ts`), сценарии на Postgres на истории 6 месяцев с настоящими соседями —
  числа и расчёты, повтор без роста `explanations`, свободный остаток вне периода, новый пользователь (`application/dashboard.int.test.ts`); изоляция —
  `main/isolation.registry.int.test.ts`; «главная ≤ 300 мс p95» — `make bench`.
