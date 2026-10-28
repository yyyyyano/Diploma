# Модуль `identity`

Ярус 1 · таблицы: system · публикует: `identity.system-initialized`, `identity.user-registered`, `identity.user-deleted` (`docs/CAPABILITIES.md`; задачи — `tasks/plan.md`)

## Назначение
Вход: Better Auth (только ядро, ADR-0016) — пароль и сессии; первый запуск; регистрация с согласиями и подтверждение
адреса; сброс пароля, код восстановления, блокировка и защита последнего администратора; источник сессий сайта и
перепроверка владельцев задач; учётные записи для админки (ADM-30). Демо-вход — T-054.

## Требования SPEC
AUTH-01…12, ROLE-01/02, SEC-01/02, ADM-01, ADM-30, DEMO-04. Сделано: AUTH-01…05 (без Telegram), ADM-30 (фасады), AUTH-08,
AUTH-10…12, ROLE-02, SEC-01/02, PRIV-06 (удаление своего аккаунта). Макет: `Setup`, `Login`, `Register`,
`Settings` (сайт — `features/{setup,auth,settings}`).

## Публичный API (`index.ts`)
- Фабрика: `createIdentityModule({ platform, facades })`; `SystemPlatform`; фасады `mail` (письма), `privacy` (согласия).
- Фасад `IdentityFacade`: `setStatus(userId, active|blocked)` (блокировка завершает сессии), `setRole(userId, user|admin)`,
  `assertRemovable(db, userId)` — последнего активного админа `LAST_ADMIN` под `FOR UPDATE` (`application/admins.ts`);
  админке (`application/admin-users.ts`, ADM-30, R37): `listAccounts()` — только учётные записи; `removeUser(actor,
  id, email)` — email не совпал — `VALIDATION`, иначе `eraseUser` под scope цели из `target-user-scope.ts` (просящий —
  активный админ, перепроверка в базе); `resetUserPassword(actor, id, from)` — подтверждён адрес — письмо `{ email }`,
  иначе ссылка админу `{ shown, link }`, лог и отметка `password_reset_by_admin_at`; `emailOf(s)`.
- `contract.identity.*` — publicProc: `status`, `signIn` (частота на email; `INVALID_CREDENTIALS`; заблокирован —
  `ACCOUNT_BLOCKED` без cookie), `register` (частота на email и на всех; `EMAIL_TAKEN`; всё одной транзакцией → письмо
  → вход), `verifyEmail`, `requestPasswordReset` (ответ одинаковый для любого email), `resetPassword` (`/recovery?token=…`,
  1 ч; сессии завершены; заблокированный после выдачи ссылки — `ACCOUNT_BLOCKED`), `recoverWithCode` (новый пароль и
  код, вход; ложный хэш для неизвестного email; код гасится `DELETE … WHERE code_hash` — из двух параллельных проходит
  один), `signOut`; localOnly: `setup`; authed: `me`, `resendVerification`, `recoveryCodeStatus`, `createRecoveryCode`,
  `changePassword`, `adminResetNotice`/`acknowledgeAdminReset` (отметка сброса админом — показать и погасить),
  `deleteAccount` (пароль → `eraseUser`, `application/erase-user.ts`: блокировка и сессии → `jobs.discardHousehold` →
  `privacy.purge` → `mail.forgetRecipient` → последней запись identity; cookie снята).
- Ссылки в письмах — адрес по `platform/http/link-origin.ts`; токен 32 байта, в `identity_verifications` — SHA-256,
  гасится `DELETE … RETURNING`, срок — по `Clock`. Код восстановления — Crockford base32, хэш argon2id.
- Настройки (`settings.ts`): `identity.verify-link-hours` (24), `identity.reset-link-minutes` (60), частота `rate-*`.
- События: `identity.system-initialized`, `identity.user-registered` (слушает `accounts`). Реестры: `sessionSource`,
  `scopeVerifier`. Таблицы (`systemTable`): `identity_users` (+ `role`, `status`, `demo`, `household_id`,
  `password_reset_by_admin_at`), `identity_sessions`, `identity_credentials`, `identity_verifications`,
  `identity_recovery_codes`, `identity_households`, `system_state`.

## Зависимости
Можно: mail, privacy (`tooling/architecture/modules.ts`). Слушает: —. `better-auth` — только `infrastructure/`; `application/` видит порт `AuthGateway`.

## Запреты
- `auth.handler` Better Auth не монтировать: процедуры oRPC зовут `auth.api.*`; регистрация, ссылки и код — свои
  сценарии (`disableSignUp`), плагинов нет (`admin` нарушает PRIV-07, R37).
- Пароль, cookie, токены, код восстановления и email — не в логах и не в ответах (кроме `Set-Cookie` и кода — один раз).
- Scope — только `application/new-user-scope.ts` (новый пользователь) и `target-user-scope.ts` (удаление админом);
  `SystemDb` — только свои таблицы.

## Как тестировать
- `pnpm vitest run apps/server/src/modules/identity` — пароль, код, Better Auth (блокировка, продление cookie, смена
  пароля), первый запуск, ссылки, сброс (`FakeClock`), код восстановления, последний админ и гонка (`admins.int.test.ts`).
- Сквозь HTTP — `main/{registration,recovery,first-run,account-deletion}.int.test.ts` (стенд `http-stack.ts`).

## Подводные камни
- Пользователь пишется через `tx.db` ScopedDb нового пользователя: аудитор в scoped проверяет только пользовательские
  таблицы. Срок ссылок — свой (`Clock`), а не Better Auth (тот сверяет `new Date()`, FakeClock на него не действует).
- `name` пользователя пуст (экраны имени не спрашивают) — сайт показывает email.
