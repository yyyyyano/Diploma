# Модуль `identity`

Ярус 1 · таблицы: system · публикует: `identity.system-initialized`, `identity.user-registered`, `identity.user-deleted` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Better Auth (ядро) + первый запуск, код восстановления, роли, блокировка, последний админ, демо-вход, домохозяйство.
Сейчас модуль пустой, но живой (T-007): фабрика, описание `defineModule({ id: "identity" })` и место в корне
композиции; содержимое добавляет задача модуля.

## Требования SPEC
AUTH-01…12, ROLE-01/02, SEC-01/02, ADM-01, ADM-30, DEMO-04 (вход).

## Публичный API (`index.ts`)
- Фабрика: `createIdentityModule({ platform, facades })` → `defineModule({ id: "identity" })`; платформа —
  `SystemPlatform` (с `system: SystemDb`); фасады — `facades.mail`, `facades.privacy`.
- Фасад `IdentityFacade` — пока нет (`undefined`); появится с первым сценарием, нужным соседям.
- События (`events.ts`): `identity.system-initialized`, `identity.user-registered`, `identity.user-deleted`; контракт,
  задачи, инструменты агента, отмена, владелец данных, настройки — добавляет задача модуля.

## Зависимости
Можно: mail, privacy (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- `SystemDb` — только для своих таблиц system/public; пользовательские таблицы через него не трогать (аудитор SQL).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/identity` — unit и int (нужен `make db-up`); общий — `make check`.
