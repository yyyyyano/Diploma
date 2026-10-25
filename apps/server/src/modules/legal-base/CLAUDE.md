# Модуль `legal-base`

Ярус 2 · таблицы: public, system · публикует: `legal-base.act-updated`, `legal-base.act-repealed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Каталог актов, загрузчик pravo.by, редакции и версии фрагментов, гибридный поиск, журнал спроса, публичная «База
законов». Сейчас модуль пустой, но живой (T-007): фабрика, описание `defineModule({ id: "legal-base" })` и место в
корне композиции; содержимое добавляет задача модуля.

## Требования SPEC
LAW-01…40, LEGAL-11, ADM-10.

## Публичный API (`index.ts`)
- Фабрика: `createLegalBaseModule({ platform, facades })` → `defineModule({ id: "legal-base" })`; платформа —
  `SystemPlatform` (с `system: SystemDb`); фасады — `facades.llm`, `facades.notifications`, `facades.identity`.
- Фасад `LegalBaseFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): `legal-base.act-updated`, `legal-base.act-repealed`; контракт, задачи, инструменты агента,
  отмена, владелец данных, настройки — добавляет задача модуля.

## Зависимости
Можно: llm, notifications, identity (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- `SystemDb` — только для своих таблиц system/public; пользовательские таблицы через него не трогать (аудитор SQL).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/legal-base` — unit и int (нужен `make db-up`); общий — `make check`.
