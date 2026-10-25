# Модуль `quality`

Ярус 4 · таблицы: system · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Eval-прогоны с бюджетом токенов, результаты, сравнение с прошлыми. Сейчас модуль пустой, но живой (T-007): фабрика,
описание `defineModule({ id: "quality" })` и место в корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
QA-10…16, ADM-40.

## Публичный API (`index.ts`)
- Фабрика: `createQualityModule({ platform, facades })` → `defineModule({ id: "quality" })`; платформа —
  `SystemPlatform` (с `system: SystemDb`); фасады — `facades.llm`, `facades.receipts`, `facades.statements`,
  `facades.categories`, `facades.legalBase`, `facades.legalConsult`, `facades.agent`.
- Фасад `QualityFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: llm, receipts, statements, categories, legal-base, legal-consult, agent (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- `SystemDb` — только для своих таблиц system/public; пользовательские таблицы через него не трогать (аудитор SQL).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/quality` — unit и int (нужен `make db-up`); общий — `make check`.
