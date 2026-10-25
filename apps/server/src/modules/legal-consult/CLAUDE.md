# Модуль `legal-consult`

Ярус 2 · таблицы: user · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Метки цитат `[[F…]]`, проверка дословности, «в моей базе нет», чек-листы документов и их состояние. Сейчас модуль
пустой, но живой (T-007): фабрика, описание `defineModule({ id: "legal-consult" })` и место в корне композиции;
содержимое добавляет задача модуля.

## Требования SPEC
LEGAL-01…12, CHAT-05/06, P3.

## Публичный API (`index.ts`)
- Фабрика: `createLegalConsultModule({ platform, facades })` → `defineModule({ id: "legal-consult" })`; платформа —
  `Platform` (без `SystemDb`); фасады — `facades.legalBase`.
- Фасад `LegalConsultFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): —; контракт, задачи, инструменты агента, отмена, владелец данных, настройки — добавляет
  задача модуля.

## Зависимости
Можно: legal-base (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; новая таблица —
  `make new-table`, её строки — в `defineUserData` (`user-data.ts`).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/legal-consult` — unit и int (нужен `make db-up`); общий — `make check`.
