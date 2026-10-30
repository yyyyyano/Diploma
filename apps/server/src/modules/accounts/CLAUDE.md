# Модуль `accounts`

Ярус 2 · таблицы: user · публикует: `accounts.balances-changed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Счета, «Наличные», «Карта, не указана», остатки и дата остатка, итоги в BYN по курсу НБРБ (T-019); пересчёт остатка по
операциям (STMT-02) выполняет по вызову `transactions` — сам от `transactions` не зависит.

## Требования SPEC
STMT-01/02/09, EXPL-01, AGT-03 («счета»), AGT-05/07, RCPT-10. Макет: `Accounts.dc.html` (`features/accounts`).

## Публичный API (`index.ts`)
- Фабрика: `createAccountsModule({ platform, facades })`; платформа — `Platform`; фасады — `fxRates` (курс на сегодня,
  до транзакций), `explain` (трасса «Откуда эта цифра?»), `actions` («Отменить», решение об удалении), `identity`.
- Фасад `AccountsFacade` (для `fin`, `transactions`, `statements`, `receipts`; `balances(s)` (T-031, FIN-22) — остатки как расчёты: `items[]` — вид, название, банк, маска, остаток, `inByn: Calc<Money> | null` (нет курса — `null`, счёт в `unconverted`, валюта в `missingRates`, не 0), `available` — сумма без накопительных счетов; все в транзакции вызывающего — `tx`):
  `findOrCreate(tx, { bank, mask, currency })` → карта (банк без учёта регистра; нет — создаётся, «по операциям»);
  `applyBalanceChange(tx, { accountId, delta: Money, on })` (валюта счёта; день остатка не уходит назад; событие);
  `currencyOf(s, id)` — валюта своего счёта (чужой или нет — `NOT_FOUND`; операция пишется в валюте счёта);
  `findCard(s, key)` — карта без создания (предпросмотр импорта); `setStatementBalance(tx, { accountId, balance, on, force? })` —
  остаток из выписки (абсолютный, STMT-02; старше известного не перебивает, кроме `force` для счёта этого же импорта) →
  поправка и день «до» или `undefined`; `revertStatementBalance(tx, accountId, поправка)` — откат импорта (STMT-11);
  `cash(tx)` — «Наличные» в BYN; `unknownCard(tx)` — «Карта, не указана» (создаётся при первом обращении, RCPT-10).
- Контракт `contract.accounts.*` (все authed, канал отмены — web): `list` → `{ onDate, items, totals }` (остаток в валюте
  счёта, день и источник остатка, эквивалент в BYN и курс НБРБ на сегодня; итоги `total`/`available` в BYN или `null`
  при `missingRates`); `create`, `rename`, `setInitialBalance` → `{ account, undoToken }`; `requestDelete` → `{ decisionId }`
  (служебные — `ACCOUNT_PROTECTED`; «Да» на счёт с операциями — `CONFLICT { reason: "account-has-transactions" }`: FK
  `RESTRICT` из миграции `transactions`, счёт на месте); `explain({ subject: total | available | account })` → `{ traceId }` — расчёт
  сохраняется по нажатию ⓘ, курса нет — `UNAVAILABLE`.
- Событие `accounts.balances-changed { ids }`: начальный остаток, изменение по операциям, создание, удаление.
- Подписка `identity.user-registered` → `ensureCash(ctx.s)` (идемпотентно, сигнал `account` только при создании).
- Инструменты (`agent/tools.ts`): `list_accounts` (`read`, `core`), `create_account`, `rename_account` (`write`,
  `planning`, `undoToken`), `delete_account` (`destructive`, `planning`: только решение «Да/Нет»).
- Отмена `accounts.restore { revisionId }` (созданный — удаляется, иначе название и начальный остаток прежние);
  подтверждение `accounts.delete { accountId }`.
- Таблицы (`userOwnedTable`): `accounts` (вид, банк, маска, валюта, название, начальный остаток, остаток, день и
  источник остатка; уникальны «Наличные» в BYN пользователя, «Карта, не указана», карта банк+маска+валюта),
  `account_revisions` (состояние до действия, `ownedFk` на счёт). Владелец данных — `user-data.ts`.

## Зависимости
Можно: identity, fx-rates, explain, actions (`tooling/architecture/modules.ts`). Слушает: `identity.user-registered`.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(...)` на каждое обращение; «чьи» — только `s.scope`.
- Курс НБРБ — до `s.transaction` (HTTP вне транзакции); нет курса — эквивалент и итог `null`, не 0.
- Числа (эквивалент, итоги, сдвиг остатка) — только `@kosht/calc` (`domain/accounts.ts`).
- «Наличные» в BYN и «Карта, не указана» не удаляются; удаление — только через решение «Да/Нет» (AGT-07); счёт с
  операциями не удаляется (и «Отменить» созданного счёта с операциями — `CONFLICT`).

## Как тестировать
- `pnpm vitest run apps/server/src/modules/accounts` — правила (`domain/accounts.test.ts`), сценарии с настоящими
  actions и explain (`application/accounts.int.test.ts`), «Наличные» по событию (`ensure-cash.int.test.ts`),
  инструменты (`agent/tools.int.test.ts`); изоляция — `main/isolation.registry.int.test.ts`.
