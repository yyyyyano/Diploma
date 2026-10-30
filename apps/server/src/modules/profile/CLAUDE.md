# Модуль `profile`

Ярус 2 · таблицы: user · публикует: `profile.facts-changed` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Факты о пользователе для законов РБ (анкета, чат, выписки, вывод системы, правка на странице) со статусом
«подтверждён / предположение», «Что ассистент знает обо мне», анкета на 1 минуту после первого входа (T-018).

## Требования SPEC
PROF-01…06, AGT-03 («профиль»), AGT-06 (ответ — факт), AUTH-07. PROF-07 (вопрос об имуществе) — T-048.

## Публичный API (`index.ts`)
- Фабрика: `createProfileModule({ platform, facades })`; платформа — `Platform` (без `SystemDb`); фасады —
  `facades.identity`, `facades.actions` («Отменить» у фактов).
- Фасад `ProfileFacade`: `getFacts(s, keys, onDate)` → `ProfileFact[]` (только действующие, с оценкой на дату вопроса —
  возраст детей, `childrenUnder18`, срок молодого специалиста, PROF-06); `upsertDerivedFact(s, { value, source:
  statements|system, sourceRef? })` → id или `undefined` («предположение», PROF-03; подтверждённое человеком не
  перетирает; удалённый человеком факт не оживляет — `undefined`); `recordAnswer(s, { value, messageId, channel })` → `{ fact, undoToken }` (источник «чат», PROF-04).
  Словарь имён для маскирования (PRIV-03, T-024): `knownNamesSource` модуля (`application/known-names.ts`) — имена детей из
  действующих фактов «дети»; шлюз `llm` склоняет их и меняет метками перед облаком (`platform.knownNames`).
- Событие `profile.facts-changed { ids }` (`events.ts`) — на каждое изменение, пачкой (анкета — одно событие).
- Контракт `contract.profile.*` (все authed, канал отмены — web): `facts` (все действующие, оценённые на сегодня),
  `onboarding` (`pending | done`), `completeOnboarding({ answers })` (пропущенный вопрос — нет поля; пустые ответы —
  «пропустить анкету»), `setFact({ id?, value })` (ключ PROF-01 — один на пользователя, заметка `note` — по id; источник
  «указан вами»), `confirmFact({ id })`, `deleteFact({ id })` — каждое изменение возвращает `undoToken`.
- Инструменты агента (`agent/tools.ts`, набор `core`): `read_profile_facts` (`read`, `keys?`), `upsert_profile_fact`
  (`write`, источник «чат», `undoToken`).
- Отмена: обработчик `profile.restore { revisionId }` — факт снова такой, каким был до действия (не было — снова нет).
- Значения фактов — `FactValue` контракта (по ключу; `income.regular` и `obligations.regular` — «предположения» от `recurring`, T-030, сумма в месяц); тема — по ключу (`domain/facts.ts`), у заметки — своя.
- Таблицы (`userOwnedTable`): `profile_facts` (ключ, тема, значение jsonb, источник, ссылка, статус, день записи,
  `deleted_at` — удалённый факт помечается, чтобы «Отменить» его вернул); `profile_fact_revisions` (состояние «до
  действия», `ownedFk` на факт); `profiles` (признак «анкета пройдена или пропущена» — не `localStorage`).

## Зависимости
Можно: identity, actions (`tooling/architecture/modules.ts`). Слушает: —.

## Запреты
- В чужой модуль — только через его `index.ts` и только из «Можно»; сообщить наверх — событием (ADR-0004).
- Данные домохозяйства — только через `s: ScopedDb` с `s.own(таблица)` на каждую таблицу запроса; «чьи» — только
  `s.scope`, никогда из входа процедуры, инструмента или нагрузки задачи.
- Удалённый факт (`deleted_at`) не отдаётся ни фасадом, ни процедурами, ни инструментами.
- «Сегодня» — только `platform.clock`; возраст и сроки считает `domain/facts.ts` на переданную дату.
- В журнале отмены — только id ревизии; в событии — только id фактов.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/profile` — правила дат и тем (`domain/facts.test.ts`, PROF-06), сценарии и
  инструменты на Postgres с настоящим журналом `actions` (`application/facts.int.test.ts`); изоляция —
  `main/isolation.registry.int.test.ts`.
