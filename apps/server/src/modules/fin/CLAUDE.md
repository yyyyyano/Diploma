# Модуль `fin`

Ярус 3 · таблицы: — · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Свободный остаток с разбивкой, средний регулярный доход «на руки» и прогноз остатка по дням до конца месяца (T-031). Своих
таблиц нет: данные — фасады `accounts`, `transactions`, `recurring`, числа — `@kosht/calc` (`fin/`, `transactions/`).

## Требования SPEC
FIN-01/20/21/22, REC-04, PROF-03, EXPL-01/02, AGT-03 («планирование»).

## Публичный API (`index.ts`)
- Фабрика: `createFinModule({ platform, facades })` (`Platform`); фасады — accounts (`balances`), transactions (`firstOperationOn`),
  recurring (`list`, `upcoming`), profile, explain (`saveMany`).
- Фасад `FinFacade` (для `budgets`, `afford`, `dashboard`, `weekly`): `freeBalance(s)` → `FreeBalanceCalc` (`months`, `window`,
  `balance: Calc<Money> | null`, `reason`, `income`, `obligations[]` — все числа `Calc` с трассой и операциями-основаниями в `refs`);
  `forecast(s, { to? })` → прогноз остатка на конец каждого дня сегодня…`to` (по умолчанию — конец месяца; FIN-22).
- Контракт `contract.fin.freeBalance` (authed, GET): `FreeBalance` — `months`, `window`, `freeBalance`, `income`, `obligations[]`
  (ЖКХ, аренда, связь, кредиты, подписки, прочие) с `traceId` у каждого числа (`explain.saveMany`: повтор — те же id, строк не больше).
- Правила (`application/free-balance.ts`): в расчёт входят платежи `recurring` с `counted` (раздел «Доходы», «Обязательные», «Подписки»;
  «Другие регулярные», прекращённые и исключённые — нет); среднее платежа — по его повторам внутри окна последних полных месяцев
  (`historyWindow`), нет повторов в окне (годовой платёж) — его обычная средняя. «По данным за N мес.»: N = полные месяцы с первой
  операции, не больше 3 (`historyMonths`); N = 0 — число `null` и причина `insufficient-history`; регулярного дохода нет —
  `no-regular-income` (разность без дохода — не свободный остаток).
- Прогноз (`application/forecast.ts`): остаток «доступно» без накопительных счетов (`accounts.balances`) + ожидаемые поступления −
  ожидаемые платежи (`recurring.upcoming`); счёт без курса НБРБ — в `unconverted`, не 0.
- Подписка `recurring.changed` → `syncFact`: факт-предположение `finance.freeBalance` в профиле (`upsertDerivedFact`: подтверждённое
  человеком не перетирается, удалённое не оживает; сумма не изменилась — ничего не пишется).
- Инструмент `get_free_balance` (`read`, `planning`).

## Зависимости
Можно: accounts, transactions, recurring, profile, explain (`tooling/architecture/modules.ts`). Слушает: `recurring.changed`.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; своих таблиц и `SystemDb` нет.
- Числа — только `@kosht/calc`; «сегодня» — только `platform.clock`; «чьи данные» — только `s.scope`.
- Нет полного месяца истории — не ноль, а `null` с причиной; счёт без курса — не ноль.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/fin`: группы (`domain/groups.test.ts`) и сценарии на Postgres на настоящих соседях —
  пример FIN-20 → 840 BYN, «по данным за N мес.», факт профиля, прогноз (`application/fin.int.test.ts`, стенд —
  `main/__fixtures__/recurring-with-journal.ts`); изоляция — `main/isolation.registry.int.test.ts`.
