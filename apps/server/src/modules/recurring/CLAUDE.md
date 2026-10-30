# Модуль `recurring`

Ярус 2 · таблицы: user · публикует: `recurring.changed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Поиск регулярных платежей по истории операций, разделы и состояния, ожидаемые даты, «возможно прекращён», подписки (T-030).
Числа регулярных платежей — `@kosht/calc` (`recurring/`): среднее по операциям-основаниям, сумма в месяц, итог раздела.

## Требования SPEC
REC-01…05, PROF-03 (факты), AGT-03 («планирование»), P5. Макет: `Recurring.dc.html` (`features/recurring`; блок свободного остатка — T-031).

## Публичный API (`index.ts`)
- Фабрика: `createRecurringModule({ platform, facades })` (`Platform`); фасады — transactions (`recurringHistory`), profile,
  notifications, actions («Отменить»), explain, categories (пока не нужен).
- Фасад `RecurringFacade`: `list(s, { sections?, onDate })` → `RecurringEntry[]` (без исключённых: период, состояние, раздел,
  `average: Calc<Money>` с операциями-основаниями в `refs`, `monthly: Calc<Money>`, следующая дата, `counted` — входит ли в
  свободный остаток) и `upcoming(s, { from, to })` → `UpcomingPayment[]` (дата, имя, сумма `Calc`) — для `fin`, `dashboard`, позже `calendar`, `afford`.
- Событие `recurring.changed { ids }` (`events.ts`): найден, пересчитан, решение человека, «возможно прекращён»; сигнал сайту — `recurring`.
- Контракт `contract.recurring.*` (authed, канал отмены — web): `list` (платежи + итоги разделов в месяц и год), решения `confirm`,
  `exclude`, `end`, `resume`, `stillComing`, `edit`, `create` → `{ item, undoToken }`, `explain({ id })` → `traceId`, `markers({ ids ≤ 100 })`
  → id операций, входящих в регулярный платёж (признак в «Операциях»: `transactions` от `recurring` не зависит).
- Состояния: `active | suggested | maybe-ended | ended | excluded`; разделы — Доходы, Обязательные (`utilities`, `rent`, `telecom`,
  `loans`), Подписки (`subscriptions`), Другие (в свободный остаток не входят, найденное там — `suggested`). Поправленное человеком
  (`user_fixed`: раздел, период, день, сумма) поиск не перетирает; исключённое и прекращённое не оживает.
- Пересчёт: подписка `transactions.changed` → `application/recompute.ts` (один запрос истории за 13 мес., схлопывание
  `jobKey(scope, "recurring.recompute")` + 2 с; перечитывает всё, нагрузке не верит). «Возможно прекращён» (REC-05): обход
  `recurring.check-missed-sweep` (`04:10`, `missed: "once"`) → задача `recurring.check-missed { itemId }`; уведомление `recurring-missed`
  одно на «платёж + ожидаемая дата»; только для найденных и действующих.
- Факты профиля `income.regular`, `obligations.regular` (месяц, BYN) — `profile.upsertDerivedFact` («предположение», подтверждённое не
  перетирается), пишутся при изменении итога. Инструменты (`agent/tools.ts`, `planning`, `read`): `list_recurring`, `upcoming_payments`.
- Отмена `recurring.restore { revisionId }`; настройки `recurring.*` (`settings.ts`): повторы, допуски суммы и даты, окно, глубина, дни и доля окна «прекращён».
- Таблицы (`userOwnedTable`): `recurring_items` (серия, контрагент, раздел, период, состояние, повторы-основания, `member_ids`,
  ожидаемая дата), `recurring_revisions` (человеческие поля до действия). Владелец данных — `user-data.ts`.

## Зависимости
Можно: transactions, categories, profile, notifications, actions, explain (`tooling/architecture/modules.ts`). Слушает: `transactions.changed`.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием (ADR-0004).
- Данные — только через `s: ScopedDb` с `s.own(...)`; «чьи» — только `s.scope`; в нагрузке задач — только id.
- Суммы — только `@kosht/calc`; «сегодня» — только `platform.clock`; пороги — настройки, а не константы.
- Уведомление «не пришёл» — один раз на ключ; события и сигналы — пачкой id, без сумм и названий.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/recurring`: правила и поиск (`domain/*.test.ts`), сценарии на Postgres на истории 6 месяцев
  из `@kosht/synth` с настоящими transactions, actions, profile, explain (`application/recurring.int.test.ts`, стенд — `main/__fixtures__/recurring-with-journal.ts`).
