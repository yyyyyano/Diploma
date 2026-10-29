# Модуль `categories`

Ярус 2 · таблицы: public, user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Встроенные категории (общие) и свои (домохозяйства), правила пользователя, гибридная категоризация: правила сразу,
модель — пакетом непокрытых (T-020).

## Требования SPEC
CAT-01…04, CAT-06, CAT-07, LLM-05 (кэш одинаковых классификаций); CAT-05 (правило из исправления) — фасад, сценарий —
T-022.

## Публичный API (`index.ts`)
- Фабрика: `createCategoriesModule({ platform, facades })`; платформа — `SystemPlatform`; фасады — `merchants`
  (очистка и справочник), `llm` (модель, задача `classify.category` — цепочка из моделей с `structured`).
- Фасад `CategoriesFacade`:
  - `byRules(s, inputs)` → `{ resolved, pending }` — без модели, сразу (путь запроса ручного ввода): правило
    пользователя → справочник контрагентов → ключевое слово → MCC (операция) или правило пользователя → ключевое
    слово позиции (позиция чека, `item`, по нормализованному наименованию RCPT-15); тип категории = тип операции.
  - `withModel(s, pending)` — **вне транзакции** (в worker): кэш `scopedCache(s)` (LLM-05), остальное — пачками по
    `categories.model-batch` (20), один запрос `llm.extract` на пачку, строго из встроенных нужного типа без скрытых
    и своих не скрытых; сбой модели или метка вне списка — «Прочее»/«Прочие доходы» с источником `fallback`.
  - `categorize(s, inputs)` = оба шага, ответ в порядке входа: `{ key, category: CategoryRef, source }` (источник —
    для «Откуда эта цифра?», хранит владелец операции).
  - `list(s)`, `setUserRule(s, { matcher: merchant | item, pattern, category })` (CAT-05; своя чужая — `NOT_FOUND`),
    `userRule(s, { matcher, pattern })` → категория правила или `undefined`, `removeUserRule(s, { matcher, pattern })` —
    для «Отменить» правила из исправления (T-022).
- Контракт `contract.categories.*` (все authed): `list`, `create` (`CONFLICT` — то же название того же типа), `rename`
  (своя), `setHidden` (своя или встроенная — встроенная только скрывается).
- Подсказка — `application/categorize.prompt.ts` (`CATEGORIZE_PROMPT_VERSION`; строки — блоком `<document>`).
- Таблицы: `system_categories`, `global_category_rules` (`publicTable`, сид — миграция `*_categories`; список — и
  `SYSTEM_CATEGORIES` в `@kosht/contract`, сверяет тест); `categories`, `hidden_system_categories`, `category_rules`
  (`userOwnedTable`; у правила — `system_code` или `category_id`, CHECK «ровно одна»).

## Зависимости
Можно: merchants, llm (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно» (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(...)`; кэш классификаций — только `scopedCache(s)`.
- Модель — не внутри `s.transaction` и не в пути запроса ручного ввода; описание и наименование — данные (SEC-11).
- `SystemDb` — только для своих общих таблиц.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/categories` — правила (`domain/match.test.ts`), порядок, позиции, пакет и
  кэш, fallback, справочник категорий на Postgres со шпионом шлюза (`application/categorize.int.test.ts`).
