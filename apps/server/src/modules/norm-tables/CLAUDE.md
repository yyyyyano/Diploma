# Модуль `norm-tables`

Ярус 2 · таблицы: public, system · публикует: `norm-tables.values-confirmed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Таблицы «параметр → период → значение → источник» с подтверждением человеком. Сейчас модуль пустой, но живой (T-007):
фабрика, описание `defineModule({ id: "norm-tables" })` и место в корне композиции; содержимое добавляет задача
модуля.

## Требования SPEC
TAX-03, CAL-02 (сроки), AFF-05 (пределы ПДН), LAW-33, LEGAL-08, ADM-11.

## Публичный API (`index.ts`)
- Фабрика: `createNormTablesModule({ platform, facades })` → `defineModule({ id: "norm-tables" })`; платформа —
  `SystemPlatform` (с `system: SystemDb`); фасады — `facades.legalBase`, `facades.notifications`.
- Фасад `NormTablesFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): `norm-tables.values-confirmed`; контракт, задачи, инструменты агента, отмена, владелец
  данных, настройки — добавляет задача модуля.

## Зависимости
Можно: legal-base, notifications (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- `SystemDb` — только для своих таблиц system/public; пользовательские таблицы через него не трогать (аудитор SQL).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/norm-tables` — unit и int (нужен `make db-up`); общий — `make check`.
