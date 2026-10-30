# Модуль `budgets`

Ярус 3 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Лимиты по категориям на календарный месяц с порогами 80 / 100 %, цели (копилка или привязка к накопительному счёту),
рекомендуемый взнос, уведомления о прогрессе и отставании от графика (T-032). Проценты, взнос и плановая сумма — `@kosht/calc`
(`budgets/`), каждое показываемое число сохраняется для «Откуда эта цифра?».

## Требования SPEC
BUD-01…07, NOTIF-02 (виды `limit`, `goal`), AGT-03 («лимиты и цели»), AGT-05, AGT-07, P1, P2, P5.

## Публичный API (`index.ts`)
- Фабрика: `createBudgetsModule({ platform, facades })` (`Platform`); фасады — accounts (`balances`), transactions (`aggregate`),
  categories (`list`), fin (`freeBalance`), notifications (`notify`), actions (`record`, `propose`), explain (`saveMany`).
- Фасад `BudgetsFacade` (для `dashboard`, `afford`, `weekly`, `telegram`): `overview(s, month?)` → `BudgetsOverview` — лимиты месяца
  `{ spent, limit, remaining, percent, traceId, notify80, notify100 }` и цели `{ saved, percent, traceId, monthsLeft, contribution,
  fitsFreeBalance, planned, behind, contributions }` + свободный остаток; расходы — один агрегат на все лимиты, остатки счетов — один вызов.
- Контракт `contract.budgets.*` (authed, канал отмены — web): `overview`, `setLimit` (новый лимит или правка: у категории один),
  `createGoal`, `updateGoal`, `contribute` → `{ …, undoToken }`; `requestDeleteLimit`, `requestDeleteGoal` → `{ decisionId }` («Да» исполняет
  `budgets.delete-limit` / `budgets.delete-goal`); `previewGoal` — взнос до создания цели. Ошибки `VALIDATION { reason }`: `limit`, `target`,
  `amount`, `category` (не расходная), `deadline-past`, `account-kind` (цель по счёту — только `savings`/`deposit`), `linked-goal` (взнос в цель по счёту), `no-rate`.
- Пороги (`application/thresholds.ts`): подписка `transactions.changed` → `recheckLimits` (расходы текущего месяца по `Clock`; очередь опрашивается
  раз в 0,5 с, `startAfter` нет — ради «≤ 3 с», схлопывание `jobKey(scope, "budgets.recheck-limits")`); `accounts.balances-changed` → `recheckGoals`
  (прогресс целей по счёту, 50 и 100 %); ежедневный обход `budgets.check-goals-sweep` (`04:30`) → задача `budgets.check-goal { goalId }`
  (50/100 % и «отстаёт»). Одноразовость — уникальный ключ в `budget_alerts` (`ГГГГ-ММ:порог` у лимита; `50`, `100`, `behind:ГГГГ-ММ` у цели) и
  `ON CONFLICT DO NOTHING` в той же транзакции, что `notify`. Достигнуто сразу несколько порогов (импорт перепрыгнул 80 %) — уведомление о высшем.
  После записи лимита и цели пороги проверяются сразу (лимит поверх уже сделанных трат уведомляет без новой операции).
- Правила целей: цель в BYN; копилка — прогресс = сумма взносов; «по счёту» — остаток счёта (`accounts.balances`, не BYN — по курсу НБРБ; нет курса —
  `saved: null`, «нет курса», не 0; счёт удалён — `accountMissing`). Месяцев до срока — полные, как возраст, не меньше 1. «Отстаёт»: накоплено < плановое на
  сегодня (равномерно от создания до срока) − допуск настройки `budgets.goal-behind-tolerance-pct` (10 % планового).
- Инструменты (`agent/tools.ts`, набор `planning`): `list_budgets` (`read`), `set_limit`, `create_goal`, `contribute_to_goal` (`write` + `undoToken`),
  `delete_limit`, `delete_goal` (`destructive`: только решение).
- Отмена: `budgets.restore { revisionId }` (создание — убирает, правка — возвращает «до»; цель со взносами созданием не отменяется — `CONFLICT`),
  `budgets.uncontribute { contributionId, goalId }`. Удаление лимита и цели отменой не возвращается — оно за подтверждением.
- Сигналы сайту: `budget` (лимиты), `goal` (цели и взносы). Уведомления: `limit` (объект `limit`) и `goal` (объект `goal`) — параметры `threshold`, `percent`,
  `category`, `daysLeft`, `spent`, `limit` (копейки) / `reason` (`half | done | behind`), `percent`, `name`.
- Таблицы (`userOwnedTable`): `budget_limits`, `budget_goals`, `budget_contributions` (`ownedFk` на цель), `budget_alerts`, `budget_revisions`.
  Владелец данных — `user-data.ts`.

## Зависимости
Можно: accounts, transactions, categories, fin, notifications, actions, explain (`tooling/architecture/modules.ts`).
Слушает: `transactions.changed`, `accounts.balances-changed`.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием (ADR-0004).
- Данные — только через `s: ScopedDb` с `s.own(...)`; «чьи» — только `s.scope`; в нагрузке задач — только id.
- Суммы и проценты — только `@kosht/calc`; «сегодня» — только `platform.clock`; допуск — настройка, а не константа.
- Уведомление — один раз на ключ: проверка `claimAlert` и `notify` — в одной транзакции; текст и категория в логи не пишутся (OBS-04).

## Как тестировать
- `pnpm vitest run apps/server/src/modules/budgets`: месяц (`domain/month.test.ts`), сценарии на Postgres с настоящими transactions, accounts,
  actions, explain, fin — КП BUD (80 % → одно уведомление, 205 → второе, новый месяц с нуля), цели, «Отменить», решения «Да/Нет»
  (`application/budgets.int.test.ts`, стенд — `main/__fixtures__/budgets-with-journal.ts`). Сквозь HTTP и настоящий worker — `main/budgets.int.test.ts`:
  «трата → уведомление ≤ 3 с» на 10 прогонах и «импорт 300 операций → ≤ 5 задач»; изоляция — `main/isolation.registry.int.test.ts`.
