# Модуль `identity`

Ярус 1 · таблицы: system · публикует: `identity.system-initialized`, `identity.user-registered`, `identity.user-deleted` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Вход в систему: Better Auth (только ядро, ADR-0016) — пароль и сессии; первый запуск (администратор и его
домохозяйство); источник сессий сайта и перепроверка владельцев фоновых задач для всего процесса. Код восстановления,
регистрация, блокировка, последний админ, демо-вход — следующие задачи модуля (T-012, T-013, T-017, T-054).

## Требования SPEC
AUTH-01…12, ROLE-01/02, SEC-01/02, ADM-01, ADM-30, DEMO-04 (вход). Сделано: AUTH-08 (вход, выход, сессия), AUTH-10
(экран первого запуска — только локальный вход, один раз), ROLE-02, SEC-01 (argon2id, ≥ 12). Макет: `Setup.dc.html`,
`Login.dc.html` (сайт — `features/setup`, `features/auth`).

## Публичный API (`index.ts`)
- Фабрика: `createIdentityModule({ platform, facades })`; платформа — `SystemPlatform` (`system`, `deriveKey("auth/v1")` —
  ключ подписи cookie, `localOrigin`); фасады `mail`, `privacy` пока не используются. Фасад `IdentityFacade` — нет.
- Контракт `contract.identity.*`: `status` (publicProc: `{ initialized, setupAvailable }` — экран первого запуска
  доступен, пока не инициализирована и вход локальный), `setup` (localOnly: на `lan` — `NOT_FOUND`; повтор и
  параллельный второй — `CONFLICT`), `signIn` (publicProc: `Set-Cookie: kosht_session`; неверно — `INVALID_CREDENTIALS`),
  `signOut` (publicProc: сессия удаляется, cookie снимается), `me` (authed: email, имя, роль).
- События (`events.ts`, экспорт из `index.ts`): `identity.system-initialized { ids: [userId] }`,
  `identity.user-registered { ids: [userId] }` — в транзакции первого запуска; слушает `accounts` («Наличные»).
- Реестры корня композиции: `sessionSource` (cookie → `{ userId, householdId, role }`, только активный пользователь) и
  `scopeVerifier` (пользователь есть, активен, домохозяйство то же) — оба один раз на процесс.
- Таблицы (`infrastructure/db/schema.ts`, все `systemTable`): `identity_users` (+ `role`, `status`, `demo`,
  `household_id`), `identity_sessions` (+ `household_id`), `identity_credentials` (account Better Auth: хэш пароля),
  `identity_verifications`, `identity_households`, `system_state` (строка id = 1, признак `initialized`).

## Зависимости
Можно: mail, privacy (`tooling/architecture/modules.ts`). Слушает: —. `better-auth` — только `infrastructure/`
(правило `better-auth-only-in-identity-infrastructure`); `application/` видит порт `AuthGateway`.

## Запреты
- `auth.handler` Better Auth не монтировать: вход и выход — процедуры oRPC (`auth.api.*` с `returnHeaders`); регистрации
  по HTTP нет (`disableSignUp`), плагинов нет (плагин `admin` нарушает PRIV-07, R37).
- Пароль и cookie — не в логах и не в ответах (кроме `Set-Cookie`); email в логи не пишется — только `userId`.
- Scope нового пользователя — только `application/new-user-scope.ts` (ARCHITECTURE §6.4, `isolation.mjs`).
- `SystemDb` — только для своих таблиц; пользовательские таблицы identity не трогает.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/identity` — пароль (unit), Better Auth на SystemDb (`auth.int.test.ts`),
  первый запуск (`setup.int.test.ts`: транзакция, повтор и гонка — `CONFLICT`, откат при сбое события).
- Сквозь процессы и реестры — `main/first-run.int.test.ts`, `main/isolation.registry.int.test.ts`; e2e — `e2e/specs/first-run.spec.ts`.

## Подводные камни
- Пользователь первого запуска пишется через `tx.db` ScopedDb нового пользователя: аудитор в режиме scoped проверяет
  только пользовательские таблицы, системные таблицы identity ему не мешают; события — в той же транзакции.
- Сессия продлевается в БД (Better Auth, раз в сутки), а cookie — нет (ответ процедуры её не обновляет): вход нужен
  раз в 7 дней.
- `name` пользователя первого запуска пуст (экран имени не спрашивает) — сайт показывает email.
