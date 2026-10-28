# Модуль `system`

Ярус 1 · таблицы: system · публикует: — (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Обзор фоновых задач, доступ из сети, резервная копия, часовой пояс, статус Langfuse — то, что в «Системе» админки
принадлежит платформе (ADM-60). Процедур своих нет: их собирает `admin` из фасада. Резервная копия — `make backup`.

## Требования SPEC
ADM-60, NFR-22/24, OBS-05/07.

## Публичный API (`index.ts`)
- Фабрика: `createSystemModule({ platform, facades })`; платформа — `SystemPlatform`; фасадов соседей нет.
- Фасад `SystemFacade` (`application/system-settings.ts`): `view()` — `jobs.overview()` (выполняются, ошибки,
  расписания с последним запуском), пояс `clock.time-zone`, доступ из сети (`network.allow-lan`, адрес
  `network.lan-address`), Langfuse (`{ enabled, url }` из `platform.telemetry`); `setTimeZone(пояс)` — неизвестный —
  `VALIDATION`, «сегодня» этого процесса меняется сразу (кэш прогревается), расписания worker — после его
  перезапуска (экран так и говорит); `setLan({ allowed, address })` — адрес не http(s) — `VALIDATION`, доступ не
  переключён; слушатель `lan` открывается и закрывается без перезапуска (сверка раз в секунду).
- Событий, контракта, таблиц, задач нет.

## Зависимости
Можно: — (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием, подставить реализацию
  — реестром корня композиции (ADR-0004).
- `SystemDb` — только для своих таблиц system/public; пользовательские таблицы через него не трогать (аудитор SQL).
- «Чьи данные» — только `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/system` — пояс меняет «сегодня» (FakeClock), сеть и адрес, Langfuse
  (`application/system-settings.int.test.ts`); сквозь HTTP — `main/admin.int.test.ts`.
