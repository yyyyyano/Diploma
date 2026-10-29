# Модуль `transactions`

Ярус 2 · таблицы: user · публикует: `transactions.changed`, `transactions.merged` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Операции, разбивка по категориям, переводы и возвраты, предварительные, сопоставление чек ↔ выписка, массовые
действия, агрегации пачками; вызывает фасад `accounts` для пересчёта остатка (STMT-02). Сейчас — таблицы и правила
(T-021); сценарии, контракт и экран добавляет T-021 следующими коммитами.

## Требования SPEC
TXN-01…11, FIN-01, STMT-02/09, STMT-07/08 (запись), CAT-05 (применить к прошлым).

## Публичный API (`index.ts`)
- Фабрика: `createTransactionsModule({ platform, facades })` → `defineModule({ id, userData })`; фасадов наружу нет.
- Таблицы (`userOwnedTable`, `user-data.ts`): `transactions` (счёт, тип и направление, день и время, сумма и валюта,
  сумма в BYN и id курса, исходное описание, контрагент и его ключ, комментарий, категория и источник, источник
  операции, видимость `personal`, пара перевода, исходная покупка, версия), `transaction_revisions` (пачка действия,
  действие, канал, состояние «до», версия после, поля; без FK на операцию — история удалённой остаётся). Составные FK
  на `accounts`, `categories`, `system_categories` и на себя — руками в миграции `*_transactions` (чужая схема модулю
  недоступна): счёт и своя категория — `RESTRICT`, пара и покупка — `SET NULL (колонка)`.
- Правила (`domain/transactions.ts`): направление по типу, сдвиг остатков счетов (`@kosht/calc`), изменённые поля.

## Зависимости
Можно: accounts, categories, merchants, fx-rates, actions, explain, notifications (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- Фасад без агрегатов пачками (метод «сумма по одной категории», который зовут в цикле) — нет: только `aggregate`.
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)`; «чьи» — только `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/transactions` — правила (`domain/transactions.test.ts`); удаление
  аккаунта — `main/account-deletion.int.test.ts`.
