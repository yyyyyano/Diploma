# Модуль `llm`

Ярус 1 · таблицы: system, user · публикует: `llm.local-models-ready` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Реестр моделей, адаптеры, цепочки по задачам, лимитёр, маскирование, журнал расхода, Langfuse, эмбеддинги, речь,
локальные модели. Сейчас модуль пустой, но живой (T-007): фабрика, описание `defineModule({ id: "llm" })` и место в
корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
LLM-01…10, NFR-04/05/25, PRIV-02/03/04/09, OBS-03, ADM-20/21/22/50.

## Публичный API (`index.ts`)
- Фабрика: `createLlmModule({ platform, facades })` → `defineModule({ id: "llm" })`; платформа — `SystemPlatform` (с
  `system: SystemDb`); фасады — `facades.privacy`, `facades.identity`, `facades.notifications`.
- Фасад `LlmFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): `llm.local-models-ready`; контракт, задачи, инструменты агента, отмена, владелец данных,
  настройки — добавляет задача модуля.

## Зависимости
Можно: privacy, identity, notifications (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- `SystemDb` — только для своих таблиц system/public; пользовательские таблицы через него не трогать (аудитор SQL).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/llm` — unit и int (нужен `make db-up`); общий — `make check`.
