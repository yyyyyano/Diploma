---
paths:
  - "apps/server/src/modules/*/infrastructure/db/**"
  - "apps/server/src/modules/*/user-data.ts"
  - "apps/server/src/modules/*/jobs/*.sweep.ts"
  - "apps/server/src/platform/db/**"
  - "apps/server/drizzle/**"
---
# База данных (PostgreSQL 18, Drizzle 1.0 RC — точная версия)

Почему так — ADR-0006 (изоляция без RLS), ADR-0007 (данные и поиск); устройство — `docs/ARCHITECTURE.md` §6.

## Изоляция (ROLE-01, SEC-04, PRIV-07) — самое важное
- Вид таблицы — в паспорте: `userOwnedTable` (данные домохозяйства), `systemTable`, `publicTable`. Таблица с
  `household_id`/`user_id` вне `userOwnedTable` — ошибка CI. «Общее + своё» в одной таблице нельзя.
- `userOwnedTable` сама даёт `id` (`uuidv7()`), `household_id NOT NULL`, `user_id`, `created_at`, `updated_at`,
  PK `(household_id, id)`; ссылки на пользовательские таблицы — только `ownedFk(...)`. `ON DELETE SET NULL` на
  составном FK drizzle-kit генерирует неверно — правь миграцию на `SET NULL (<колонка>)`.
- Репозиторий: первый аргумент `s: ScopedDb`; свой `drizzle()`, `db`, `pg` не создавать. В запросе к **каждой**
  пользовательской таблице — свой `s.own(таблица)` (в `where` или `on`): JOIN, подзапрос, CTE, агрегат. Запись —
  `s.insert(t).values()`, `s.update(t, where).set()`, `s.delete(t, where)`: фильтр и `household_id` они ставят сами.
- Связанную строку читай со своим `own`, а не считай видимой «по родителю». Чужой id = `NOT_FOUND`.
- Сырой SQL — только в `infrastructure/db/*.sql.ts` и `*.repo.ts`, значения — только параметрами, в тексте
  обязателен `${s.own(таблица)}`; сортировка и поля из ввода — только из `enum`.
- `ISOLATION_VIOLATION` — баг запроса: не ловить, не глушить, не обходить.
- «Для всех пользователей» — только `defineSweep` в `*.sweep.ts`: сквозной запрос возвращает **только**
  `(id, householdId, userId)`, обработка — по одному под своим `s`.
- Новая пользовательская таблица ⇒ `make new-table` → строки в `defineUserData` (экспорт и удаление) → тест
  изоляции по реестру зелёный → `make check` зелёный.
- `singletonKey` задач — через `jobKey(scope, …)`; кэш пользовательских данных — только `scopedCache(s)`.

## Остальное
- Деньги — `bigint` копеек (`mode: "number"`) + `currency`; дни — `date`; моменты — `timestamptz`; id — `uuid`.
- Запросы — построителем и `` sql`…` ``; реляционный API `db.query.*` не использовать.
- Миграции: `make db-generate` → прочитать SQL глазами (HNSW, `CONCURRENTLY`, `SET NULL (col)`, расширения — руками)
  → закоммитить вместе со схемой. Откатов нет (`make db-reset`). В `public` — никаких `VIEW`, функций, триггеров
  над пользовательскими таблицами. Таблицы pg-boss Drizzle не трогает (`schemaFilter: ["public"]`).
- Индексы — под реальные запросы сценариев; HNSW — только для публичных данных (законы).

Правильно:

```ts
async listByPeriod(s: ScopedDb, p: Period, sort: "date" | "amount") {
  return s.db.select().from(transactions)
    .where(and(s.own(transactions), between(transactions.date, p.from, p.to)))
    .orderBy(sort === "date" ? desc(transactions.date) : desc(transactions.amountMinor)).limit(50);
}
```

Нельзя: `where(eq(t.id, id))` без `s.own(t)`; `s.db.update(t)` в обход `s.update`; `$client`, `unsafeRaw`,
`crossTenant` вне `*.sweep.ts`; `sql.raw("…" + input)`; `real/double` для денег; `household_id` из аргументов.
