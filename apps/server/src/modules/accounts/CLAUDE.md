# Модуль `accounts`

Ярус 2 · таблицы: user · публикует: `accounts.balances-changed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Счета, «Наличные», «Карта, не указана», остатки и дата остатка; пересчёт остатка по операциям (STMT-02) выполняет по
вызову `transactions` — сам от `transactions` не зависит. Сейчас (T-009): «Наличные» у каждого пользователя с самого
начала и список счетов; виды счетов, остатки и курсы — T-019.

## Требования SPEC
STMT-01/02. Макет: `Accounts.dc.html` (сайт — `features/accounts`, `entities/account`).

## Публичный API (`index.ts`)
- Фабрика: `createAccountsModule({ platform, facades })`; платформа — `Platform` (без `SystemDb`); фасады —
  `facades.identity`, `facades.fxRates`, `facades.explain` (пока не используются). Фасад `AccountsFacade` — нет.
- Контракт `contract.accounts.list` (authed): `{ items: [{ id, kind: "cash", name | null, balance: Money }] }` —
  «Наличные» первыми, затем по времени создания и id; `name: null` — подпись по виду даёт сайт.
- Подписка `identity.user-registered` (`subscriptions/on-user-registered.ts`) → `ensureCash(ctx.s)`: «Наличные»
  идемпотентно (частичный уникальный индекс, `ON CONFLICT DO NOTHING`), сигнал `realtime.changed(tx, { entity:
  "account" })` при коммите — только если счёт создан.
- Инструмент агента (`agent/tools.ts`): `list_accounts` (`read`, набор `core`) — счета домохозяйства запуска с
  остатками (`{ items: AccountListItem[] }`); сайт рисует их карточками счёта, подпись шага — словарь `tools`.
- Владелец данных (`user-data.ts`): таблица `accounts`.

## Зависимости
Можно: identity, fx-rates, explain (`tooling/architecture/modules.ts`). Слушает: `identity.user-registered`.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(accounts)` на каждое обращение; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи (нагрузке события не
  верим — счёт создаётся для владельца задачи).
- Остаток — число: считает `@kosht/calc` с трассой (T-019); здесь — только начальный остаток в копейках.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/accounts` — `ensure-cash.int.test.ts` (повтор и параллельная доставка —
  один счёт, сигнал только при создании, список своего домохозяйства); изоляция по реестру —
  `main/isolation.registry.int.test.ts`.
