# Модуль `identity`

Ярус 1 · таблицы: system · публикует: `identity.system-initialized`, `identity.user-registered`, `identity.user-deleted` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Вход: Better Auth (только ядро, ADR-0016) — пароль и сессии; первый запуск; регистрация с согласиями и подтверждение
адреса; источник сессий сайта и перепроверка владельцев задач. Сброс пароля, код восстановления, блокировка — T-013;
админка — T-017; демо-вход — T-054.

## Требования SPEC
AUTH-01…12, ROLE-01/02, SEC-01/02, ADM-01, ADM-30, DEMO-04. Сделано: AUTH-01…03, AUTH-08, AUTH-10, ROLE-02, SEC-01.
Макет: `Setup`, `Login`, `Register`, `Settings` (сайт — `features/setup`, `features/auth`, `features/settings`).

## Публичный API (`index.ts`)
- Фабрика: `createIdentityModule({ platform, facades })`; `SystemPlatform` (`system`, `deriveKey("auth/v1")`,
  `localOrigin`); фасады `mail` (письма), `privacy` (согласия в транзакции регистрации). Фасада `IdentityFacade` нет.
- `contract.identity.*`: `status` (publicProc: `{ initialized, setupAvailable }`), `setup` (localOnly; повтор —
  `CONFLICT`), `signIn` (`Set-Cookie: kosht_session`; неверно — `INVALID_CREDENTIALS`), `signOut`, `me` (authed:
  email, имя, роль, `emailVerified`), `register` (publicProc: частота на email и на всех → занятый email —
  `EMAIL_TAKEN` → пользователь, домохозяйство, согласия, ссылка и `identity.user-registered` одной транзакцией →
  письмо (сбой SMTP — только лог) → вход), `verifyEmail` (publicProc: POST со страницы `/verify-email`; ссылка
  одноразовая; использована или истекла — `LINK_INVALID`), `resendVerification` (authed; подтверждённому — без письма).
- Ссылки в письмах — `<адрес>/verify-email?token=…`, адрес — `platform/http/link-origin.ts` (NFR-24). Токен — 32 байта
  base64url; в `identity_verifications` — SHA-256 (`identifier` = `<назначение>:<хэш>`, `value` — id пользователя);
  новая ссылка гасит прежнюю того же назначения (`infrastructure/db/link-tokens.repo.ts`).
- Настройки (`settings.ts`): `identity.verify-link-hours` (24); пороги частоты `{ limit, windowMinutes }` —
  `identity.rate-register` (3/60), `identity.rate-register-total` (30/60), `identity.rate-resend-verification` (3/60).
- События: `identity.system-initialized`, `identity.user-registered` (`{ ids: [userId] }`, в транзакции создания
  пользователя; слушает `accounts` — «Наличные»).
- Реестры: `sessionSource` (cookie → `{ userId, householdId, role }`, только активный) и `scopeVerifier`.
- Таблицы (`systemTable`): `identity_users` (+ `role`, `status`, `demo`, `household_id`), `identity_sessions`
  (+ `household_id`), `identity_credentials` (хэш пароля), `identity_verifications`, `identity_households`,
  `system_state` (строка id = 1, `initialized`).

## Зависимости
Можно: mail, privacy (`tooling/architecture/modules.ts`). Слушает: —. `better-auth` — только `infrastructure/`; `application/` видит порт `AuthGateway`.

## Запреты
- `auth.handler` Better Auth не монтировать: вход и выход — процедуры oRPC (`auth.api.*` с `returnHeaders`); регистрация —
  своим сценарием (`disableSignUp`), плагинов нет (`admin` нарушает PRIV-07, R37).
- Пароль, cookie, токены ссылок и email — не в логах и не в ответах (кроме `Set-Cookie`): в логе только `userId`.
- Scope нового пользователя — только `application/new-user-scope.ts` (ARCHITECTURE §6.4, `isolation.mjs`).
- `SystemDb` — только для своих таблиц; пользовательские таблицы identity не трогает.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/identity` — пароль, Better Auth на SystemDb, первый запуск (повтор и гонка),
  одноразовые ссылки (`link-tokens.repo.int.test.ts`).
- Сквозь HTTP и очередь — `main/registration.int.test.ts` (стенд `main/__fixtures__/http-stack.ts`),
  `main/first-run.int.test.ts`, `main/isolation.registry.int.test.ts`; e2e — `e2e/specs/`.

## Подводные камни
- Пользователь пишется через `tx.db` ScopedDb нового пользователя: аудитор в режиме scoped проверяет только
  пользовательские таблицы, системные таблицы identity ему не мешают.
- Сессия продлевается в БД (Better Auth, раз в сутки), а cookie — нет: вход нужен раз в 7 дней (исправит T-013).
- `name` пользователя пуст (экраны имени не спрашивают) — сайт показывает email.
