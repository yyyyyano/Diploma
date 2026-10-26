# Модуль `explain`

Ярус 1 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Хранит трассу `{ value, trace }` рядом с результатом и отдаёт объяснение по `traceId` — ровно тот расчёт, которым
получено число (EXPL-02, ADR-0017).

## Требования SPEC
EXPL-01/02, P2, AGT-03 («объяснение»).

## Публичный API (`index.ts`)
- Фабрика: `createExplainModule({ platform, facades })`; платформа — `Platform`; соседей нет.
- Фасад `ExplainFacade`: `save(s, calc, { period? })` → `TraceId` (в транзакции модуля-владельца — `tx`);
  `get(s, traceId)` → `{ id, trace, period, createdAt }`; чужой — `NOT_FOUND`.
- Контракт `contract.explain.get` (authed) — `Explanation` (`TraceNodeSchema` рекурсивно, период или `null`).
- Инструмент агента `explain_number` (`read`, `core`): сохранённая трасса по `traceId` из результата другого инструмента.
- Таблица `explanations` (`userOwnedTable`): `trace` jsonb, `period_from`/`period_to`; строки не меняются.
- Подписи узлов — словарь `formulas`; ключи показателей `calc` — `TRACE_KEYS` (`@kosht/calc`).

## Зависимости
Можно: — (`tooling/architecture/modules.ts`). Слушает: —. `@kosht/calc` — только тип `Calc`.

## Запреты
- Не пересчитывать объяснение: только сохранённая трасса.
- Данные домохозяйства — только через `s.own(explanations)`; «чей» — только `s.scope`.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/explain` — сохранённый расчёт после изменения исходных данных, чужой
  `traceId`, инструмент (`application/explanations.int.test.ts`).
