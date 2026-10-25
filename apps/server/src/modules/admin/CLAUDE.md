# Модуль `admin`

Ярус 4 · таблицы: — · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Раздел «Администрирование»: собирает admin-фасады модулей; своих данных нет. Сейчас модуль пустой, но живой (T-007):
фабрика, описание `defineModule({ id: "admin" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
ADM-01…60 (экраны).

## Публичный API (`index.ts`)
- Фабрика: `createAdminModule({ platform, facades })` → `defineModule({ id: "admin" })`; платформа — `Platform` (без
  `SystemDb`); фасады — `facades.identity`, `facades.privacy`, `facades.notifications`, `facades.mail`, `facades.llm`,
  `facades.legalBase`, `facades.normTables`, `facades.system`, `facades.quality`, `facades.demo`.
- Фасад `AdminFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: identity, privacy, notifications, mail, llm, legal-base, norm-tables, system, quality, demo (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Своих таблиц нет: ни схем, ни `SystemDb`; данные — фасадами соседей.
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/admin` — unit и int (нужен `make db-up`); общий — `make check`.
