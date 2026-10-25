# Модуль `categories`

Ярус 2 · таблицы: public, user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Встроенные категории (общие) и свои (домохозяйства), правила, гибридная категоризация пакетами. Сейчас модуль пустой,
но живой (T-007): фабрика, описание `defineModule({ id: "categories" })` и место в корне композиции; содержимое
добавляет задача модуля.

## Требования SPEC
CAT-01…07, RCPT-09, CAT-04.

## Публичный API (`index.ts`)
- Фабрика: `createCategoriesModule({ platform, facades })` → `defineModule({ id: "categories" })`; платформа —
  `SystemPlatform` (с `system: SystemDb`); фасады — `facades.merchants`, `facades.llm`.
- Фасад `CategoriesFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: merchants, llm (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- `SystemDb` — только для своих таблиц system/public; пользовательские таблицы через него не трогать (аудитор SQL).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/categories` — unit и int (нужен `make db-up`); общий — `make check`.
